# Security journeys

Where a security control changes something you do, this is the page. Each section is one
journey: what you do, the exact command, and the output a real install prints.

Every section here has a matching section in `omo doctor --explain-security`. Run that first when
you do not know which journey you are in; it prints the effective state of every control, and a
section whose control is not in your build says `feature pending: see PR-<letter>` instead of
silently reporting nothing.

A section marked **not in this build yet** describes a control the roadmap has not merged. The
command and the output are real; the control's own output line arrives with its release.

Search a section by the key it configures. The intro line of every section ends with the
`omo.jsonc` key or environment variable that carries it.

- [Placing secrets outside the opencode home](#placing-secrets-outside-the-opencode-home): `security.file_ref_allowlist_roots`
- [First interactive run: the telemetry prompt](#first-interactive-run-the-telemetry-prompt): `telemetry.enabled`, `OMO_SEND_ANONYMOUS_TELEMETRY`, `OMO_DISABLE_POSTHOG`
- [Asking only once per session per file path](#asking-only-once-per-session-per-file-path): `tools.<name>.permission`
- [Reviewing every server before importing](#reviewing-every-server-before-importing): `security.server_consent_opt_out`
- [Choosing an auth-at-rest mode and migrating](#choosing-an-auth-at-rest-mode-and-migrating): `security.auth_at_rest`
- [Why omo is asking you to reinstall](#why-omo-is-asking-you-to-reinstall): `plugin/.omo-payload.sha256`
- [Why omo's home directory got tighter](#why-omos-home-directory-got-tighter): `~/.omo` directory mode `0700`
- [What the AI-assisted checkbox in the PR template means](#what-the-ai-assisted-checkbox-in-the-pr-template-means): the pull request AI-assisted checkbox

## Placing secrets outside the opencode home

`omo setup` reads a provider key through a `{file:...}` reference so the token never lands in a
config file. The directory that reference may resolve under is `security.file_ref_allowlist_roots`,
which ships as `~/.config/opencode` and which you extend with a directory of your own. A secret
that lives outside the opencode home stays there: add the directory, do not move the secret.

**Not in this build yet.** The allowlist key and the refusal land with PR-A; until then every
`{file:...}` reference resolves as it always has and nothing is refused.

```console
$ omo doctor --explain-security
omo security explain
  omo home: ~/.omo (present)
  agent dir: ~/.omo/agent (present)
  sections: 8 (0 live, 8 pending)

file-ref-allowlist-roots
  setting: security.file_ref_allowlist_roots (default ~/.config/opencode)
  feature pending: see PR-A

$ mkdir -p ~/.config/opencode/secrets
$ printf '%s' "$ANTHROPIC_API_KEY" > ~/.config/opencode/secrets/anthropic
$ chmod 600 ~/.config/opencode/secrets/anthropic
$ ls -l ~/.config/opencode/secrets/
-rw-------  1 you  you  51  Oct 21 09:14 anthropic
```

`chmod 600` is not decoration. The shipped root is the one directory omo allowlists, and a
world-readable file inside it is a secret on a shared machine.

To keep the secret somewhere else, name that directory in the user layer
(`~/.omo/omo.jsonc`) rather than the project layer, so the path is never committed:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
  "security": {
    "file_ref_allowlist_roots": ["~/.config/opencode", "/path/to/my/secret-store"],
  },
}
```

A copy of that file with every documented default, and the ones commented out with the reason,
is in [`assets/omo.jsonc.example`](../../assets/omo.jsonc.example). Prefixes omo refuses whatever
this list says are `/proc`, `/sys`, `/dev`, `/etc/shadow`, `~/.ssh`, `~/.gnupg` and `~/.aws`:
adding one of those is not a way to reach it.

## First interactive run: the telemetry prompt

The first interactive `omo` asks once whether anonymous usage statistics may be sent, and writes
the answer to a per-machine file rather than asking again. The switch is `telemetry.enabled`, and
two environment variables override the file for a single run.

**Not in this build yet.** The prompt and the off-by-default switch land with PR-B.

```console
$ omo doctor --explain-security
...
telemetry
  setting: telemetry.enabled, OMO_SEND_ANONYMOUS_TELEMETRY, OMO_DISABLE_POSTHOG
  feature pending: see PR-B

$ cat ~/.omo/state/telemetry.json
{
  "enabled": false,
  "decidedAt": "2026-10-21T09:14:22.104Z"
}
$ ls -l ~/.omo/state/telemetry.json
-rw-------  1 you  you  47  Oct 21 09:14 telemetry.json

$ OMO_DISABLE_POSTHOG=1 omo doctor
```

`OMO_SEND_ANONYMOUS_TELEMETRY=1` turns it on for a run and `OMO_DISABLE_POSTHOG=1` turns it off
regardless of what the file says. The file is mode 600 because it records a decision about your
machine; no other per-machine state is written by the prompt.

## Asking only once per session per file path

A tool set to ask stops before it runs, so `tools.<name>.permission: "ask"` is the setting that
makes a tool confirm rather than proceed. The confirmation is scoped to one tool and one target
path for the life of the session, so a tool that reads five files in one directory asks once.

**Not in this build yet.** The permission profile and its audit log land with PR-C.

```console
$ omo doctor --explain-security
...
tool-permission-profile
  setting: tools.<name>.permission = allow | ask | deny
  feature pending: see PR-C

$ cat ~/.omo/omo.jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
  "tools": {
    "bash": { "permission": "ask" },
    "read": { "permission": "allow" },
    "webfetch": { "permission": "deny" },
  },
}

$ omo doctor --explain-security
...
tool-permission-profile
  setting: tools.<name>.permission = allow | ask | deny
  ask: 1 (bash)
  deny: 1 (webfetch)
  audit log: ~/.omo/audit/tool-permissions.jsonl
```

`deny` wins over `allow` when the two conflict for the same tool, so a name you meant to relax
cannot re-open a tool you meant to close. Every decision is appended to the audit log the section
names, so a surprising call can be traced after the fact instead of guessed at.

## Reviewing every server before importing

`omo setup` detects MCP servers and imports them. The interactive run asks once per server and
shows where each one came from, so a server you did not expect has to be accepted on purpose. The
opt-out scopes are `security.server_consent_opt_out`, at three widths.

**Not in this build yet.** Per-server consent and the opt-out scopes land with PR-D.

```console
$ omo doctor --explain-security
...
server-consent
  setting: security.server_consent_opt_out = server | kind | source
  feature pending: see PR-D

$ omo setup
Import 3 detected servers?
  context7    kind: remote   source: https://mcp.context7.com/mcp
  grep_app    kind: remote   source: https://grep.app/mcp
  my-lsp      kind: stdio    source: file ~/.config/opencode/servers/lsp.json
Import context7? [y/N]
Import grep_app? [y/N]
Import my-lsp? [y/N] y
```

The three opt-out scopes, narrowest last:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
  "security": {
    "server_consent_opt_out": [
      { "server": "grep_app" },
      { "kind": "stdio" },
      { "source": "file ~/.config/opencode/servers/lsp.json" },
    ],
  },
}
```

A server name, a kind, or the file a definition came from. `omo setup --yes` keeps the batch
behavior it has always had, so a scripted caller is not made interactive.

## Choosing an auth-at-rest mode and migrating

`security.auth_at_rest` chooses how `<agent dir>/auth.json` is protected: `"plain"`,
`"passphrase"` or `"ssh-key"`. It ships as `"plain"`. An existing plaintext file is not rewritten
on the spot; it is migrated the next time omo writes it.

**Not in this build yet.** Encryption and migrate-on-read land with PR-E.

```console
$ omo doctor --explain-security
...
auth-at-rest
  setting: security.auth_at_rest = plain | passphrase | ssh-key
  feature pending: see PR-E

$ cat ~/.omo/omo.jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
  "security": { "auth_at_rest": "passphrase" },
}

$ omo doctor
...
auth at rest: mode passphrase
  store: ~/.omo/agent/auth.json (encrypted, migrated from plaintext on the previous write)
  wrong passphrase: refused, nothing written
```

`"plain"` is deprecated in the release that adds this key; a later release changes the default,
so set the mode explicitly rather than relying on it. The doctor line is what tells you which of
the three the store is actually in, rather than which one the config asks for.

## Why omo is asking you to reinstall

omo hashes the plugin payload it ships and re-computes that hash before it starts the engine. A
mismatch means the files on disk are not the files the release published, so the launcher refuses
to start and prints the reinstall command. The hash it compares against is `plugin/.omo-payload.sha256`.

**Not in this build yet.** The integrity check and its refusal land with PR-F.

```console
$ omo doctor
FAIL plugin payload: sha256 mismatch
  expected: 6f1c1f0f0e2b2a6c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c
  actual:   91b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c
  a partial extraction, a truncated download, or an edited plugin directory changed it
  fix: run `bunx oh-my-openagent install` again

$ bunx oh-my-openagent install
$ omo doctor
PASS plugin payload: sha256 matches (6f1c1f0f0e2b2a6c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c)
```

The refusal is deliberate and exits non-zero without spawning the engine: a payload that does not
match what was published is not a payload worth starting.

## Why omo's home directory got tighter

omo restricts `~/.omo` to your own account, mode `0700`, on every directory it creates under it. An
install created before that rule may still be `0755`; the first start after the upgrade tightens
it and writes a line saying so.

**Not in this build yet.** The mode enforcement and its migration log line land with PR-H.

```console
$ omo doctor
INFO home mode: tightened ~/.omo from 0755 to 0700
INFO home mode: tightened ~/.omo/agent from 0755 to 0700

$ ls -ld ~/.omo ~/.omo/agent
drwx------  1 you  you  4096  Oct 21 09:14 /home/you/.omo
drwx------  1 you  you  4096  Oct 21 09:14 /home/you/.omo/agent
```

The migration is idempotent: a second start finds nothing to change and prints nothing. If a
directory is already `0700` and owned by you, it is left exactly as it is.

## What the AI-assisted checkbox in the PR template means

The pull request template asks whether an agent wrote part of the change, and the CLA bot records
the answer next to the signature. The checkbox covers the code in the pull request: writing,
reviewing or rewriting it. It is not a judgment about the change.

**Not in this build yet.** The template checkbox and the bot-side record land with PR-I.

```console
$ gh pr create --title "fix(cli): answer --explain-security on an empty home"
? AI-assisted? [y/N] y
? Which parts? [code/docs/tests]
```

Tick it when an agent produced code, tests or documentation that went into the diff. Answering
`N` and having ticked it, or the reverse, is the CLA assistant's problem and not the maintainer's
review burden; the point of the question is that the record is accurate.

## Where this goes next

- [`docs/security/usability.md`](usability.md) is this page. Each control's own PR appends its
  section here and replaces its pending marker in `omo doctor --explain-security`.
- The threat model lands with PR-J as `docs/security/threat-model.md` and is the canonical
  reference for every later security change. Until it lands, the control each section describes is
  documented in that control's own reference page.
- A new security control needs all three surfaces: this file, a section in
  `omo doctor --explain-security`, and a failure message that names what was refused, why, and
  the smallest change that unblocks it. The
  [security-usability skill](../../.agents/skills/security-usability/SKILL.md) is the checklist
  that enforces it.