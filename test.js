"use strict";

/**
 * Tests against a stub of the secondfactor.ai API on localhost: `npm test`.
 *
 * The stub answers with the exact shapes the real API documents, so these
 * tests hold two things: what the library sends (paths, headers, bodies) and
 * how it turns each answer into a resolved value or a `SecondFactorError`. The
 * second matters most, because a caller signs a user in on what
 * `verifySession` and `check` resolve with.
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const { after, before, beforeEach, describe, it } = require("node:test");

const { SecondFactor, SecondFactorError, USER_AGENT } = require("./index.js");

const SERVICE = "VA0a1b2c3d4e5f60718293a4b5c6d7e8f9";
const SESSION = {
  sid: "VSN26H7K3MQ2XWZ8RT4",
  mode: "hosted",
  status: "VERIFIED",
  to: "+9779841000001",
  client_reference_id: "signup-8812",
  confirmed: true,
};

const envelope = (status, code, message = "Refused.") => [status, { status, code, message }];

let server;
let base;
let routes;
let requests;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      const [status, payload] = routes[`${req.method} ${req.url}`] || envelope(404, "not_found");
      res.writeHead(status, { "Content-Type": typeof payload === "string" ? "text/html" : "application/json" });
      res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

let sf;
beforeEach(() => {
  routes = { "GET /v2/Services": [200, { services: [{ sid: SERVICE }] }] };
  requests = [];
  sf = new SecondFactor({ apiKey: "sf_key.secret", baseUrl: base });
});

const route = (method, path, answer) => {
  routes[`${method} /v2/Services/${SERVICE}/${path}`] = answer;
};
const last = () => requests[requests.length - 1];

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof SecondFactorError, `expected SecondFactorError, got ${error}`);
    return error;
  }
  assert.fail("expected the call to throw");
}

describe("service lookup", () => {
  it("looks the service up once and reuses it", async () => {
    route("POST", "Verifications", [201, { sid: "VE1" }]);

    await sf.send("+9779841000001");
    await sf.send("+9779841000002");

    assert.equal(requests.filter((r) => r.path === "/v2/Services").length, 1);
    assert.equal(await sf.serviceSid(), SERVICE);
  });

  it("needs no lookup when the service is given", async () => {
    const given = new SecondFactor({ apiKey: "sf_key.secret", serviceSid: SERVICE, baseUrl: base });
    route("POST", "Verifications", [201, { sid: "VE1" }]);

    await given.send("+9779841000001");

    assert.deepEqual(requests.map((r) => r.path), [`/v2/Services/${SERVICE}/Verifications`]);
  });

  it("requires an API key", () => {
    assert.throws(() => new SecondFactor({}), TypeError);
  });
});

describe("the wire", () => {
  it("sends the key, the user agent and JSON without unset parameters", async () => {
    route("POST", "Verifications", [201, { sid: "VE1" }]);

    await sf.send("+9779841000001", { idempotencyKey: "click-1" });

    const { headers, body } = last();
    assert.equal(headers["x-api-key"], "sf_key.secret");
    assert.equal(headers["user-agent"], USER_AGENT);
    assert.equal(headers["content-type"], "application/json");
    assert.equal(headers["idempotency-key"], "click-1");
    assert.deepEqual(body, { To: "+9779841000001" });
  });
});

describe("verification sessions", () => {
  it("creates a hosted session", async () => {
    route("POST", "VerificationSessions", [201, { sid: SESSION.sid, url: "https://verify/#vst_x" }]);

    const session = await sf.createSession({
      to: "+9779841000001",
      returnUrl: "https://app.example.com/verified",
      clientReferenceId: "signup-8812",
    });

    assert.equal(session.url, "https://verify/#vst_x");
    assert.deepEqual(last().body, {
      To: "+9779841000001",
      Mode: "hosted",
      ReturnUrl: "https://app.example.com/verified",
      ClientReferenceId: "signup-8812",
    });
  });

  it("creates a headless session", async () => {
    route("POST", "VerificationSessions", [201, { sid: SESSION.sid, client_token: "vst_x" }]);

    const session = await sf.createSession({ to: "+9779841000001", mode: "headless" });

    assert.equal(session.client_token, "vst_x");
    assert.deepEqual(last().body, { To: "+9779841000001", Mode: "headless" });
  });

  it("throws the server's code and message for a refused create", async () => {
    route("POST", "VerificationSessions", envelope(400, "no_return_origin", "Add a return origin."));

    const error = await rejection(sf.createSession({ to: "+9779841000001", returnUrl: "https://app.example.com/" }));

    assert.equal(error.code, "no_return_origin");
    assert.equal(error.status, 400);
    assert.equal(error.message, "Add a return origin.");
  });

  it("confirms the stored sid and resolves with the proven phone", async () => {
    route("POST", `VerificationSessions/${SESSION.sid}/Confirm`, [200, SESSION]);

    const result = await sf.verifySession(SESSION.sid, "vsr_token");

    assert.deepEqual(result, { phone: "+9779841000001", clientReferenceId: "signup-8812", session: SESSION });
    assert.equal(last().method, "POST");
    assert.deepEqual(last().body, { ReturnToken: "vsr_token" });
  });

  it("sends no token for a headless confirm", async () => {
    route("POST", `VerificationSessions/${SESSION.sid}/Confirm`, [200, SESSION]);

    await sf.verifySession(SESSION.sid);

    assert.deepEqual(last().body, {});
  });

  for (const [status, code] of [
    [400, "missing_return_token"],
    [409, "not_verified"],
    [409, "already_confirmed"],
    [422, "invalid_return_token"],
    [404, "not_found"],
  ]) {
    it(`throws on a refused confirm (${code}) so nobody is signed in by mistake`, async () => {
      route("POST", `VerificationSessions/${SESSION.sid}/Confirm`, envelope(status, code));

      const error = await rejection(sf.verifySession(SESSION.sid, "vsr_token"));

      assert.equal(error.code, code);
      assert.equal(error.status, status);
    });
  }

  it("keeps a session id to one path segment", async () => {
    await rejection(sf.retrieveSession("../../Verifications"));

    assert.equal(last().path, `/v2/Services/${SERVICE}/VerificationSessions/..%2F..%2FVerifications`);
  });

  it("retrieves a session", async () => {
    route("GET", `VerificationSessions/${SESSION.sid}`, [200, SESSION]);

    assert.equal((await sf.retrieveSession(SESSION.sid)).status, "VERIFIED");
  });
});

describe("direct sends", () => {
  it("sends, then checks a right code", async () => {
    route("POST", "Verifications", [201, { sid: "VE1", status: "PENDING" }]);
    route("POST", "VerificationCheck", [200, { sid: "VE1", status: "VERIFIED" }]);

    const { sid } = await sf.send("+9779841000001");
    const result = await sf.check(sid, " 123456 ");

    assert.equal(result.verified, true);
    assert.deepEqual(last().body, { VerificationSid: "VE1", Code: "123456" });
  });

  it("answers a wrong code instead of throwing", async () => {
    route("POST", "VerificationCheck", [422, { sid: "VE1", status: "PENDING", attempts_remaining: 4 }]);

    const result = await sf.check("VE1", "000000");

    assert.equal(result.verified, false);
    assert.equal(result.attempts_remaining, 4);
  });

  for (const [status, code] of [["EXPIRED", "expired"], ["LOCKED", "locked"], ["VERIFIED", "already_verified"]]) {
    it(`throws ${code} for a verification that is ${status}`, async () => {
      route("POST", "VerificationCheck", [409, { sid: "VE1", status }]);

      const error = await rejection(sf.check("VE1", "123456"));

      assert.equal(error.code, code);
      assert.equal(error.status, 409);
    });
  }

  it("throws client_code for a code you supplied", async () => {
    route("POST", "VerificationCheck", envelope(409, "client_code"));

    assert.equal((await rejection(sf.check("VE1", "123456"))).code, "client_code");
  });

  it("throws a refused send with its code", async () => {
    route("POST", "Verifications", envelope(402, "insufficient_funds"));

    const error = await rejection(sf.send("+9779841000001"));

    assert.equal(error.code, "insufficient_funds");
    assert.equal(error.status, 402);
  });
});

describe("failures", () => {
  it("turns a non-JSON error page into a SecondFactorError", async () => {
    route("POST", "Verifications", [502, "<html>Bad gateway</html>"]);

    const error = await rejection(sf.send("+9779841000001"));

    assert.equal(error.code, null);
    assert.equal(error.status, 502);
  });

  it("turns no answer at all into a network error", async () => {
    const closed = new SecondFactor({ apiKey: "sf_key.secret", serviceSid: SERVICE, baseUrl: "http://127.0.0.1:9", timeoutMs: 1000 });

    const error = await rejection(closed.send("+9779841000001"));

    assert.equal(error.code, "network_error");
    assert.equal(error.status, null);
  });
});
