# Threat Model: omo 5.x (2026 Q4)

**Status:** Accepted for the 5.x hardening track. Maintained as the
canonical reference for every security-aware PR in the 2026 Q4 roadmap.
Subsequent PRs in the roadmap cite this document from their own per-area
writeups under `docs/security/`; reviewers should verify those writeups
stay in sync with the linked PRs and the open questions below.

**Reviewers:** route any change touching the surfaces listed in the
**Trust boundaries** section through the `security-review` skill
(`.agents/skills/security-review/`) once that skill lands. The
threat-model rows under **Threats** are the authoritative checklist
in either case: the skill is a convenience on top of those rows, not a
replacement. Reviewers should answer the per-row question in
**Risks & Residuals** for any PR that touches the listed surfaces;
coverage is a social norm, not a CI gate, and reviewers reserve the
right to request changes that close a listed threat.

## Overview

omo is an OpenCode plugin (Ultimate edition) shipped alongside its Codex
CLI Light edition (`packages/omo-codex/`, npm alias `lazycodex-ai`).
Both editions share the same JS/TS codebase and the same provider surface.
The plugin reads provider credentials, honors `{file:...}` references in
config, runs tools on the user's shell, and persists state under
`~/.omo/`. Each of those surfaces is a meaningful privilege on a
developer workstation. This document enumerates the threats the 2026 Q4
roadmap is hardening against, names the adversaries, and links each
mitigation to its owning PR and per-PR writeup.

The threat model is intentionally narrow: it covers the ten 2026 Q4
hardening PRs (PR-A through PR-J) and the surfaces those PRs touch.
Out of scope: cloud-managed deployments, browser automation, and any
PR outside the roadmap.

## Scope

In scope:

- File-reference resolution (`{file:...}` in `omo.json[c]`).
- Provider credential storage at rest (`~/.config/opencode/auth.json`
  and equivalents).
- Tool execution, including the per-tool permission gate.
- Setup-time server consent and config-file import.
- Plugin payload integrity (`dist/` of the npm artifact).
- Signal handling for the engine host.
- Home-directory permissions for omo-owned state.
- Telemetry default state.
- CLA / disclosure process for AI-generated contributions.

Out of scope (own documents elsewhere, cited for context only):

- The runtime fallback model (`docs/reference/features.md`).
- The prompt-async-gate reserve semantics
  (`docs/reference/prompt-async-gate-rfc.md`).
- OpenClaw gateway authentication
  (`docs/reference/omo-daemon.md`).
- Marketplace sync to `code-yeongyu/lazycodex`
  (`docs/reference/lazycodex-npm-reservation.md`).

## Trust boundaries

The plugin sits in a multi-harness, multi-user, multi-process model. The
boundaries below name who/what is trusted at each edge.

| Boundary | Trusted side | Untrusted side | Surface |
|---|---|---|---|
| Harness ↔ plugin | OpenCode, Claude Code, Codex (harness process) | Anything else in-process | `session.prompt`, `tool.execute.before`, `event` |
| Plugin ↔ user shell | Plugin | Shell, interactive processes, other users on the host | `bun`/`node` exec, `write-existing-file-guard` |
| Plugin ↔ local config | `omo.jsonc` user layer, Zod-validated, project layer subject to per-server consent (PR-D) | Project layers under user `~` before PR-D consent; raw `{file:...}` content | `loadPluginConfig`, `setup-opencode-assets.js` |
| Plugin ↔ fs secrets | `~/.config/opencode/`, user opt-in roots (`security.file_ref_allowlist_roots`) | `/proc`, `/sys`, `/dev`, `/etc/shadow`, `~/.ssh`, `~/.gnupg`, `~/.aws` and any path outside the allowlist | `resolveFileRef` |
| Plugin ↔ provider auth | OS-level user isolation (`chmod 600` / `chmod 700`), at-rest encryption opt-in | Other users on the host, OS-level backup snapshots | `auth-store.js` |
| Plugin ↔ telemetry state | OS-level user isolation, opt-in via first-run prompt (`chmod 600`) | Other users on the host (post first-run), read access via env vars | `posthog-client.ts`, `~/.omo/state/telemetry.json` |
| Plugin ↔ MCP server | Server chosen by user; config from `~/.mcp.json` (skill-embedded MCPs go through OAuth/PKCE) | Any other MCP server reachable over stdio/HTTP | `createBuiltinMcps`, `SkillMcpManager` |
| Engine ↔ plugin payload | `dist/` bytes that match the published sha256 | Any tampered byte on disk (post install, mid-update) | `plugin/.omo-payload.sha256` |
| Engine ↔ host signals | Engine supervisor | A misbehaving child holding a TTY | `bun-runtime.js`, `--mode rpc` |
| Repo contributor ↔ PR | Maintainer (CLA-signed, `will-review` label) | First-time fork contributors until maintainer approves workflow runs | `.github/workflows/cla.yml` |

The trusted side at each row is an assertion this document makes. Each
mitigation below tightens a specific row. `security.*` keys in
`omo.jsonc` are treated as user-layer-only (mirroring the loader row
under T-T2 below), so a project layer cannot silently widen
`security.file_ref_allowlist_roots`.

## Adversary model

Each adversary is named with the actor and their assumed capabilities.

### A1. Local interactive attacker

- **Actor:** Another user on the same host with shell access.
- **Capabilities:** Reads any file their UID can read; impersonates the
  user only if they have already compromised a higher-privileged
  process.
- **Goal:** Read the user's provider credentials, plugin state, or hook
  history.
- **Touchpoint:** `auth-store.js`, `~/.omo/*` permissions,
  `~/.config/opencode/auth.json` (third-party).

### A2. Untrusted repo or template

- **Actor:** A forked project, a `bunx oh-my-openagent install` against
  a copy-pasted `omo.jsonc`, or a project the agent reads with `read`.
- **Capabilities:** Sets `security.file_ref_allowlist_roots`, picks
  `{file:...}` paths, defines server URLs, drops `.mcp.json`.
- **Goal:** Convince the plugin to read a file outside the user's
  intent, or talk to a server of the attacker's choosing.
- **Touchpoint:** `setup-per-server.js`, `readFileRef`,
  `claude-code-mcp-loader`.

### A3. Network observer

- **Actor:** Anyone on the path between the user's machine and
  provider APIs (or `posthog`).
- **Capabilities:** Reads plaintext HTTP; reads plaintext DNS; cannot
  modify or replay without terminating upstream TLS.
- **Goal:** Discover model usage (timing + destination) or extract
  credentials from in-flight traffic.
- **Touchpoint:** Tier-2/3 MCP servers; telemetry; first-run prompt
  flow that exposes opt-in state.

### A4. Compromised MCP server or skill payload

- **Actor:** A skill-embedded MCP or a built-in MCP server that turns
  hostile (e.g. after a maintainer account compromise).
- **Capabilities:** Returns crafted `tool_result` payloads; speaks
  OAuth 2.0 + PKCE + DCR step-up to learn tokens.
- **Goal:** Trick the plugin into forwarding prompts or files to a
  remote endpoint, or use a stolen OAuth token.
- **Touchpoint:** `SkillMcpManager`, `mcp-oauth`, tier-3 OAuth.

### A5. Compromised published artifact

- **Actor:** Anyone who can modify bytes the user trusts at install
  (`dist/`, `bin/`, `postinstall.mjs`).
- **Capabilities:** Replaces tool implementations, hook handlers,
  config loaders; reads state at plugin start.
- **Goal:** Persist code that runs on every OpenCode launch with the
  user's full privilege.
- **Touchpoint:** `plugin/.omo-payload.sha256`; npm registry trust;
  OIDC provenance.

### A6. Misbehaving child process under `bun`

- **Actor:** A spawned tool, RPC host, or supervisor that ignores or
  mishandles signals.
- **Capabilities:** Holds the TTY open; ignores `TERM`; overruns its
  wall-clock budget.
- **Goal:** Stop the user from cleanly exiting OpenCode or reclaiming
  the terminal.
- **Touchpoint:** `bun-runtime-signal.test.ts` surface, `--mode rpc`,
  `--internal-rpc-host-supervisor`.

### A7. Untriaged AI-generated commit

- **Actor:** A first-time contributor PR carrying code that the human
  author did not author themselves end-to-end.
- **Capabilities:** Inherits the maintainer's review surface;
  introduces code the maintainer reads but cannot directly judge.
- **Goal:** Land code the maintainer would refuse if they had
  authored it.
- **Touchpoint:** CLA workflow disclosure.

## Asset inventory

| Asset | Why it matters | Where it lives |
|---|---|---|
| Provider API keys / OAuth tokens | Identity used by the harness to call Anthropic, OpenAI, OpenRouter, etc. | `~/.config/opencode/auth.json`, on disk; OAuth tokens in `~/.local/share/opencode/` after step-up |
| `{file:...}` secret files (referenced by config) | Plaintext secrets the plugin reads on demand | User-chosen paths; resolved by `readFileRef` |
| Plugin source / bundle | Code that runs in-process with provider tokens present | `dist/` of the npm artifact; `packages/omo-opencode/src/` in dev |
| `~/.omo/` state | Memory, tasks, teams, audit log, telemetry opt-in file | `~/.omo/{memory,tasks,teams,state,audit}/` per `AGENTS.md`; `~/.omo/desktop*` is the desktop app and must never be read or written by this plugin |
| Telemetry payloads | Usage events sent to PostHog when opted in | Post-PR-B: default off; opt-in via the first-run prompt or `OMO_SEND_ANONYMOUS_TELEMETRY=1`; one event per UTC day per host; state file at `~/.omo/state/telemetry.json` (mode 600). Pre-PR-B: default on, no state file |
| Skill-embedded MCP OAuth tokens | Access tokens granted to tier-3 MCPs after PKCE | Per-session, keyed `${sessionID}:${skillName}:${serverName}` in memory |
| CLA signatures | Provenance of every commit to `dev` | `signatures/cla.json` |
| Audit log of permission decisions | Forensics for `tools.<name>.permission` decisions | `packages/memory-core/src/audit/` |

## Threats

Threats are enumerated in STRIDE order. Each row lists the
pre-mitigation posture, the owning PR (with `Planned:` prefix where the
PR has not yet merged), the per-PR doc reference, and the residual
risk after that PR lands. Per-area docs are referenced by filename
that lands with the named PR; if the link would resolve today, it does,
otherwise the filename appears in backticks as a forward reference.

### Spoofing

- **T-S1. Provider confusion via cloned `auth.json`.**
  An attacker copies a victim's `auth.json` to a victim or a friend
  uses a stolen `auth.json` from a former employer. *Pre-mitigation:*
  The plugin reads whichever file is at the OS path; provenance is not
  tracked. *Planned control (PR-E):* `security.auth_at_rest: "plain" | "passphrase" | "ssh-key"`
  plus migration-on-read semantics; per-PR writeup
  `docs/security/auth-storage.md` (lands with PR-E).
  *Residual:* Plain mode remains the default for one cycle and is
  deprecated in `CHANGELOG.md`; users on plain still accept any key
  file.

- **T-S2. Impersonation of a built-in MCP server.**
  An attacker registers a same-named MCP server in `.mcp.json` ahead
  of the built-in. *Pre-mitigation:* the loader overwrites silently.
  *Mitigation:* no PR in scope; tracked under open questions.

- **T-S3. Skill-spoofing via YAML frontmatter.**
  A skill bundle declares a same-named tool as a built-in tool, hoping
  the loader picks it up first. *Pre-mitigation:* precedence is
  numeric (`SCOPE_PRIORITY`) and ranks user/project above built-in,
  so a malicious skill can shadow a built-in. *Planned control:* a
  reserved-name list at `tool-registry.ts` will reject shadow
  registrations. See OQ-2 for the open decision.

### Tampering

- **T-T1. Plugin payload tampered after publish.**
  An installer (or a hostile postinstall script) edits
  `dist/index.js` between download and first run. *Pre-mitigation:*
  No detection. *Planned control (PR-F):* `plugin/.omo-payload.sha256`
  is written at build, recomputed at runtime, mismatch refuses
  (`build-omo-native.ts` + `launcher.js`); a missing or unreadable
  hash file is treated as a mismatch (the launcher refuses to spawn
  rather than guessing). Per-PR writeup lands with PR-F. The sha256
  detects corruption (truncated downloads, partial rewrites) and
  detectable divergence between two `dist/` snapshots, but cannot
  defend against an attacker who can rewrite both `dist/` and the
  adjacent `plugin/.omo-payload.sha256`; anchored trust (npm
  integrity, signed bundles) is the durable control and is tracked
  as residual. *Residual:* a tampered publish (the registry serves
  altered bytes) is out of scope; A5 publish-time compromise is
  unmitigated.

- **T-T2. `omo.jsonc` project layer mutates trusted config.**
  A project `.omo/omo.jsonc` adds `mcp_env_allowlist`,
  `browser_automation_engine.playwright_mcp_args`, or
  `security.file_ref_allowlist_roots`, which are user-layer only by
  design. *Pre-mitigation:* the loader silently folded those keys.
  *Mitigation:* keys are enforced user-layer-only in `omo-config-core`;
  see the loader row in `AGENTS.md`. No PR in this roadmap (already
  merged). The `security.*` family in particular is the trust gate
  that prevents A2 from widening the file-ref allowlist.

- **T-T3. `~/.omo/audit/*` log file tampered with to hide a denial.**
  Audit-log writes are best-effort append-only. *Pre-mitigation:*
  No integrity check. *Planned control (PR-H):* `chmod 700` plus
  per-subdir audit (`packages/memory-core/src/store.ts`); per-PR
  writeup `docs/security/filesystem.md` (lands with PR-H).
  *Residual:* Without HMAC over the log file, a sufficiently
  privileged local attacker can rewrite history. Out of scope; see
  open questions.

- **T-T4. In-flight modification of plugin config by the harness.**
  The plugin's hook handlers run in-process with the harness and can
  be replaced by another plugin loaded earlier. *Pre-mitigation:*
  Duplicate-plugin detection warns but does not refuse.
  *Mitigation:* `detectDuplicateOmoPlugin()` in
  `packages/omo-opencode/src/shared/external-plugin-detector.ts`
  early-returns `{}` from `createPluginModule()` in
  `packages/omo-opencode/src/testing/create-plugin-module.ts` when a
  duplicate is detected. No PR in this roadmap (already merged).

### Repudiation

- **T-R1. A denied `tool.execute.before` decision leaves no trace.**
  An operator denies a write and forgets why. *Pre-mitigation:* No
  audit row. *Planned control (PR-C):* Every decision through the
  permission gate
  (`packages/omo-opencode/src/hooks/permission-gate/`) writes an audit
  row; per-PR writeup `docs/security/permissions.md` (lands with
  PR-C). *Residual:* Disk-only audit; not signed.

- **T-R2. An AI-assisted contributor authors a critical patch with no
  disclosure.** *Pre-mitigation:* No disclosure field on PRs.
  *Planned control (PR-I):* CLA workflow carries an AI-attribution
  checkbox; see PR-I's `CONTRIBUTING.md` diff. *Residual:*
  Informational only; no merge-gate today.

### Information disclosure

- **T-I1. `{file:/proc/self/environ}` exfiltrates env on demand.**
  Pre-mitigation: the resolver returned the raw bytes. *Planned
  control (PR-A):* `resolveFileRef` will return
  `{ refused, reason: "denied" }` for any path under `/proc`,
  `/sys`, `/dev`, `/etc/shadow`, `~/.ssh`, `~/.gnupg`, `~/.aws`;
  per-PR writeup `docs/security/file-references.md` (lands with
  PR-A). The path is canonicalised via `realpath` before the
  denylist test, so `/proc/../proc/self/environ` and bind-mounted
  aliases are caught. Symlink and mode checks are part of the same
  contract. *Residual:* Other paths with sensitive content still
  resolve if the user opted them into the allowlist (their choice).

- **T-I2. `~/.config/opencode/auth.json` readable on a shared host.**
  Plain-text at rest. *Planned control (PR-E):* at-rest encryption
  (passphrase or SSH-key derived); per-PR writeup
  `docs/security/auth-storage.md` (lands with PR-E). *Residual:*
  Plain mode stays the default for one release; documented deprecation
  only.

- **T-I3. Telemetry on by default leaks usage metadata.**
  *Current default:* PostHog events fire at plugin load because the
  client defaults to enabled today (PR-B changes this). *Planned
  control (PR-B):* first-run prompt will create
  `~/.omo/state/telemetry.json` with `chmod 600` after the user
  answers. The precedence between state file and env vars is held
  by the plugin loader. Headless default (no state file, no user
  input possible because the harness is non-interactive) is OFF.
  `OMO_DISABLE_POSTHOG=1` forces off. With a state file, the file's
  answer wins for the lifetime of the file. With no state file in
  an interactive session, the first-run prompt runs again on the
  next start. `OMO_SEND_ANONYMOUS_TELEMETRY=1` is a setting for the
  current process only (effective while the env var is set;
  non-persistent). PR-B's per-PR writeup lands on
  `docs/guide/telemetry.md` plus the `CHANGELOG.md` entry.
  *Residual:* the first-run prompt is the durable on-switch; the
  env var is non-persistent.

- **T-I4. Provider key reaches third-party tool output.**
  A tool returns the resolver's resolved bytes to the model.
  *Pre-mitigation:* tools may echo bytes from `readFileRef`.
  *Mitigation:* no PR in scope; tracked under open questions.

- **T-I5. OAuth token for tier-3 MCP shared across sessions.**
  Pre-mitigation: token persisted in memory but unstable across
  sessions. *Mitigation:* `SkillMcpManager` keys clients by
  `${sessionID}:${skillName}:${serverName}` so two sessions of the
  same skill do not share state (already merged). *Residual:* A
  token revoked in session A is not auto-revoked in session B until
  expiry.

### Denial of service

- **T-D1. A runaway subprocess blocks shutdown.**
  A child holds the terminal or ignores `TERM`. *Planned control
  (PR-G):* property-based signal suite
  (`packages/omo-native/test/bun-runtime-signal.test.ts`); see PR-G.
  *Residual:* Wall-clock budgets are per-mode; see open questions.

- **T-D2. Home directory growth via unbounded logs.**
  `oh-my-opencode.log` rotated at 50 MB. Already merged. No PR in scope.

- **T-D3. Telemetry opt-in state file grows unbounded.**
  Pre-PR-B, the file does not exist. *Planned control (PR-B):* one
  per-machine entry, replaced atomically on user answer; bounded at
  one entry total. *Residual:* the file's growth model is one
  answer per machine.

### Elevation of privilege

- **T-E1. Plugin reads `~/.ssh/id_rsa` via `{file:...}` then
  exfiltrates via tool call.** *Planned control (PR-A):* denylist
  prefix `~/.ssh` will be hardcoded and not allowlist-overridable.
  Symlinks pointing into `~/.ssh` will be refused with reason
  `"symlink"`. *Residual:* see T-I1.

- **T-E2. Setup script imports a server URL that bypasses consent.**
  `omo setup --yes` accepts all servers without per-server consent.
  *Planned control (PR-D):* per-server `Y/n` consent will appear in
  the interactive flow; `--yes` legacy batch will be preserved for
  scripted callers; per-PR writeup at `docs/guide/opencode-migrate.md`
  (lands with PR-D). *Residual:* `--yes` users opt out by design;
  scripted and CI installs inherit the project layer's server list
  unreviewed and rely on the maintainer-readable `--dry-run`
  provenance first. PR-D's `--dry-run` lists servers with full
  provenance so a CI author catches unexpected URLs before
  shipping.

- **T-E3. Another user reads `~/.omo/` state on a shared host.**
  Pre-mitigation: home dir was `chmod 0755` so another local user
  could read `~/.omo/*` (memo stores, tasks, audit). *Planned control
  (PR-H):* `~/.omo/` and each subdir will be `chmod 700` on first run,
  with an idempotent migration step that upgrades legacy `0755` dirs
  to `0700` (PR-H). *Residual:* Migration runs on plugin load; a
  host-level attacker who can read the dir before plugin load still
  can until first restart.

- **T-E4. Skill-embedded MCP gets OAuth permissions it doesn't need.**
  PKCE + DCR step-up scopes tokens per-skill; see
  `docs/reference/features.md`. *Residual:* A compromised skill
  with valid OAuth can still call whatever the user's provider
  permits.

## Mitigations

The per-PR writeups are the authoritative description of each
mitigation. The threat model is the index. The `Status` column uses
two values: `landed` (the mitigation is in the codebase today) and
`forward` (the mitigation lands with the named PR; the per-PR writeup
will be created by that PR). Filenames referenced in the `Doc` column
appear as plain filenames so a missing per-PR doc is detectable: a
`forward` row's filename still does not exist yet, a `landed` row's
filename must exist or the row is a bug.

| Surface | PR | Status | Doc |
|---|---|---|---|
| `{file:...}` resolver | PR-A | forward | `docs/security/file-references.md` |
| Telemetry first-run state | PR-B | forward | `docs/guide/telemetry.md` (existing) + `CHANGELOG.md` entry |
| Per-tool permission gate | PR-C | forward | `docs/security/permissions.md` |
| Per-server setup consent | PR-D | forward | `docs/guide/opencode-migrate.md` |
| `auth.json` at-rest encryption | PR-E | forward | `docs/security/auth-storage.md` |
| Plugin payload sha256 | PR-F | forward | PR-F commit message; launcher reads `plugin/.omo-payload.sha256` |
| Signal-forwarding property tests | PR-G | forward | `packages/omo-native/test/bun-runtime-signal.test.ts` |
| `~/.omo/` mode 700 + per-subdir audit | PR-H | forward | `docs/security/filesystem.md` |
| CLA AI attribution flag | PR-I | forward | `.github/workflows/cla.yml` + `CONTRIBUTING.md` "AI-generated commits" section |
| Threat model (this document) | PR-J | landed | `docs/security/threat-model.md` (this file) + `SECURITY.md` |

Rows whose `Doc` column points to a non-`docs/security/*.md` artifact
(PR-B `CHANGELOG.md`, PR-D migration guide, PR-F commit message, PR-G
test file, PR-I workflow + `CONTRIBUTING.md`) are listed by source of
truth because the plan assigns those surfaces to non-`docs/security`
docs. The `Status` column moves from `forward` to `landed` only in
the same commit that ships the referenced PR's diff; reviewers can
diff the row's `Status` against the merged roadmap PR list to spot
drift.

Reviewers should apply the `security-review` skill to every PR that
touches any of the files listed in that skill's trigger list once that
skill lands; until then, reviewers should inspect each row in
**Threats** that the PR's diff could close and answer the
corresponding question in the PR's **Risks & Residuals** section.

## Open questions

These are the items the 2026 Q4 roadmap does not resolve. Follow-up
PRs should pick these up explicitly.

- **OQ-1.** *Built-in MCP name collision.* Today the loader overwrites
  silently. Decision needed: refuse with an error or chain. See T-S2.
- **OQ-2.** *Reserved tool names for skill frontmatter.* A user-owned
  skill can shadow a built-in tool today. Decision needed:
  reserved-name list and rejection semantics. See T-S3.
- **OQ-3.** *Audit log integrity.* Best-effort append-only log means a
  local attacker with write access can rewrite. Decision needed: HMAC
  chain, signed append-only file, or `auditd`-forwarded trail.
  See T-T3.
- **OQ-4.** *Wall-clock budget per mode.* Signal tests exist but no
  top-level budget. Decision needed: who owns the timer.
  See T-D1.
- **OQ-5.** *Provider keys in tool outputs.* Today any tool can echo
  bytes from `readFileRef`. Decision needed: which tools may surface
  resolved secrets, and how to mark them. See T-I4.

## Update process

The threat model is owned by the maintainer. Edits go through a PR
that:

1. Touches one or more of the per-PR writeups under `docs/security/`
   in the same PR when the change re-shapes a mitigation.
2. Adds a row under **Open questions** if the change leaves a residual
   undefined.
3. Adds a row under **Threats** rather than rewriting existing rows
   when an old threat is reduced rather than removed; mark the
   original row `superseded by` rather than deleting it, so older PR
   bodies stay readable.
4. Updates the `Mitigations` table. The `Status` column moves from
   `forward` to `landed` only in the same commit that ships the
   referenced PR's diff. The `landed` row for PR-J (this document) is
   the only initial exception; every other row stays `forward` until
   that PR merges.

Per-PR writeups under `docs/security/` cite the threat-model rows
they address by their `T-*` ID; the reverse index lives in the
`security-review` skill (forthcoming; tracks
`.agents/skills/security-review/`).
