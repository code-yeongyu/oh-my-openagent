# Senpi cmux completion notification review QA

## What was tested

- `bun test packages/omo-senpi/src/components/task/cmux-notifier.test.ts packages/omo-senpi/src/components/task/task-component.test.ts`
- `node packages/omo-senpi/plugin/scripts/build-extension.mjs`
- `CMUX_PROBE_OUT_DIR=.omo/evidence/omo-senpi-adapter/20260804-senpi-cmux-completion-review node packages/omo-senpi/scripts/qa/cmux-notification-probe.mjs`

## What was observed

- Focused cmux/task tests passed: 9 pass, 0 fail, 23 assertions.
- The generated Senpi extension bundle rebuilt successfully.
- The live probe drove `senpi` with an isolated `SENPI_CODING_AGENT_DIR` and `XDG_CONFIG_HOME`, loaded the local packaged Senpi extension, spawned a background `task` child, and observed the task completion path invoke fake `cmux` with:
  - `notify`
  - `--title`
  - `OMO task completed`
  - `--body`
  - a completion body containing `cmuxprobe` and `status:completed`
- The probe used only `TMUX=/tmp/cmuxterm-probe.sock,1234,0` as the cmux environment marker; `CMUX_SOCKET_PATH` was deleted from the child environment.
- Isolation proof: `realSenpiCredentialsUntouched: true` and `realSenpiDigestUnchanged: true`; the sandbox agent dir was under `/var/folders/.../T/omo-senpi-qa-*/agent`.

Captured artifacts:

- `cmux-notification-probe.json`
- `cmux-notification-probe.stdout.json.log`
- `cmux-notification-probe.stderr.log`

## Why it is enough

The unit tests pin the reviewed edge cases: TMUX-only cmux detection, synchronous `spawn` failures, and stalled notification subprocess cleanup. The live probe proves the generated Senpi extension routes a real background task completion through `createParentNotifier` into the cmux notification bridge, while keeping the user's real Senpi credentials untouched.

## What was omitted

No secrets, auth headers, tokens, or credential files are included. The full real Senpi agent directory digest was unchanged during the recorded run.
