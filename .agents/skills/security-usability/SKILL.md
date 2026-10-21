---
name: security-usability
description: "Run this when adding a security control to omo. Ensure the change has a journey in docs/security/usability.md, a section in `omo doctor --explain-security`, and a failure message that names the fix. Use whenever a PR touches auth-store.js, setup-opencode-assets.js, setup-per-server.js, launcher.js, agent-dir.js, the plugin payload, the tool permission schema, the security.* config keys, or anything under docs/security/."
---

# Security usability

A security control nobody can find is not adopted. This is the checklist for a PR that adds one:
the control itself is somebody else's job, these three surfaces are the deliverable nobody else
writes for you.

## The checklist

Answer all five. A blank answer is the work item.

1. **Does the control have a journey?** A reader who hits the behavior for the first time has to
   find one section in `docs/security/usability.md` that says what they do, the command, and the
   output. If the change has no user-visible behavior at all (a test-only safety net, a doc-only
   writeup), say so in the PR body instead of writing an empty section.

2. **Does `omo doctor --explain-security` have a section for it?** Add it to
   `SECURITY_EXPLAIN_SECTIONS` in `packages/omo-native/bin/lib/doctor-security-explain.js`, or
   replace an existing section's `pendingReader` with a reader of your feature's real data source.
   The section prints the effective state, not whether the feature exists. Keep the heading, the
   `setting:` line and the ordering; those are the contract the other nine sections are read
   against.

3. **Does every refusal name the fix?** A refused or denied path answers three things: what was
   refused (server, file, tool), why (denylist prefix, allowlist, mode, symlink), and the smallest
   change that unblocks it. "Access denied" fails this. A copy-pasteable command is better than a
   sentence.

4. **Is the default discoverable without reading the threat model?** If a user has to read a design
   document to learn that a control exists, the control is undiscovered. The section from (2) plus
   a line in the section from (1) is the minimum.

5. **Does the refusal fail closed?** The default is the safe state. A new control that is off until
   a user opts in must say so in its own section rather than being indistinguishable from a
   control that does not exist yet.

## Which command the section hooks into

| The control changes | The section's data source |
| --- | --- |
| what omo may read off disk | `~/.omo/omo.json[c]` `security.*` values, plus the resolved canonical path of each |
| what omo sends anywhere | the per-machine state file and the environment overrides, with the override that is winning |
| what omo asks the user | the configured permission for each tool, with the count of `ask` and `deny` |
| what omo stores | the on-disk form of the store and the mode that produced it |
| what omo installed | the on-disk value and the value recomputed from the payload |
| what the user must disclose | the file and the field that carries the record |

A section whose feature has not landed keeps its heading and prints `feature pending: see PR-<x>`
in the body. That is deliberate: an install can then tell "off" apart from "not shipped yet", which
is the difference between a control the user chose and a control they do not have.

## Rules

- Plain prose, never JSON. This command is read by a person deciding whether to trust an install.
- Read state, never write it. A diagnostics surface that mutates the thing it diagnoses is a
  second thing to trust.
- Never throw. An unreadable directory is reported as a line, not raised; a surface that dies on
  one bad file answers no questions about the rest.
- One section per control. Two controls that always change together are one section.
- The heading and the `setting:` line are load-bearing. Downstream sections are diffed against
  them, so a rename here is a breaking change to the other PRs in flight.
- A default change writes a `CHANGELOG.md` entry and a sentence in the matching
  `docs/guide/*.md` or `docs/reference/*.md`.

## Related

- `docs/security/usability.md` is the guide this checklist protects.
- `docs/reference/cli.md` carries the flag table; cross-cutting rule 4 of the security roadmap
  requires a new flag to appear there and in the launcher's `--help` before merge.
- `assets/omo.jsonc.example` is the shipped example; a new top-level key under `security.*` gets
  a commented entry there with its documented default.