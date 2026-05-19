# Security Policy

## Supported versions

patina is currently maintained from the `main` branch. Security fixes target the latest released version unless otherwise noted in the changelog.

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability.

Report privately by contacting the maintainer through GitHub security advisories if available, or by opening a minimal issue that asks for a private contact path without disclosing exploit details.

Useful details to include:

- affected version or commit;
- command or integration surface involved;
- minimal reproduction steps;
- whether the issue can expose credentials, files, prompts, or private text;
- suggested mitigation, if known.

## Scope

Security-sensitive areas include:

- CLI file handling;
- backend/provider invocation;
- prompt construction with untrusted text;
- install scripts;
- automation under `ops/`;
- any path that may expose local files, API keys, tokens, or private drafts.

## Non-security issues

False positives, rewrite quality, benchmark disagreements, and pattern proposals should use the normal GitHub issue templates instead of this policy.
