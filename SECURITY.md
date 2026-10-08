# Security policy

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues,
discussions or pull requests.

Report them privately through GitHub instead: open the **Security** tab of this
repository and choose **Report a vulnerability**. Include the affected version,
a description of the issue, and the steps to reproduce it.

We will acknowledge the report, keep you informed while we work on a fix, and
credit you in the release notes unless you would prefer not to be named.

## Supported versions

Security fixes are released for the latest published version only.

## Verifying a release

Apart from the very first version, which npm requires to be published by hand
before trusted publishing can be set up, every release is packed and published
by the `publish` workflow in this repository through npm trusted publishing.
No npm token exists for the package, and releases are never uploaded from a
personal machine.

Each release published by the workflow carries an npm provenance attestation
that links the tarball to the exact workflow run and commit that produced it.
The npm page for each version shows it under **Provenance**, and you can check
every package you have installed with:

```bash
npm audit signatures
```
