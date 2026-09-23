# PR 2528 Custom Notification QA

## What Was Tested

- Docker QA image `omo-qa` with OpenCode `1.18.14`.
- The local plugin loaded from `packages/omo-opencode/src/index.ts`.
- OpenCode SSE delivery for `session.created` and `session.idle`.
- A configured custom notification script receiving an idle event after built-in desktop dispatch.
- The hardened production sender returning asynchronously while its script received stdin through the shared process-tree runner.
- Focused tests, TypeScript typecheck, generated schema freshness, and shell syntax.

## What Was Observed

- Docker SSE self-test observed `server.connected`.
- The attached SSE probe observed `session.created` and `session.idle` from the disposable server.
- The custom script received this isolated payload:

```text
idle /workspaces/oh-my-openagent {"type":"idle","sessionID":"ses_025b3e50effecP233cDGi7wslK","projectDir":"/workspaces/oh-my-openagent","title":"OpenCode · New session - 2026-08-07T03:37:28.562Z","message":"Agent is ready for input\nUser: \"Reply with OK.\""}
```

- The host OpenCode database contained 732 sessions before and after QA. The Docker container used its own disposable filesystem and was removed after the run.
- The model turn intentionally ended with a missing-model error in the credential-free container. OpenCode still emitted `session.idle`, which exercised the notification hook without using a real provider credential.
- After rebasing the process-tree hardening onto the latest `dev`, a disposable OpenCode `1.18.14` run observed real `session.created` and `session.idle` events. The current production sender returned well below the 500 ms non-blocking threshold (4 ms captured) and the script received matching `hook`, `type`, `sessionID`, and `projectDir` fields.
- Reviewer-readable artifacts: [exact Docker command and isolation](./docker-qa-command.txt) and [captured Docker/SSE/script/DB output](./docker-qa-output.txt).

## Why It Is Enough

The first real OpenCode run loaded the full worktree plugin and proved the complete configuration-to-hook path. The post-hardening run paired a real OpenCode idle event with the current production sender/executor, covering asynchronous dispatch, stdin delivery, and process-tree termination. Focused tests cover idle, permission, question, unsupported desktop platforms, platform notification failure, and TERM-resistant process trees.

## What Was Omitted

- No provider credentials, auth headers, environment dumps, or host configuration were copied into evidence.
- TUI smoke was omitted because this change has no visible TUI surface.
- A full `bun run build` was attempted but blocked while cloning an unrelated shared-skills submodule. Typecheck and scoped runtime QA cover the changed TypeScript paths.
- OpenCode `1.18.14` stalled in project plugin config bootstrap when the post-hardening QA attempted to reload any source plugin. The rerun therefore used the real SSE event plus a direct invocation of the current production sender; the earlier full-plugin evidence remains the configuration and registration proof.
- The complete pre-existing `session-notification.test.ts` file has one Bun `1.2.19` compatibility failure because `jest.clearAllTimers` is unavailable. Its following timer test passes in isolation; neither test nor its production path changed in this PR.
