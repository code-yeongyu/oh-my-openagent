# Execution Plan: Issue #100 - Built-in arXiv MCP

## Phase 0: Setup

1. `git fetch origin dev`
2. `git worktree add ../omo-wt/feat/arxiv-mcp origin/dev`
3. `cd ../omo-wt/feat/arxiv-mcp`
4. `git checkout -b feat/arxiv-mcp`

## Phase 1: Implement

### Step 1: Create `src/mcp/arxiv.ts`
- Follow static export pattern (same as `context7.ts` and `grep-app.ts`)
- arXiv API is public, no auth needed
- URL: `https://mcp.arxiv.org` (hypothetical remote MCP endpoint)
- If no remote MCP exists for arXiv, this would need to be a stdio MCP or a custom HTTP wrapper. For this plan, we assume a remote MCP endpoint pattern consistent with existing built-ins.

### Step 2: Update `src/mcp/types.ts`
- Add `"arxiv"` to `McpNameSchema` enum: `z.enum(["websearch", "context7", "grep_app", "arxiv"])`

### Step 3: Update `src/mcp/index.ts`
- Import `arxiv` from `"./arxiv"`
- Add conditional block in `createBuiltinMcps()`:
  ```typescript
  if (!disabledMcps.includes("arxiv")) {
    mcps.arxiv = arxiv
  }
  ```

### Step 4: Create `src/mcp/arxiv.test.ts`
- Test arXiv config shape (type, url, enabled, oauth)
- Follow pattern from existing tests (given/when/then)

### Step 5: Update `src/mcp/index.test.ts`
- Update expected MCP count from 3 to 4
- Add `"arxiv"` to `toHaveProperty` checks
- Add `"arxiv"` to the "all disabled" test case

### Step 6: Update `src/mcp/AGENTS.md`
- Add arxiv row to the built-in MCPs table

### Step 7: Local validation
- `bun run typecheck`
- `bun test src/mcp/`
- `bun run build`

### Atomic commits (in order):
1. `feat(mcp): add arxiv paper search built-in MCP` - arxiv.ts + types.ts update
2. `test(mcp): add arxiv MCP tests` - arxiv.test.ts + index.test.ts updates
3. `docs(mcp): update AGENTS.md with arxiv MCP` - AGENTS.md update

## Phase 2: PR Creation

1. `git push -u origin feat/arxiv-mcp`
2. `gh pr create --base dev --title "feat(mcp): add built-in arXiv paper search MCP" --body-file /tmp/pull-request-arxiv-mcp-*.md`

## Phase 3: Verify Loop

### Gate A: CI
- Wait for `ci.yml` workflow (tests, typecheck, build)
- `gh run watch` or poll `gh pr checks`

### Gate B: review-work
- Run `/review-work` skill (5-agent parallel review)
- All 5 agents must pass: Oracle (goal), Oracle (code quality), Oracle (security), QA execution, context mining

### Gate C: Cubic
- Wait for cubic-dev-ai[bot] automated review
- Must show "No issues found"
- If issues found, fix and re-push

### Failure handling:
- Gate A fail: fix locally, amend or new commit, re-push
- Gate B fail: address review-work findings, new commit
- Gate C fail: address Cubic findings, new commit
- Re-enter verify loop from Gate A

## Phase 4: Merge

1. `gh pr merge --squash --delete-branch`
2. `git worktree remove ../omo-wt/feat/arxiv-mcp`
3. `git branch -D feat/arxiv-mcp` (if not auto-deleted)
