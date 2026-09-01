# PR #6395 follow-up: does the INSTALLED marketplace wrapper resolve skills/ast-grep?

Review comment: https://github.com/code-yeongyu/oh-my-openagent/pull/6395#discussion_r3711518573
Captured 2026-08-05 on Windows 11, bun 1.3.14, node v24.18.0, codex-cli 0.146.0.

## What was tested

The finding is that the previous evidence proved the resolver only synthetically. So this run builds
the REAL Codex marketplace payload with `script/sync-lazycodex-marketplace.ts` and drives the
INSTALLED wrapper bundle at `plugins/omo/dist/cli`, in a sandbox with its own `HOME`,
`XDG_*` and `CODEX_HOME`.

The binary observable is the wrapper's own log line. `installAstGrepForOpenCode` calls
`runAstGrepSkillInstall`, which returns `{ kind: "skipped", reason: "missing <skillDir>/install.*" }`
when the resolved skills directory has no install script, and the CLI prints that as
`[ast-grep] skipped sg provisioning: missing …`. The message contains the RESOLVED path, so it
states exactly where the installed wrapper looked.

Command driven (identical in both runs, only the compiled probe list differs):

```
bun <marketplace>/plugins/omo/dist/cli/index.js install --no-tui --platform=opencode \
  --claude=no --openai=no --gemini=no --copilot=no --skip-auth
```

## What was observed

| bundle | compiled probe list | wrapper output |
|---|---|---|
| FIXED | `["./skills/", "../skills/", "../../skills/"]` | no `[ast-grep]` skip line; install completed |
| CONTROL (probe reverted to `upstream/dev`) | `"../../skills/"` occurrences: **0** | `[ast-grep] skipped sg provisioning: missing …\control\plugins\omo\dist\cli\skills\ast-grep\install.ps1` |

The control reproduces the reported failure exactly: with only `./skills/` and `../skills/`, neither
candidate exists in the marketplace layout, the function falls through to the first candidate, and
provisioning is skipped.

The payload the fixed bundle resolves to really is the generated skill directory
(`fixed-layout.txt`) - `plugins/omo/skills/ast-grep/` contains `install.sh`, `install.ps1`,
`SKILL.md`, `scripts`, `references`, `agents`, `tests`.

Isolation: `real-codex-config.before.sha256` and `real-codex-config.after.sha256` are identical,
and `verdict.txt` records `PASS: sha256 identical before and after`. The whole run wrote only into
`mktemp` directories.

## Why it is enough

The control is what makes this non-vacuous. Both runs use the same command, same sandbox shape and
same marketplace sync; the ONLY difference is whether `../../skills/` is compiled into the bundle.
One run resolves the payload, the other prints the missing-path message. That isolates the probe as
the cause rather than inferring it.

This is the installed artifact, not a synthetic resolver: the bundle under test was produced by the
repository's own marketplace sync, and `fixed-layout.txt` shows the probe list as it appears inside
`plugins/omo/dist/cli/index.js`.

## What was omitted

- `bun run test:codex` does not complete on this Windows host for a pre-existing reason unrelated
  to this branch: the vendored `packages/lsp-tools-mcp` asserts a bare `typescript-language-server`
  shim name, and this machine has that server installed globally, so the resolver returns an
  absolute path. That baseline is captured on the #6569 branch in
  `.omo/evidence/20260805-a2-test-codex-final-head/`. The authoritative record for this branch is
  the CI `codex-compatibility` job on the pushed head, which runs the gate on ubuntu, macos and
  windows.
- The Codex install path is deliberately NOT part of this proof. `installAstGrepForCodex` derives
  its skill directory from the installed plugin path (`join(plugin.path, "skills", "ast-grep")`)
  and never calls `sharedSkillsRootPath()`, so it is unaffected by this change. The OpenCode
  install path is the consumer that this fix actually reaches, which is why the driver exercises
  `--platform=opencode`.
- Sandbox and marketplace paths are `mktemp` directories under the OS temp dir; they contain no
  credentials. No tokens, auth headers, or env dumps appear in any artifact.
