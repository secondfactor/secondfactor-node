# secondfactor.ai for Node.js

Verify phone numbers from your Node.js server with
[secondfactor.ai](https://secondfactor.ai). No dependencies; Node 18 or later.
Type declarations are included.

This library runs on **your server**. It holds your API key, which must never
reach a browser or a mobile app. For the browser or React Native side of
headless verification, use
[`@secondfactor/otp`](https://github.com/lambda-payments/secondfactor-js).

## Install

```bash
npm install @secondfactor/node
```

Until the first release is on npm, install it from this repository:

```bash
npm install github:lambda-payments/secondfactor-node
```

## Set up

From the secondfactor.ai dashboard you need an **API key** (API keys page). For
the hosted page you also need a **return origin**, such as
`https://app.example.com`, under **Settings → Hosted verification**.

```js
const { SecondFactor, SecondFactorError } = require("@secondfactor/node");
// or: import { SecondFactor, SecondFactorError } from "@secondfactor/node";

const sf = new SecondFactor({ apiKey: process.env.SECONDFACTOR_API_KEY });
```

## Hosted verification

Redirect the user to our page; we send the code, check it, and send them back.

```js
// 1. When the user reaches the step that needs a verified number.
const session = await sf.createSession({
  to: "+9779841000001",
  returnUrl: "https://app.example.com/verified",
  clientReferenceId: user.id,
});
req.session.sfSid = session.sid;            // keep it for this browser
res.redirect(303, session.url);

// 2. On https://app.example.com/verified?sf_session_id=…&sf_return_token=…
try {
  const { phone } = await sf.verifySession(req.session.sfSid, req.query.sf_return_token);
  await markPhoneVerified(user, phone);
} catch (error) {
  if (!(error instanceof SecondFactorError)) throw error;
  return startAgain(error.code);
}
```

**Always confirm the `sid` you stored**, never the `sf_session_id` from the URL:
anyone can edit a URL. `verifySession` succeeds once. A second call throws
`already_confirmed`, so a replayed return URL cannot sign anyone in.

## Headless verification

Draw the screens yourself. Your server creates the session and gives its token
to your frontend, which calls our session endpoints with
`@secondfactor/otp`. No proxy is needed, and your API key stays on your server.

```js
const session = await sf.createSession({ to: "+9779841000001", mode: "headless" });
req.session.sfSid = session.sid;
res.json({ clientToken: session.client_token });   // to your frontend

// When your frontend says the user is done:
const { phone } = await sf.verifySession(req.session.sfSid);   // throws unless VERIFIED
```

## Direct sends

Send a code and check what the user typed in your own form.

```js
const verification = await sf.send("+9779841000001", { idempotencyKey: crypto.randomUUID() });
const result = await sf.check(verification.sid, userInput);
if (result.verified) {
  // …
} else {
  showWrongCode(result.attempts_remaining);
}
```

Sending again to the same number is a new verification with a new `sid` and is
charged again. Pass a fresh `idempotencyKey` per user action so a retried
request is never charged twice.

## Errors

Every refused request throws `SecondFactorError` with:

- `code`: the string to branch on;
- `status`: the HTTP status, or `null` if no answer arrived;
- a message for your logs. Never show the message to your users.

| `code` | Thrown by | Meaning |
|---|---|---|
| `no_return_origin`, `origin_not_allowed` | `createSession` | Add the return URL's origin under Settings → Hosted verification. |
| `missing_return_token`, `invalid_return_token` | `verifySession` | The user did not finish verifying on this browser. Start again. |
| `not_verified` | `verifySession` | The session is open, cancelled, failed or expired. |
| `already_confirmed` | `verifySession` | Confirmed before; treat as a replay. |
| `expired`, `locked`, `already_verified` | `check` | This verification can never succeed. Send a new code. |
| `unroutable` | `send`, `createSession` | Not a valid E.164 number. |
| `rate_limited`, `burst` | `send` | Too many codes to this number. Try later. |
| `insufficient_funds` | `send` | Top up your balance. |
| `network_error` | any | secondfactor.ai could not be reached, or the request timed out. |

The full list is in the [API reference](https://secondfactor.ai/docs).

## Options

| Option | Default | |
|---|---|---|
| `apiKey` | — | Required. |
| `serviceSid` | looked up | Your Service SID (`VA…`). Looked up once on first use when omitted. |
| `baseUrl` | `https://api.secondfactor.ai` | |
| `timeoutMs` | `10000` | Per request. |
| `fetch` | `globalThis.fetch` | Supply your own, for example to add tracing. |

## Example

[`examples/express.js`](examples/express.js) is a runnable Express app with both
flows.

## Development

```bash
npm test
```

The tests run against a local stub of the API and need no network or key.

## License

MIT
