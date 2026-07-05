# CodeGraph MCP Bridge Evidence

## What Was Tested

- RED: `cd packages/omo-codex/plugin/components/codegraph && bun test test/serve-mcp-bridge.test.ts`
  - Artifact: `.omo/evidence/20260626-issue-71-codegraph-mcp/red.txt`
- Focused GREEN: `cd packages/omo-codex/plugin/components/codegraph && bun test test/serve-mcp-bridge.test.ts`
  - Artifact: `.omo/evidence/20260626-issue-71-codegraph-mcp/green-focused.txt`
- Wrapper regression: `cd packages/omo-codex/plugin/components/codegraph && bun test test/serve.test.ts`
  - Artifact: `.omo/evidence/20260626-issue-71-codegraph-mcp/green-serve-wrapper.txt`
- Component suite: `cd packages/omo-codex/plugin/components/codegraph && bun test test/*.test.ts`
  - Artifact: `.omo/evidence/20260626-issue-71-codegraph-mcp/codegraph-component-tests.txt`
- Component typecheck: `cd packages/omo-codex/plugin/components/codegraph && bun run typecheck`
  - Artifact: `.omo/evidence/20260626-issue-71-codegraph-mcp/codegraph-typecheck.txt`
- Component build: `cd packages/omo-codex/plugin/components/codegraph && bun run build`
  - Artifact: `.omo/evidence/20260626-issue-71-codegraph-mcp/codegraph-build.txt`
- Codex compatibility gate: `bun run test:codex`
  - Artifact: `.omo/evidence/20260626-issue-71-codegraph-mcp/test-codex.txt`
- Manual framed MCP QA: built `components/codegraph/dist/serve.js` with framed `initialize` and `tools/list` requests against a fake newline-JSON CodeGraph child.
  - Artifact: `.omo/evidence/20260626-issue-71-codegraph-mcp/manual-qa-framed-mcp.txt`
- Codex QA app-server: `bash .agents/skills/codex-qa/scripts/app-server-drive.sh --plugin`
  - Artifact: `.omo/evidence/20260626-issue-71-codegraph-mcp/codex-qa-app-server-drive.txt`
- Codex QA install verification: `bash .agents/skills/codex-qa/scripts/install-verify.sh --self-test`
  - Artifact: `.omo/evidence/20260626-issue-71-codegraph-mcp/codex-qa-install-verify.txt`
- TypeScript hygiene and LOC audit:
  - Artifacts: `.omo/evidence/20260626-issue-71-codegraph-mcp/typescript-no-excuse.txt`, `.omo/evidence/20260626-issue-71-codegraph-mcp/changed-file-loc.txt`

## What Was Observed

- RED showed framed MCP input produced no parsed response bodies before the bridge.
- Focused GREEN returned framed responses for `initialize` and `tools/list`.
- Manual QA observed `codegraph_search`, `codegraph_node`, `codegraph_explore`, and `codegraph_callers` from the built serve entry with no child parse error.
- Manual QA also proved the fake CodeGraph child ran from the project cwd selected through `OMO_CODEGRAPH_PROJECT_CWD`.
- Component suite passed 43 tests.
- `bun run test:codex` passed 404 tests.
- Codex QA app-server completed a real isolated app-server turn and observed plugin hooks firing.
- Codex QA install verification installed the local plugin into isolated `CODEX_HOME` and confirmed the real `~/.codex/config.toml` hash was unchanged.
- TypeScript no-excuse audit reported no violations.
- LOC audit kept modified source files below the 250 pure-LOC ceiling.

## Why It Is Enough

The RED/GREEN test pins the exact protocol mismatch from code-yeongyu/lazycodex#71. The manual QA drives the built MCP serve entry through the same Content-Length framed stdio surface Codex uses, while the fake child only understands newline JSON. The component and root Codex gates cover surrounding CodeGraph behavior, generated bundle integrity, installer/runtime packaging, and Codex Light compatibility. The codex-qa app-server and install checks prove the local plugin still loads in an isolated real Codex surface without touching the user's real Codex config.

## What Was Omitted

Raw environment dumps, auth-bearing logs, tokens, and private credentials were not captured. The app-server artifact includes only sanitized script output and the scripts' own isolation/hash assertions.
