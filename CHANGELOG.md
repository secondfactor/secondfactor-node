# Changelog

All notable changes to this package are recorded here. The project follows
[Semantic Versioning](https://semver.org/); while the version is below 1.0.0, a
minor release may change behaviour, and every such change is listed.

## 0.1.0 — unreleased

The first release.

- Verification sessions: `createSession`, `retrieveSession` and
  `verifySession`, for the hosted page and headless mode.
- Direct sends: `send` (with an optional `idempotencyKey`) and `check`.
- `SecondFactorError` with a stable `code` and the HTTP `status`.
- A `User-Agent` of `secondfactor-node/<version>` on every request.
- Type declarations.

### Security

- Redirects are refused rather than followed. `fetch` follows them by default
  and strips only `Authorization` when one crosses origins, so it would resend
  `X-API-Key` to whatever host a redirect names, over plain HTTP too. A
  redirect now throws `SecondFactorError` with the redirect's 3xx `status`.
- `baseUrl` must use `https://`. Plain `http://` is accepted only for
  `localhost`, `127.0.0.1` and `[::1]`, so the key never crosses a network
  unencrypted. Any other value, or one without a host, throws `TypeError` from
  the constructor.
- `verifySession` throws `SecondFactorError` with `code` `not_verified` and
  `status` `null` unless the confirmed session's status is `VERIFIED`, even on
  a successful answer.
- A `serviceSid` passed in, or looked up, is encoded as a single path segment
  like every other identifier, so a value such as `../../x` cannot point a
  request carrying the key at another path.
- The API key is kept in a private field, so it no longer appears when the
  client is logged, inspected with `util.inspect` or serialized with
  `JSON.stringify`. The client no longer has a public `apiKey` property.
- An `apiKey` that is not visible ASCII, such as one with a stray newline from
  an environment file, throws `TypeError` from the constructor without
  repeating the key. `fetch` would otherwise have thrown an error quoting the
  key, which became part of a `SecondFactorError` message meant to be safe to
  log. A network error's message also has the key cut out, whatever `fetch`
  implementation is used.
- A successful answer whose body is not a JSON object, including one cut
  short, throws `SecondFactorError` with `code` `invalid_response` instead of
  resolving with an empty object. A service lookup that lists no service
  throws the same code instead of a `TypeError`.
- An answer that stalls halfway through its body is abandoned at the timeout
  as before, but now throws `network_error` rather than resolving with an
  empty object.
