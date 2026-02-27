/**
 * Integration tests for the /identify endpoint
 * Covers all scenarios from the Bitespeed specification
 */
import request from "supertest";
import app from "../app";
import prisma from "../utils/prismaClient";

// Clean DB before each test
beforeEach(async () => {
  await prisma.contact.deleteMany();
});

afterAll(async () => {
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
});

describe("POST /identify", () => {
  // ── Input Validation ────────────────────────────────────────────────────────
  describe("Input Validation", () => {
    it("should return 400 if both email and phoneNumber are missing", async () => {
      const res = await request(app).post("/identify").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation Error");
    });

    it("should return 400 if both are null", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: null, phoneNumber: null });
      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid email format", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "not-an-email" });
      expect(res.status).toBe(400);
    });

    it("should accept phoneNumber as a number", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "test@example.com", phoneNumber: 123456 });
      expect(res.status).toBe(200);
    });
  });

  // ── Scenario 1: New Customer ────────────────────────────────────────────────
  describe("New Customer (no existing contacts)", () => {
    it("should create a new primary contact and return it", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });

      expect(res.status).toBe(200);
      expect(res.body.contact).toBeDefined();
      expect(res.body.contact.primaryContatctId).toBeDefined();
      expect(res.body.contact.emails).toContain("lorraine@hillvalley.edu");
      expect(res.body.contact.phoneNumbers).toContain("123456");
      expect(res.body.contact.secondaryContactIds).toEqual([]);
    });

    it("should create a new contact with email only", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "doc@hillvalley.edu" });

      expect(res.status).toBe(200);
      expect(res.body.contact.emails).toContain("doc@hillvalley.edu");
      expect(res.body.contact.phoneNumbers).toEqual([]);
      expect(res.body.contact.secondaryContactIds).toEqual([]);
    });

    it("should create a new contact with phone only", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ phoneNumber: "9876543210" });

      expect(res.status).toBe(200);
      expect(res.body.contact.emails).toEqual([]);
      expect(res.body.contact.phoneNumbers).toContain("9876543210");
    });
  });

  // ── Scenario 2: Create Secondary Contact ────────────────────────────────────
  describe("Secondary Contact Creation", () => {
    it("should create a secondary contact when new info matches existing contact (spec example)", async () => {
      // First order
      await request(app)
        .post("/identify")
        .send({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });

      // Second order - same phone, new email
      const res = await request(app)
        .post("/identify")
        .send({ email: "mcfly@hillvalley.edu", phoneNumber: "123456" });

      expect(res.status).toBe(200);
      const contact = res.body.contact;
      expect(contact.emails[0]).toBe("lorraine@hillvalley.edu"); // primary email first
      expect(contact.emails).toContain("mcfly@hillvalley.edu");
      expect(contact.phoneNumbers).toEqual(["123456"]); // deduplicated
      expect(contact.secondaryContactIds).toHaveLength(1);
    });

    it("should NOT create duplicate secondary contact for identical request", async () => {
      await request(app)
        .post("/identify")
        .send({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });

      await request(app)
        .post("/identify")
        .send({ email: "mcfly@hillvalley.edu", phoneNumber: "123456" });

      // Same request again - should not create another secondary
      const res = await request(app)
        .post("/identify")
        .send({ email: "mcfly@hillvalley.edu", phoneNumber: "123456" });

      expect(res.status).toBe(200);
      expect(res.body.contact.secondaryContactIds).toHaveLength(1);
    });
  });

  // ── Scenario 3: Merge Two Primary Clusters ──────────────────────────────────
  describe("Primary to Secondary Conversion (spec example)", () => {
    it("should merge two clusters and make newer primary a secondary", async () => {
      // Create two separate primary contacts
      await request(app)
        .post("/identify")
        .send({ email: "george@hillvalley.edu", phoneNumber: "919191" });

      await request(app)
        .post("/identify")
        .send({ email: "biffsucks@hillvalley.edu", phoneNumber: "717171" });

      // Now link them with a bridging request
      const res = await request(app)
        .post("/identify")
        .send({ email: "george@hillvalley.edu", phoneNumber: "717171" });

      expect(res.status).toBe(200);
      const contact = res.body.contact;

      // George (older) should be primary
      expect(contact.emails[0]).toBe("george@hillvalley.edu");
      expect(contact.emails).toContain("biffsucks@hillvalley.edu");
      expect(contact.phoneNumbers[0]).toBe("919191");
      expect(contact.phoneNumbers).toContain("717171");
      expect(contact.secondaryContactIds).toHaveLength(1);
    });
  });

  // ── Scenario 4: Idempotent Lookups (spec requests that all return same result)
  describe("Idempotent lookups", () => {
    it("should return same response for all equivalent requests", async () => {
      // Setup
      await request(app)
        .post("/identify")
        .send({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });
      await request(app)
        .post("/identify")
        .send({ email: "mcfly@hillvalley.edu", phoneNumber: "123456" });

      // All these should return the same consolidated contact
      const requests = [
        { email: null, phoneNumber: "123456" },
        { email: "lorraine@hillvalley.edu", phoneNumber: null },
        { email: "mcfly@hillvalley.edu", phoneNumber: null },
        { email: "mcfly@hillvalley.edu", phoneNumber: "123456" },
      ];

      const responses = await Promise.all(
        requests.map((body) =>
          request(app).post("/identify").send(body)
        )
      );

      const primaryIds = responses.map((r) => r.body.contact.primaryContatctId);
      // All should have the same primary ID
      expect(new Set(primaryIds).size).toBe(1);

      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body.contact.emails).toContain("lorraine@hillvalley.edu");
        expect(res.body.contact.emails).toContain("mcfly@hillvalley.edu");
      }
    });
  });

  // ── Scenario 5: Edge Cases ──────────────────────────────────────────────────
  describe("Edge Cases", () => {
    it("should handle phoneNumber as number type in request body", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "test@test.com", phoneNumber: 555000 });
      expect(res.status).toBe(200);
      expect(res.body.contact.phoneNumbers).toContain("555000");
    });

    it("should correctly place primary email first in array", async () => {
      await request(app)
        .post("/identify")
        .send({ email: "first@test.com", phoneNumber: "111" });

      const res = await request(app)
        .post("/identify")
        .send({ email: "second@test.com", phoneNumber: "111" });

      expect(res.body.contact.emails[0]).toBe("first@test.com");
    });

    it("should correctly place primary phoneNumber first in array", async () => {
      await request(app)
        .post("/identify")
        .send({ email: "first@test.com", phoneNumber: "111" });

      const res = await request(app)
        .post("/identify")
        .send({ email: "first@test.com", phoneNumber: "222" });

      expect(res.body.contact.phoneNumbers[0]).toBe("111");
    });
  });
});

// ── Health Check ────────────────────────────────────────────────────────────
describe("GET /health", () => {
  it("should return healthy status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });
});

describe("GET /", () => {
  it("should return service info", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("Bitespeed Identity Reconciliation");
  });
});
