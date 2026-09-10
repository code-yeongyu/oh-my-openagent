# Issue 6077 verification

The prior Windows reminder expressed a preference and fallback, but omitted
deferred discovery. The added sentence conditionally directs code-mode users
to discover the actual Git Bash names through `ALL_TOOLS` and invoke them
through the `tools` object inside `exec`, not as top-level tool calls.
The existing seven behavior cases now assert parsed hook fields, not prose.

## Checks

- Component `typecheck`, `build`, and `test`: exit 0; 7 pass, 0 fail.
- Node 24.18.0 / Bun 1.4.0: `bun run test:codex` exited 0, including
  97 LSP tests, 547 ULW-loop tests, and the final 486 Node tests.
- An initial run selected unintended Node 22.14.0 and failed JSON parsing in
  an unchanged ULW-loop CLI test. No assertion in that component was altered.
- The ignored component runtime was rebuilt. Unrelated generated installer
  version changes were excluded. LSP could not access the sibling worktree;
  compiler checks covered the actual source.

## Real Codex delivery and deferred execution

Codex 0.144.6 loaded the built component and unchanged hook registration in a
cache-only fixture. Native `exec_command` produced the real `Bash` PreToolUse
event. Matching first-party start/completion notifications, a successful
command, one marker and context delivery into the next model request passed.
Context delivery was compared with the built component's structured output,
not an authored wording literal. Only model responses were scripted.

The follow-up enables code mode and a synthetic search-capable model catalog.
Code mode alone does not defer MCP definitions. The initial Responses request
has `tool_search` but no Git Bash namespace; nevertheless, `ALL_TOOLS` finds
`which_bash` and `tools[entry.name]({})` invokes its production handler.
The catalog follows the [pinned Codex metadata format](https://github.com/openai/codex/blob/rust-v0.144.6/codex-rs/models-manager/models.json),
with model instructions removed and HTTP-only mock capabilities.

The production Git Bash launcher intentionally exits on Linux. The fixture
therefore uses the exported production request handler and shared transport,
adapting only launcher gating. It does not spoof `process.platform` or mock
the handler: `which_bash` returns the actual Linux `not-required` resolution.

## Reproduce and inspect

Use Node 24.18.0, Bun 1.4.0, the repository QA Docker image, and prepared
workspace dependencies (`bun run test:codex`). Then run:

```sh
bash .omo/evidence/20260908-6077-deferred-git-bash/commands.sh
```

The committed [commands.sh](commands.sh), [qa.mjs](qa.mjs),
[mcp-fixture.ts](mcp-fixture.ts), and [model-catalog.json](model-catalog.json)
are the actual replay inputs. [result.json](result.json) is the exact capture;
[isolation.txt](isolation.txt) records host config SHA-256 before and after.

The disposable ARM64 container had networking disabled, private HOME/CODEX_HOME
under `/qa`, and only component/QA artifact mounts. No host credentials or
configuration were mounted; app-server and container exited. Windows guarding
used synthetic `OS=Windows_NT`; native Windows execution and model choice were
not measured. Deferred discovery and invocation were measured in real code mode.
Raw model requests, stderr and generated bundles are omitted.
