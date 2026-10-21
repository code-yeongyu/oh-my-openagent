# Security

## Threat model

The canonical threat model lives at
[`docs/security/threat-model.md`](docs/security/threat-model.md).
It enumerates the trust boundaries, adversary model, asset inventory,
threats (STRIDE), and per-PR mitigations that protect omo 5.x.

Per-area writeups under `docs/security/` (file references, permissions,
auth storage, filesystem permissions) cite the threat-model rows they
address and are listed in the threat model's **Mitigations** table.
Rows marked `forward` in that table refer to a writeup that lands with
a specific roadmap PR; rows marked `landed` are already in the
codebase. A truly broken link (a row marked `landed` with a missing
file) is a bug and should be filed as one.

## Report a vulnerability

Use the GitHub **Security** tab on the
[`code-yeongyu/oh-my-openagent`](https://github.com/code-yeongyu/oh-my-openagent)
repository to file a private security advisory. Please do **not**
open a public issue for suspected vulnerabilities until coordinated.

Include in the report:

- A description of the issue and the affected surface (`packages/*`,
  hooks, MCPs, installer, etc.).
- Reproduction steps or a minimal PoC.
- The version (commit SHA or release tag) and harness
  (`opencode`, `codex`, `senpi`).
- Any known mitigations or workarounds the user has already applied.

The GitHub Security tab is the only disclosed contact. A separate
maintainer-private channel is not published; private channels
established ad-hoc are not authoritative.

GitHub private advisories are open to any signed-in GitHub account on
the canonical repository `code-yeongyu/oh-my-openagent`. A reporter on
a fork or mirror files the advisory against the canonical repository;
the advisory then belongs to the maintainer of `code-yeongyu/oh-my-
openagent`. If the canonical repository itself cannot accept
advisories (org-level setting off), the reporter waits the ninety-day
window in **Disclosure timeline** before publishing publicly.

## Disclosure timeline

The maintainer triages private advisories within seven days and
acknowledges receipt within fourteen days. Both commitments are
distinct: a triage in seven days is an analysis-and-disposition
note; an acknowledgment in fourteen days is a no-fix-no-disposition
response. After triage, the disclosure timeline and coordination
channel are set in the GitHub advisory. Coordinated disclosure is the
default; a public fix lands before any public write-up.

Either commitment failing is enough to release the reporter from the
default coordination request. If the maintainer does not triage
within seven days and does not acknowledge within fourteen days, the
reporter is free to publish a write-up at their discretion. The
maintainer prefers early coordination but does not require it past
this combined wait.

## Acknowledgements

The project does not run a paid bug-bounty program. Credit for
responsibly disclosed findings is published in the release notes at
the maintainer's discretion.
