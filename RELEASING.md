# Releasing

Releases are published to npm under the package name `secondfactor` by the
`publish` GitHub Actions workflow. The workflow never runs on its own: a
maintainer starts it by hand from the Actions tab, and it publishes only from
`main`.

The one exception is the very first release, which is published by hand,
because npm cannot set up trusted publishing for a package that does not exist
yet.

## How the repository is protected

These settings live on GitHub rather than in this repository, so they are
recorded here. Keep them in place; the release process depends on them.

- **`main`** accepts changes only through a pull request whose `ci` check has
  passed on every tested Node.js major version (18, 20, 22, 24 and 26) against
  the latest `main`. Review threads must be resolved, approvals are dismissed
  by new pushes, and pull requests merge by squash or rebase only.
  Force-pushes and deletion are blocked, and nobody can bypass the rule.
- **Tags** cannot be moved or deleted once created, so a release tag always
  names the commit that was published. Nobody can bypass this rule either.
- **The `npm` environment** deploys only from `main` and waits for a required
  reviewer to approve each publish. Administrators cannot bypass the approval.
- **Actions** may use only GitHub's own actions, each pinned to a full commit
  SHA; GitHub enforces the pinning. Workflows from all outside contributors
  wait for approval before they run.
- **Releases** are immutable once published.
- **Secret scanning** with push protection, **Dependabot** alerts and security
  updates, and **private vulnerability reporting** are on. The wiki and
  projects are off, and merged branches are deleted.

## The first release, by hand

1. Use an npm account with two-factor authentication on, and log in:
   `npm login`.
2. Make sure `main` is green in CI, then publish from a clean checkout of it so
   that nothing local can end up in the package:

   ```bash
   git clone https://github.com/secondfactor/secondfactor-node.git
   cd secondfactor-node
   npm test
   npm pack --dry-run
   ```

   The list must be `index.js`, `index.d.ts`, `README.md`, `CHANGELOG.md`,
   `LICENSE` and `package.json`, and nothing else.
3. Publish: `npm publish`. npm asks for a one-time password.
4. Tag the published commit and push the tag:
   `git tag v<version> && git push origin v<version>`.

## Setting up trusted publishing, once

Do this straight after the first release, because a new trusted publisher
expires unless it completes its first successful publish within 2 days of
being created.

1. Tell npm to trust the workflow. Either open the package on npmjs.com, go to
   **Settings → Trusted publishing**, and add a GitHub Actions publisher with
   owner `secondfactor`, repository `secondfactor-node`, workflow
   `publish.yml` and environment `npm`; or run the following, which needs
   npm 11.15.0 or later and two-factor authentication on the account:

   ```bash
   npm trust github secondfactor --repo secondfactor/secondfactor-node \
     --file publish.yml --env npm --allow-publish
   ```

2. Under the package's **Settings → Publishing access**, choose **Require
   two-factor authentication and disallow tokens**. From then on, only the
   workflow can publish; no npm token for this package exists, and none should
   be created.
3. Release the next version with the workflow, as below, within the 2 days.

`package.json`'s `repository.url` must stay exactly
`git+https://github.com/secondfactor/secondfactor-node.git`; npm refuses a
trusted publish from any other repository.

## Each later release

1. Choose the version under [Semantic Versioning](https://semver.org/). Set it
   in **both** `package.json` (`version`) and `index.js` (`VERSION`); they must
   match, because `VERSION` is what the `User-Agent` header reports. The
   workflow refuses to publish when they differ.
2. Move the `unreleased` heading in `CHANGELOG.md` to the version and today's
   date.
3. Open a pull request titled `chore: release <version>` and merge it once
   `ci` is green.
4. Open **Actions → publish → Run workflow** and run it on `main`. The workflow
   runs the full test matrix again, checks that the two versions agree and
   that the version has not been tagged before, and packs the tarball.
5. Approve the `npm` deployment when GitHub asks. The workflow then publishes
   that exact tarball with a provenance attestation and creates the
   `v<version>` tag.
6. Create a GitHub release from the new tag, pasting the changelog section.
   Releases are immutable once published.

A published version can never be published again with different contents. If a
release is broken, deprecate it with `npm deprecate` and publish the next patch
version.
