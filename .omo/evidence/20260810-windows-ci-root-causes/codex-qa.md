# Isolated Codex QA

## Isolation self-check

```bash
cd /Volumes/mengmotaStorage/local-workspaces/omo/.agents/skills/codex-qa
REPO_ROOT=/Volumes/mengmotaStorage/local-workspaces/omo-wt/fix/windows-ci-root-causes \
  bash scripts/lib/common.sh --self-check
```

Observed:

```text
PASS: dependencies present (codex node jq tmux)
PASS: isolated CODEX_HOME auto-removed on exit
PASS: CODEX_HOME points inside sandbox, not ~/.codex
PASS: mock model serves Responses SSE
PASS: real ~/.codex/config.toml unchanged
PASS: common.sh self-check
```

## Live app-server plugin drive

```bash
REPO_ROOT=/Volumes/mengmotaStorage/local-workspaces/omo-wt/fix/windows-ci-root-causes \
  bash scripts/app-server-drive.sh --plugin
```

Observed:

```text
hook/started: sessionStart
hook/completed: sessionStart
hook/started: userPromptSubmit
hook/completed: userPromptSubmit
hook/started: stop
hook/completed: stop
PASS: app-server turn completed; assistant text: Hello from the codex-qa mock model.
PASS: hooks fired: sessionStart, stop, userPromptSubmit
CODEX_APP_QA_DONE exit=0
```

## Isolation proof

The real config hash remained:

```text
da855b32f60792a2fb171174a70751d1b954e7dc  /Users/yeongyu/.codex/config.toml
```

## Cleanup receipt

The helper cleanup removed the isolated `CODEX_HOME`, mock model, app-server, and temporary files. No `cqa-home`, mock-model, or Codex app-server process remained.
