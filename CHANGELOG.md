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
