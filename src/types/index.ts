export interface IdentifyRequest {
  email?: string | null;
  phoneNumber?: string | null;
}

export interface ConsolidatedContact {
  primaryContatctId: number; // Note: keeping the spec's typo intentionally
  emails: string[];
  phoneNumbers: string[];
  secondaryContactIds: number[];
}

export interface IdentifyResponse {
  contact: ConsolidatedContact;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}
