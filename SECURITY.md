# Security

## Report a vulnerability

Report suspected vulnerabilities privately through the **Security** tab of
[`code-yeongyu/oh-my-openagent`](https://github.com/code-yeongyu/oh-my-openagent/security/advisories/new)
("Report a vulnerability"). Please do **not** open a public issue, pull
request or discussion for a suspected vulnerability.

Any signed-in GitHub account can file a private advisory. If you found the
issue in a fork or a mirror, file it against this repository.

Include in the report:

- A description of the issue and the affected surface (a package under
  `packages/*`, a hook, an MCP, the installer, and so on).
- Reproduction steps or a minimal proof of concept.
- The version (release tag or commit SHA) and the edition you ran
  (`omo` / OmO Native, the OpenCode plugin, or the Codex edition).
- Any mitigations or workarounds you have already applied.

The GitHub Security tab is the only published contact. A private channel set
up any other way is not authoritative.

## Disclosure timeline

- We triage a private advisory within **seven days**: a first assessment and
  a disposition (accepted, needs more information, or not a vulnerability).
- We acknowledge every advisory within **fourteen days**, even when there is
  no fix or disposition yet.
- After triage, the fix plan, timeline and coordination happen in the GitHub
  advisory. Coordinated disclosure is the default: a fix ships before any
  public write-up.

If we have neither triaged the advisory within seven days nor acknowledged it
within fourteen days, you are free to publish at your discretion. We prefer
early coordination, but we do not ask you to wait past that point.

## Acknowledgements

The project does not run a paid bug bounty. Credit for responsibly disclosed
findings is published in the release notes at the maintainer's discretion.
