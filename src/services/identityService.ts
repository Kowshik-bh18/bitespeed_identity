import { Contact, LinkPrecedence } from "@prisma/client";
import prisma from "../utils/prismaClient";
import { ConsolidatedContact } from "../types";
import { logger } from "../utils/logger";

/**
 * Core Identity Reconciliation Service
 *
 * Algorithm:
 * 1. Find all contacts matching email OR phoneNumber
 * 2. If none found → create new primary contact
 * 3. If found → determine primary (oldest by createdAt)
 * 4. If two separate primaries found → merge clusters (newer becomes secondary)
 * 5. If new info in request → create secondary contact
 * 6. Build and return consolidated response
 */
export async function reconcileIdentity(
  email: string | null | undefined,
  phoneNumber: string | null | undefined
): Promise<ConsolidatedContact> {
  const normalizedEmail = email || null;
  const normalizedPhone = phoneNumber || null;

  logger.info("Starting identity reconciliation", { email: normalizedEmail, phoneNumber: normalizedPhone });

  // ── Step 1: Find all matching contacts (by email OR phone) ──────────────────
  const matchingContacts = await findMatchingContacts(normalizedEmail, normalizedPhone);

  // ── Step 2: No existing contacts → brand new customer ──────────────────────
  if (matchingContacts.length === 0) {
    logger.info("No existing contacts found, creating new primary contact");
    const newContact = await createContact(normalizedEmail, normalizedPhone, null, "primary");
    return buildResponse(newContact, []);
  }

  // ── Step 3: Resolve all contacts to their root primaries ───────────────────
  const allContacts = await expandToFullCluster(matchingContacts);

  // Find all primaries in the cluster
  const primaries = allContacts.filter((c) => c.linkPrecedence === "primary");

  let primaryContact: Contact;

  // ── Step 4: Multiple primaries = two clusters need merging ─────────────────
  if (primaries.length > 1) {
    logger.info(`Found ${primaries.length} primary contacts, merging clusters`);
    // The oldest primary wins
    primaries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    primaryContact = primaries[0];

    // Demote all other primaries (and their clusters) to secondary
    const primariesToDemote = primaries.slice(1);
    await demotePrimariesToSecondary(primariesToDemote, primaryContact.id);
  } else {
    primaryContact = primaries[0];
  }

  // ── Step 5: Refresh full cluster after any merges ──────────────────────────
  const freshCluster = await getFullCluster(primaryContact.id);

  // ── Step 6: Check if request contains new information ─────────────────────
  const hasNewEmail =
    normalizedEmail &&
    !freshCluster.some((c) => c.email === normalizedEmail);

  const hasNewPhone =
    normalizedPhone &&
    !freshCluster.some((c) => c.phoneNumber === normalizedPhone);

  if (hasNewEmail || hasNewPhone) {
    logger.info("Request contains new information, creating secondary contact", {
      hasNewEmail,
      hasNewPhone,
    });
    await createContact(normalizedEmail, normalizedPhone, primaryContact.id, "secondary");
  }

  // ── Step 7: Build final consolidated response ──────────────────────────────
  const finalCluster = await getFullCluster(primaryContact.id);
  const secondaryContacts = finalCluster.filter(
    (c) => c.linkPrecedence === "secondary"
  );

  logger.info("Reconciliation complete", { primaryId: primaryContact.id, clusterSize: finalCluster.length });

  return buildResponse(primaryContact, secondaryContacts);
}

// ── Helper: Find contacts matching email OR phoneNumber ──────────────────────
async function findMatchingContacts(
  email: string | null,
  phoneNumber: string | null
): Promise<Contact[]> {
  const conditions: { email?: string; phoneNumber?: string }[] = [];

  if (email) conditions.push({ email });
  if (phoneNumber) conditions.push({ phoneNumber });

  if (conditions.length === 0) return [];

  return prisma.contact.findMany({
    where: {
      OR: conditions,
      deletedAt: null,
    },
  });
}

// ── Helper: Expand a set of contacts to their full clusters ──────────────────
async function expandToFullCluster(contacts: Contact[]): Promise<Contact[]> {
  const allIds = new Set<number>();
  const allContacts = new Map<number, Contact>();

  // Collect all contacts, resolving each to its primary
  for (const contact of contacts) {
    const rootId = contact.linkPrecedence === "primary"
      ? contact.id
      : (contact.linkedId ?? contact.id);

    allIds.add(rootId);
    allContacts.set(contact.id, contact);
  }

  // Fetch full clusters for each root ID
  const clusterContacts = await prisma.contact.findMany({
    where: {
      OR: [
        { id: { in: Array.from(allIds) } },
        { linkedId: { in: Array.from(allIds) } },
      ],
      deletedAt: null,
    },
  });

  // Merge into map to deduplicate
  for (const c of clusterContacts) {
    allContacts.set(c.id, c);
  }

  return Array.from(allContacts.values());
}

// ── Helper: Get the complete cluster for a primary contact ID ────────────────
async function getFullCluster(primaryId: number): Promise<Contact[]> {
  return prisma.contact.findMany({
    where: {
      OR: [{ id: primaryId }, { linkedId: primaryId }],
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
  });
}

// ── Helper: Demote primary contacts to secondary ─────────────────────────────
async function demotePrimariesToSecondary(
  primariesToDemote: Contact[],
  newPrimaryId: number
): Promise<void> {
  for (const primary of primariesToDemote) {
    // Demote the primary itself
    await prisma.contact.update({
      where: { id: primary.id },
      data: {
        linkPrecedence: "secondary",
        linkedId: newPrimaryId,
        updatedAt: new Date(),
      },
    });

    // Re-link all its secondaries to the new primary
    await prisma.contact.updateMany({
      where: {
        linkedId: primary.id,
        deletedAt: null,
      },
      data: {
        linkedId: newPrimaryId,
        updatedAt: new Date(),
      },
    });
  }
}

// ── Helper: Create a new contact ─────────────────────────────────────────────
async function createContact(
  email: string | null,
  phoneNumber: string | null,
  linkedId: number | null,
  linkPrecedence: LinkPrecedence
): Promise<Contact> {
  return prisma.contact.create({
    data: {
      email,
      phoneNumber,
      linkedId,
      linkPrecedence,
    },
  });
}

// ── Helper: Build the consolidated response object ───────────────────────────
function buildResponse(
  primary: Contact,
  secondaries: Contact[]
): ConsolidatedContact {
  // Deduplicate emails: primary first, then secondaries in order
  const emails: string[] = [];
  if (primary.email) emails.push(primary.email);

  for (const contact of secondaries) {
    if (contact.email && !emails.includes(contact.email)) {
      emails.push(contact.email);
    }
  }

  // Deduplicate phone numbers: primary first, then secondaries in order
  const phoneNumbers: string[] = [];
  if (primary.phoneNumber) phoneNumbers.push(primary.phoneNumber);

  for (const contact of secondaries) {
    if (contact.phoneNumber && !phoneNumbers.includes(contact.phoneNumber)) {
      phoneNumbers.push(contact.phoneNumber);
    }
  }

  const secondaryContactIds = secondaries.map((c) => c.id);

  return {
    primaryContatctId: primary.id,
    emails,
    phoneNumbers,
    secondaryContactIds,
  };
}
