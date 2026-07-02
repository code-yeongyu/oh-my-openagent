# Windows Hook Trust Evidence

## What Was Tested

- Scenario: `commandWindows` hooks compute trusted hashes from the Windows command, not the Unix `command`.
  Invocation: `bun test packages/omo-codex/src/install/codex-hook-trust.test.ts`
  Observable: the Windows fixture trust state equals `sha256:0109665071b94eed9adbbbb6ac0a736e50accc5ef1c9d19128f14ff653c23e4c`.
  Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/windows-hook-trust/codex-hook-trust-unit.txt`

- Scenario: the generated Node installer stamps Windows hook trust into sandbox `config.toml`.
  Invocation: `node --test packages/omo-codex/scripts/install-local.test.mjs`
  Observable: the install test passes with `platform: "win32"` and a fake Git Bash resolver; `config.toml` contains `trusted_hash = "sha256:605b27c7b1f93c02aa2f8052fd9df870a221c3dc432795c48b223fe48afcebc0"`.
  Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/windows-hook-trust/generated-install-local-test.txt`

- Scenario: Codex installer/package type safety.
  Invocation: `bun run --cwd packages/omo-codex typecheck`
  Observable: `tsgo --noEmit -p tsconfig.json` exits 0.
  Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/windows-hook-trust/omo-codex-typecheck.txt`

- Scenario: strict TypeScript no-excuse audit for touched TS files.
  Invocation: `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/omo-codex/src/install/codex-hook-trust.ts packages/omo-codex/src/install/codex-hook-trust.test.ts packages/omo-codex/src/install/install-codex.ts`
  Observable: `No violations in 3 file(s).`
  Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/windows-hook-trust/no-excuse-typescript.txt`

- Scenario: full Codex compatibility gate.
  Invocation: `bun run test:codex`
  Observable: full gate exits 0; final Node section reports `tests 421`, `pass 421`, `fail 0`.
  Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/windows-hook-trust/test-codex.txt`

- Scenario: isolated Codex installer QA against a throwaway `CODEX_HOME`.
  Invocation: `bash .agents/skills/codex-qa/scripts/install-verify.sh --self-test`
  Observable: local plugin cache installed, `omo@sisyphuslabs` enabled in sandbox config, component bins and agent TOMLs linked, and real `~/.codex/config.toml` unchanged.
  Artifact: `.omo/evidence/20260629-prepublish-blocker-fixes/windows-hook-trust/codex-qa-install-verify.txt`

## Why It Is Enough

The unit test pins the exact blocker at the trust hash computation boundary. The generated installer test proves the published installer bundle stamps the Windows hash into `config.toml`. The full Codex gate and isolated installer QA cover surrounding installer/config/plugin regressions without touching the real Codex home.

## What Was Omitted

No raw secrets, auth headers, service logs, or private credentials were copied. No Windows VM was driven; Windows behavior is covered deterministically through the installer platform seam and the Codex-compatible hash identity.
