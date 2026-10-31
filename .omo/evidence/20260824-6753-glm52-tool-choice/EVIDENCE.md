WHAT WAS TESTED
===============

Change under test: omit `tool_choice` from zai-family (Z.AI / Zhipu GLM)
chat-completion requests when the effective `tools` list is empty or when
`tool_choice` names a function absent from `tools`. GLM endpoints reject such
requests with HTTP 400 code 1210 (`AI_APICallError: API 调用参数有误`),
reported in issue #6753.

Commands run (from worktree root, branch issue/6753-glm52-empty-tools-choice):

1. Failing-first proof:
   `bun test packages/omo-opencode/src/features/zai-tool-choice-guard/`
   Run BEFORE the implementation module existed. Observed:
   `error: Cannot find module './index' ... 0 pass, 1 fail` - red confirmed.
2. Scoped regression suite after implementation:
   `bun test packages/omo-opencode/src/features/zai-tool-choice-guard/ packages/omo-opencode/src/plugin-handlers/config-handler.test.ts`
   - artifact: scoped-tests.log (71 pass / 0 fail).
3. Wider scoped net around the touched wiring:
   `bun test packages/omo-opencode/src/plugin-handlers/ packages/omo-opencode/src/features/zai-tool-choice-guard/ packages/omo-opencode/src/features/opengateway-provider/`
   - observed: 266 pass / 0 fail across 22 files.
4. Repo type gate:
   `bun run typecheck` - artifact: typecheck.log (exit 0; tsgo root +
   typecheck:script + typecheck:packages all green).

Surface driven: the new fetch-wrapper unit surface (sanitizer + wrapper +
config wiring) exercised through bun:test with injected inner fetch doubles;
no network calls are made by the tests.

WHAT WAS OBSERVED
=================

Before fix (red): tests could not import the guard module; upstream behavior
per issue #6753 sends `tool_choice` with empty/absent `tools`, which GLM
rejects (error 1210).

After fix (green), pinned by 19 co-located given/when/then tests:

- tools absent + tool_choice "required" -> tool_choice removed, rest of body
  intact.
- tools [] + tool_choice "auto" -> tool_choice removed.
- tools [a] + tool_choice {function b} -> tool_choice removed.
- tools [a] + tool_choice "required" -> body byte-identical (valid request
  untouched).
- tools [a] + tool_choice {function a} -> body byte-identical.
- no tool_choice -> body byte-identical.
- non-JSON body forwarded verbatim; SSE Response object passes through
  unchanged (streaming safe).
- user-supplied options.fetch is composed (wrapped), never replaced; wrapper
  is idempotent via brand property (double-wrap is a no-op).
- Request-object inputs are rebuilt without tool_choice.
- Wiring (`applyZaiToolChoiceGuard` called from the plugin config hook next to
  `applyOpenGatewayProviderConfig`): creates missing zai-family provider
  entries with options.fetch, preserves existing models/options on those
  entries, leaves anthropic/github-copilot entries untouched, second pass is a
  no-op.

Isolation proof: tests use injected fetch doubles and temp config objects only;
no real provider credentials, no live HTTP requests, no opencode DB access.

WHY IT IS ENOUGH
================

The sanitizer encodes exactly the wire-level rule from the issue's own proxy
workaround ("strip tool_choice when tools=[] or tool_choice.function.name not
in tools.function[].name, otherwise forward unchanged incl. SSE streaming"),
and every branch of that rule has a failing-first regression test that now
passes. The injection point was verified against opencode's provider pipeline
(packages/opencode/src/provider/provider.ts @ dev): plugin config() hooks run
before cfg.provider is read (lines ~1420-1424), config provider entries are
deep-merged over the models.dev catalog entry preserving models
(~1462-1471, re-applied ~1628-1634), and the openai-compatible loader passes
options.fetch through to createOpenAICompatible (verified in the installed
opencode 1.18.16 binary). So the guard covers all request paths for the four
zai-family provider ids while remaining inert for every other provider.
Remaining risk: if a future opencode stops honoring options.fetch the wrapper
becomes inert (degrade-safe, no crash); upstream SDK fix remains the complete
remedy for non-zai openai-compatible providers.

WHAT WAS OMITTED
================

- No live curl reproduction against open.bigmodel.cn / api.z.ai: requires a
  real Z.AI API key (secret); the wire-format rule is fully covered by the
  body-level tests above and matches the reporter's curl matrix in #6753.
- No raw env dumps or auth material in this directory; test logs contain only
  bun:test output.
- Full-repo `bun test` suite not run in this worktree (scoped runs + repo
  typecheck gate per task scope); CI runs the full matrix on the PR.
