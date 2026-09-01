# Electron ast-grep runtime QA

## What was tested

- Ran `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`.
- Ran `node packages/omo-senpi/scripts/qa/drive.mjs` against the real `senpi` binary.
- Ran `bun test packages/omo-senpi/src/components/ast-grep/index.test.ts`.
- Launched the staged ast-grep MCP with the installed OmO Electron executable under `ELECTRON_RUN_AS_NODE=1`.
- Repeated the MCP handshake with Node and Bun while preserving `BUN_BE_BUN=1`.

## Observed result

- The QA driver self-test reported `SELF-TEST OK`.
- The live driver reported `PASS`, injected the expected ultrawork directive, and passed the comment checker.
- Both real agent homes remained untouched with no observed, volatile, protected, or credential changes.
- The regression test failed before the implementation because `ELECTRON_RUN_AS_NODE` was absent, then passed all four cases after the implementation.
- The real Electron executable reported Electron 41.5.0 and Node 24.15.0 in Node mode.
- The Electron, Node, and Bun MCP processes completed the initialize handshake and exposed `search`, `rewrite`, and `scan`.
- The OmO PID set was identical before and after the Electron handshake; no extra persistent Desktop process remained.
- The staged runtime freshness check passed, and source and staged SHA-256 values matched.

## Why this is enough

The component test pins the child-process environment that controls Electron runtime behavior. The real Electron handshake exercises the packaged executable and verifies that it behaves as the MCP's Node runtime without leaving another OmO Desktop process. Node and Bun handshakes preserve the adjacent runtime contracts.

## Isolation and cleanup

- Real homes checked: `<operator-home>/.senpi/agent`, `<operator-home>/.omo/agent`
- Driver sandbox: `<qa-temp>/agent`
- Driver project: `<qa-temp>/project`
- Driver-owned temporary paths were removed by the driver before it returned.
- The focused Electron QA used no real agent-home state.
- No task-owned child processes remained after the checks.

## Omitted

- A structural search was not executed because no `sg` binary was provisioned. MCP initialization and tool discovery passed through the real Electron executable, which covers the Desktop-launch regression.
