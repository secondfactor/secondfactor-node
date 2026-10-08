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
const util = require("node:util");

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

/**
 * The stub records every request and answers from `routes`.
 *
 * A route maps `"METHOD /path"` to `[status, body]`, or to
 * `[status, body, headers]` when the answer needs extra headers such as a
 * redirect's `Location`. A string body is sent as it is, to imitate a proxy's
 * HTML error page. A function takes over the raw response instead, so a test
 * can answer slowly or not at all. Anything unrouted is a 404 in the API's
 * error envelope.
 */
before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      const answer = routes[`${req.method} ${req.url}`] || envelope(404, "not_found");
      if (typeof answer === "function") return answer(res);
      const [status, payload, headers = {}] = answer;
      res.writeHead(status, { "Content-Type": typeof payload === "string" ? "text/html" : "application/json", ...headers });
      res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

// Tests that never answer leave connections open, which would keep the server
// from closing.
after(() => {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
});

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

  it("keeps a given service sid to one path segment", async () => {
    const given = new SecondFactor({ apiKey: "sf_key.secret", serviceSid: "../../x", baseUrl: base });

    await rejection(given.send("+9779841000001"));

    assert.equal(last().path, "/v2/Services/..%2F..%2Fx/Verifications");
  });

  it("keeps a looked-up service sid to one path segment", async () => {
    routes["GET /v2/Services"] = [200, { services: [{ sid: "../../x" }] }];

    await rejection(sf.send("+9779841000001"));

    assert.equal(last().path, "/v2/Services/..%2F..%2Fx/Verifications");
  });

  it("throws a SecondFactorError when the lookup finds no service", async () => {
    routes["GET /v2/Services"] = [200, { services: [] }];

    const error = await rejection(sf.send("+9779841000001"));

    assert.equal(error.code, "invalid_response");
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

describe("transport security", () => {
  // The API key must only ever travel to the API, and only encrypted.

  for (const status of [301, 302, 303, 307, 308]) {
    it(`refuses a ${status} redirect and never follows it`, async () => {
      // fetch would otherwise follow it, and it strips only Authorization on
      // a cross-origin redirect: X-API-Key would be resent to whatever host
      // the Location names, even over plain HTTP.
      route("POST", "Verifications", [status, "", { Location: `${base}/elsewhere` }]);

      const error = await rejection(sf.send("+9779841000001"));

      assert.equal(error.status, status);
      assert.ok(!requests.some((r) => r.path === "/elsewhere"), "the redirect was followed");
    });
  }

  it("refuses a base URL without TLS unless it is this machine", () => {
    for (const baseUrl of [
      "http://api.secondfactor.ai",
      "http://10.0.0.5",
      "http://localhost.example.com",
      "ftp://api.secondfactor.ai",
      "file:///etc/passwd",
      "api.secondfactor.ai",
      "https://",
      "",
    ]) {
      assert.throws(() => new SecondFactor({ apiKey: "sf_key.secret", baseUrl }), TypeError, baseUrl);
    }

    for (const baseUrl of [
      "https://api.secondfactor.ai",
      "https://api.secondfactor.ai/",
      "http://localhost:8000",
      "http://127.0.0.1:8000",
      "http://[::1]:8000",
    ]) {
      new SecondFactor({ apiKey: "sf_key.secret", baseUrl });
    }
  });
});

describe("the API key stays secret", () => {
  it("is not shown when the client is inspected, logged or serialized", () => {
    const client = new SecondFactor({ apiKey: "sf_key.secret", baseUrl: base });

    for (const shown of [util.inspect(client, { showHidden: true, depth: Infinity }), JSON.stringify(client), String(client)]) {
      assert.ok(!shown.includes("sf_key.secret"), shown);
    }
  });

  it("refuses a key that could not be sent as a header, without repeating it", () => {
    // fetch would throw an error that quotes the whole header value, key
    // included, and that message would end up in a SecondFactorError.
    for (const apiKey of ["sf_key.se\ncret", "sf_key.se\0cret", "sf_key.se cret", "sf_key.sé€cret", 42]) {
      assert.throws(
        () => new SecondFactor({ apiKey, baseUrl: base }),
        (error) => error instanceof TypeError && !error.message.includes("cret"),
      );
    }
  });

  it("is removed from a network error's message", async () => {
    const leaky = new SecondFactor({
      apiKey: "sf_key.secret",
      serviceSid: SERVICE,
      baseUrl: base,
      fetch: async (url, init) => {
        throw new Error(`could not send ${init.headers["X-API-Key"]}`);
      },
    });

    const error = await rejection(leaky.send("+9779841000001"));

    assert.equal(error.code, "network_error");
    assert.ok(!error.message.includes("sf_key.secret"), error.message);
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

  for (const status of ["OPEN", "EXPIRED", "verified", null, undefined]) {
    it(`signs nobody in on a successful confirm whose status is ${status}`, async () => {
      // Defence in depth: even a 2xx must say the session is verified before
      // a phone number is handed back to sign someone in with.
      route("POST", `VerificationSessions/${SESSION.sid}/Confirm`, [200, { ...SESSION, status }]);

      const error = await rejection(sf.verifySession(SESSION.sid, "vsr_token"));

      assert.equal(error.code, "not_verified");
      assert.equal(error.status, null);
    });
  }

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

  for (const [what, body] of [["is not JSON", "<html>OK</html>"], ["is JSON null", "null"], ["is cut short", '{"sid":']]) {
    it(`turns a successful answer whose body ${what} into a SecondFactorError`, async () => {
      route("POST", `VerificationSessions/${SESSION.sid}/Confirm`, (res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
      });

      const error = await rejection(sf.verifySession(SESSION.sid, "vsr_token"));

      assert.equal(error.code, "invalid_response");
      assert.equal(error.status, null);
    });
  }

  it("gives up on a server that never answers", async () => {
    const slow = new SecondFactor({ apiKey: "sf_key.secret", serviceSid: SERVICE, baseUrl: base, timeoutMs: 200 });
    route("POST", "Verifications", () => {});

    const error = await rejection(slow.send("+9779841000001"));

    assert.equal(error.code, "network_error");
    assert.equal(error.status, null);
  });

  it("gives up on a server that stops halfway through its answer", async () => {
    // The timeout must cover reading the body too, or a stalled answer would
    // hang the caller, or be taken for an empty success.
    const slow = new SecondFactor({ apiKey: "sf_key.secret", serviceSid: SERVICE, baseUrl: base, timeoutMs: 200 });
    route("POST", `VerificationSessions/${SESSION.sid}/Confirm`, (res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write('{"sid":');
    });

    const error = await rejection(slow.verifySession(SESSION.sid, "vsr_token"));

    assert.equal(error.code, "network_error");
    assert.equal(error.status, null);
  });

  it("turns no answer at all into a network error", async () => {
    const closed = new SecondFactor({ apiKey: "sf_key.secret", serviceSid: SERVICE, baseUrl: "http://127.0.0.1:9", timeoutMs: 1000 });

    const error = await rejection(closed.send("+9779841000001"));

    assert.equal(error.code, "network_error");
    assert.equal(error.status, null);
  });
});
