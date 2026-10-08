/** Type declarations for `secondfactor`. See `index.js` for behaviour. */

export declare const VERSION: string;
export declare const USER_AGENT: string;

export declare class SecondFactorError extends Error {
  /**
   * The stable string to branch on, such as `rate_limited`, `not_verified`,
   * `invalid_response` or `network_error`.
   */
  code: string | null;
  /**
   * The HTTP status of a refusal, including a refused 3xx redirect, or `null`
   * when no answer arrived or a successful answer could not be trusted.
   */
  status: number | null;
}

export interface SecondFactorOptions {
  /** Visible ASCII only; anything else throws `TypeError`. */
  apiKey: string;
  serviceSid?: string;
  /**
   * Must be `https://`; plain `http://` is accepted only for `localhost`,
   * `127.0.0.1` and `[::1]`. Anything else throws `TypeError`.
   */
  baseUrl?: string;
  timeoutMs?: number;
  /** Must honour `redirect: "manual"` and `signal`. */
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
  /** Throws `TypeError` for a missing or malformed `apiKey` or an unsafe `baseUrl`. */
  constructor(options: SecondFactorOptions);
  createSession(params: CreateSessionParams): Promise<VerificationSession>;
  retrieveSession(sid: string): Promise<VerificationSession>;
  /** Rejects with code `not_verified` unless the confirmed session's status is `VERIFIED`. */
  verifySession(storedSid: string, returnToken?: string | null): Promise<VerifiedSession>;
  send(
    to: string,
    options?: { code?: string; templateSid?: string; idempotencyKey?: string },
  ): Promise<Verification>;
  check(verificationSid: string, code: string | number): Promise<Verification & { verified: boolean }>;
  serviceSid(): Promise<string>;
}
