# Code Changes: Issue #100 - Built-in arXiv MCP

## 1. NEW FILE: `src/mcp/arxiv.ts`

```typescript
export const arxiv = {
  type: "remote" as const,
  url: "https://mcp.arxiv.org",
  enabled: true,
  oauth: false as const,
}
```

Pattern: identical to `grep-app.ts` (static export, no auth, no config factory needed).

## 2. MODIFY: `src/mcp/types.ts`

```typescript
import { z } from "zod"

export const McpNameSchema = z.enum(["websearch", "context7", "grep_app", "arxiv"])

export type McpName = z.infer<typeof McpNameSchema>

export const AnyMcpNameSchema = z.string().min(1)

export type AnyMcpName = z.infer<typeof AnyMcpNameSchema>
```

Change: add `"arxiv"` to `McpNameSchema` enum.

## 3. MODIFY: `src/mcp/index.ts`

```typescript
import { createWebsearchConfig } from "./websearch"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import { arxiv } from "./arxiv"
import type { OhMyOpenCodeConfig } from "../config/schema"

export { McpNameSchema, type McpName } from "./types"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

export function createBuiltinMcps(disabledMcps: string[] = [], config?: OhMyOpenCodeConfig) {
  const mcps: Record<string, RemoteMcpConfig> = {}

  if (!disabledMcps.includes("websearch")) {
    mcps.websearch = createWebsearchConfig(config?.websearch)
  }

  if (!disabledMcps.includes("context7")) {
    mcps.context7 = context7
  }

  if (!disabledMcps.includes("grep_app")) {
    mcps.grep_app = grep_app
  }

  if (!disabledMcps.includes("arxiv")) {
    mcps.arxiv = arxiv
  }

  return mcps
}
```

Changes: import `arxiv`, add conditional block.

## 4. NEW FILE: `src/mcp/arxiv.test.ts`

```typescript
import { describe, expect, test } from "bun:test"
import { arxiv } from "./arxiv"

describe("arxiv MCP configuration", () => {
  test("should have correct remote config shape", () => {
    // given
    // arxiv is a static export

    // when
    const config = arxiv

    // then
    expect(config.type).toBe("remote")
    expect(config.url).toBe("https://mcp.arxiv.org")
    expect(config.enabled).toBe(true)
    expect(config.oauth).toBe(false)
  })
})
```

## 5. MODIFY: `src/mcp/index.test.ts`

Changes needed:
- Test "should return all MCPs when disabled_mcps is empty": add `expect(result).toHaveProperty("arxiv")`, change length to 4
- Test "should filter out all built-in MCPs when all disabled": add `"arxiv"` to disabledMcps array, add `expect(result).not.toHaveProperty("arxiv")`
- Test "should handle empty disabled_mcps by default": add `expect(result).toHaveProperty("arxiv")`, change length to 4
- Test "should only filter built-in MCPs, ignoring unknown names": add `expect(result).toHaveProperty("arxiv")`, change length to 4

New test to add:

```typescript
test("should filter out arxiv when disabled", () => {
  // given
  const disabledMcps = ["arxiv"]

  // when
  const result = createBuiltinMcps(disabledMcps)

  // then
  expect(result).toHaveProperty("websearch")
  expect(result).toHaveProperty("context7")
  expect(result).toHaveProperty("grep_app")
  expect(result).not.toHaveProperty("arxiv")
  expect(Object.keys(result)).toHaveLength(3)
})
```

## 6. MODIFY: `src/mcp/AGENTS.md`

Add row to built-in MCPs table:

```
| **arxiv** | `mcp.arxiv.org` | None | arXiv paper search |
```

## Files touched summary

| File | Action |
|------|--------|
| `src/mcp/arxiv.ts` | NEW |
| `src/mcp/arxiv.test.ts` | NEW |
| `src/mcp/types.ts` | MODIFY (add enum value) |
| `src/mcp/index.ts` | MODIFY (import + conditional block) |
| `src/mcp/index.test.ts` | MODIFY (update counts + new test) |
| `src/mcp/AGENTS.md` | MODIFY (add table row) |
