# Releasing

Releases are published by hand from this repository to npm as
`secondfactor`. Only the package's maintainers on npm can publish; the
`@secondfactor` npm organization that owns the browser client
(`@secondfactor/js`) should be added as an owner too, so access is managed in
one place.

## One-time setup

1. Have an npm account with two-factor authentication on, listed as a
   maintainer of `secondfactor` (`npm owner ls secondfactor`).
2. `npm login`

## Each release

1. Make sure `main` is green in CI and `npm test` passes locally.
2. Choose the version under [Semantic Versioning](https://semver.org/). Set it
   in **both** `package.json` (`version`) and `index.js` (`VERSION`); they must
   match, because `VERSION` is what the `User-Agent` header reports.
3. Move the `unreleased` heading in `CHANGELOG.md` to the version and today's
   date.
4. Commit: `chore: release <version>`.
5. Check exactly what will be published: `npm pack --dry-run`. The list must be
   `index.js`, `index.d.ts`, `README.md`, `CHANGELOG.md`, `LICENSE` and
   `package.json`, and nothing else.
6. Publish: `npm publish`.
7. Tag and push: `git tag v<version> && git push origin main v<version>`.
8. Create a GitHub release from the tag, pasting the changelog section.

A published version can never be published again with different contents. If a
release is broken, deprecate it with `npm deprecate` and publish the next patch
version.
