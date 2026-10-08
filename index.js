"use strict";

/**
 * secondfactor.ai for Node.js servers. No dependencies; Node 18 or later.
 *
 * This library runs on your server. It holds your API key, which must never
 * reach a browser or a mobile app, and calls secondfactor.ai for you.
 *
 * Verification sessions (recommended): your server creates a session and
 * either redirects the user to our hosted page or hands a short-lived token to
 * your own frontend. When the user is done, your server confirms the session,
 * once.
 *
 *   const { SecondFactor } = require("secondfactor");
 *   const sf = new SecondFactor({ apiKey: process.env.SECONDFACTOR_API_KEY });
 *
 *   const session = await sf.createSession({ to: "+9779841000001", returnUrl: "https://app.example.com/verified" });
 *   req.session.sfSid = session.sid;   // keep it for this browser
 *   res.redirect(303, session.url);
 *
 *   // Back on /verified?sf_session_id=...&sf_return_token=...
 *   const { phone } = await sf.verifySession(req.session.sfSid, req.query.sf_return_token);
 *
 * Direct sends: your server sends a code and checks the one your user typed in
 * your own form, with `send` and `check`.
 *
 * Every refused request throws `SecondFactorError`, whose `code` is a stable
 * string to branch on. A wrong code is not an error: `check` resolves with
 * `verified: false` and the attempts remaining.
 */

const VERSION = "0.1.0";
const DEFAULT_BASE_URL = "https://api.secondfactor.ai";
const USER_AGENT = `secondfactor-node/${VERSION}`;

// A check answered 409 carries the verification, whose status says why it can
// never succeed. Each becomes an error code, so a caller branches on one field.
const DEAD_VERIFICATION_CODES = {
  EXPIRED: "expired",
  LOCKED: "locked",
  VERIFIED: "already_verified",
};

/**
 * A request secondfactor.ai refused, or could not be reached for.
 *
 * `code` is the stable string to branch on, such as `rate_limited`,
 * `insufficient_funds`, `not_verified` or `network_error`. `status` is the HTTP
 * status, or `null` when no answer arrived. The message is written for
 * developers and is safe to log; never show it to your end users.
 */
class SecondFactorError extends Error {
  constructor(message, code = null, status = null) {
    super(message);
    this.name = "SecondFactorError";
    this.code = code;
    this.status = status;
  }
}

class SecondFactor {
  /**
   * @param {object} options
   * @param {string} options.apiKey A key from the dashboard's API keys page.
   * @param {string} [options.serviceSid] Your Service SID (`VA…`). Looked up on
   *   first use when omitted, because every organization has exactly one.
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeoutMs] Per request; 10 seconds by default.
   * @param {typeof fetch} [options.fetch] A `fetch` to use instead of the global one.
   */
  constructor({ apiKey, serviceSid, baseUrl = DEFAULT_BASE_URL, timeoutMs = 10_000, fetch: fetchImpl } = {}) {
    if (!apiKey) throw new TypeError("apiKey is required.");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
    this._serviceSid = serviceSid || null;
    this._fetch = fetchImpl || globalThis.fetch;
    if (typeof this._fetch !== "function") {
      throw new TypeError("No fetch available. Use Node 18 or later, or pass options.fetch.");
    }
  }

  // ─────────────────────────── verification sessions ───────────────────────────

  /**
   * Start verifying `to` (E.164, for example `+9779841000001`).
   *
   * A hosted session needs `returnUrl`, on an origin listed under Settings →
   * Hosted verification, and resolves with `url`: redirect the user there. A
   * headless session (`mode: "headless"`) takes no `returnUrl` and resolves
   * with `client_token`: give it to your own frontend. Either is returned only
   * this once. Store the returned `sid` against the user's pending sign-in.
   */
  async createSession({ to, mode = "hosted", returnUrl, clientReferenceId, templateSid } = {}) {
    return this._request("POST", await this._servicePath("VerificationSessions"), {
      To: to,
      Mode: mode,
      ReturnUrl: returnUrl,
      ClientReferenceId: clientReferenceId,
      TemplateSid: templateSid,
    });
  }

  /** The session's current state. Reading it proves nothing; use `verifySession`. */
  async retrieveSession(sid) {
    return this._request("GET", await this._servicePath(`VerificationSessions/${segment(sid)}`));
  }

  /**
   * Accept the outcome of the session you stored, exactly once.
   *
   * Pass the `sid` you stored when you created the session, never the
   * `sf_session_id` from the return URL: that parameter only helps you find
   * your stored session, and anyone can edit a URL. For a hosted session, pass
   * the `sf_return_token` from the return URL; a headless session needs none.
   *
   * Resolves with `{ phone, clientReferenceId, session }`, where `phone` is the
   * number that was proven. Throws `SecondFactorError` otherwise, with `code`
   * one of `missing_return_token`, `invalid_return_token`, `not_verified`,
   * `already_confirmed` or `not_found`, among others.
   */
  async verifySession(storedSid, returnToken) {
    const body = returnToken ? { ReturnToken: returnToken } : {};
    const session = await this._request(
      "POST",
      await this._servicePath(`VerificationSessions/${segment(storedSid)}/Confirm`),
      body,
    );
    return { phone: session.to, clientReferenceId: session.client_reference_id ?? null, session };
  }

  // ───────────────────────────────── direct sends ─────────────────────────────────

  /**
   * Send a code to `to` (E.164). Resolves with the verification; keep its `sid`.
   *
   * Sending again to the same number is a new verification and is charged
   * again; that is how a resend works. Pass `idempotencyKey`, new for each user
   * action, to retry one safely. Pass `code` only if you generate codes
   * yourself; you then check it yourself too.
   */
  async send(to, { code, templateSid, idempotencyKey } = {}) {
    const headers = idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {};
    return this._request(
      "POST",
      await this._servicePath("Verifications"),
      { To: to, Code: code, TemplateSid: templateSid },
      { headers },
    );
  }

  /**
   * Check the code your user typed. Resolves with the verification plus
   * `verified`, true only when the code was right. A wrong code resolves with
   * `verified: false` and `attempts_remaining`. A verification that can never
   * succeed throws with `code` `expired`, `locked` or `already_verified`.
   */
  async check(verificationSid, code) {
    let body;
    try {
      body = await this._request(
        "POST",
        await this._servicePath("VerificationCheck"),
        { VerificationSid: verificationSid, Code: String(code).trim() },
        { answers: [422] },
      );
    } catch (error) {
      if (error instanceof SecondFactorError && error.status === 409 && DEAD_VERIFICATION_CODES[error.code]) {
        error.code = DEAD_VERIFICATION_CODES[error.code];
      }
      throw error;
    }
    return { ...body, verified: body.status === "VERIFIED" };
  }

  // ─────────────────────────────────── internals ───────────────────────────────────

  /** Your Service SID (`VA…`), looked up once when not given. */
  async serviceSid() {
    if (!this._serviceSid) {
      const { services } = await this._request("GET", "/v2/Services");
      this._serviceSid = services[0].sid;
    }
    return this._serviceSid;
  }

  async _servicePath(path) {
    return `/v2/Services/${await this.serviceSid()}/${path}`;
  }

  async _request(method, path, body, { headers = {}, answers = [] } = {}) {
    const init = {
      method,
      headers: {
        "X-API-Key": this.apiKey,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...headers,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(withoutEmpty(body));
    }

    let response;
    try {
      response = await this._fetch(this.baseUrl + path, init);
    } catch (cause) {
      throw new SecondFactorError(`secondfactor.ai unreachable: ${cause.message}`, "network_error", null);
    }
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (response.ok || (answers.includes(response.status) && payload && payload.sid)) {
      return payload;
    }
    const code = typeof payload.code === "string" ? payload.code : typeof payload.status === "string" ? payload.status : null;
    const message = payload.message || `secondfactor.ai answered HTTP ${response.status}.`;
    throw new SecondFactorError(message, code, response.status);
  }
}

/** Drop parameters left unset, so they are not sent as null. */
function withoutEmpty(body) {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined && value !== null));
}

/** A path segment, encoded so an identifier cannot change the path. */
function segment(value) {
  return encodeURIComponent(String(value));
}

module.exports = { SecondFactor, SecondFactorError, VERSION, USER_AGENT };
