/** Type declarations for `secondfactor`. See `index.js` for behaviour. */

export declare const VERSION: string;
export declare const USER_AGENT: string;

export declare class SecondFactorError extends Error {
  /** The stable string to branch on, such as `rate_limited` or `not_verified`. */
  code: string | null;
  /** The HTTP status, or `null` when no answer arrived. */
  status: number | null;
}

export interface SecondFactorOptions {
  apiKey: string;
  serviceSid?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export type SessionStatus = "OPEN" | "VERIFIED" | "CANCELED" | "FAILED" | "EXPIRED";

export interface VerificationSession {
  sid: string;
  mode: "hosted" | "headless";
  status: SessionStatus;
  failure_reason: string | null;
  to: string;
  client_reference_id: string | null;
  verification_sid: string | null;
  sends: number;
  return_url: string | null;
  confirmed: boolean;
  expires_at: string;
  date_created: string;
  date_completed: string | null;
  /** Hosted sessions, on creation only. */
  url?: string;
  /** Headless sessions, on creation only. */
  client_token?: string;
}

export interface Verification {
  sid: string;
  to: string;
  status: "PENDING" | "VERIFIED" | "EXPIRED" | "LOCKED" | null;
  delivery_status: string;
  channel: string | null;
  price: string | null;
  price_unit: string;
  attempts_remaining?: number;
  expires_at?: string;
  date_created: string;
}

export interface CreateSessionParams {
  to: string;
  mode?: "hosted" | "headless";
  returnUrl?: string;
  clientReferenceId?: string;
  templateSid?: string;
}

export interface VerifiedSession {
  /** The number that was proven. */
  phone: string;
  clientReferenceId: string | null;
  session: VerificationSession;
}

export declare class SecondFactor {
  constructor(options: SecondFactorOptions);
  createSession(params: CreateSessionParams): Promise<VerificationSession>;
  retrieveSession(sid: string): Promise<VerificationSession>;
  verifySession(storedSid: string, returnToken?: string | null): Promise<VerifiedSession>;
  send(
    to: string,
    options?: { code?: string; templateSid?: string; idempotencyKey?: string },
  ): Promise<Verification>;
  check(verificationSid: string, code: string | number): Promise<Verification & { verified: boolean }>;
  serviceSid(): Promise<string>;
}
