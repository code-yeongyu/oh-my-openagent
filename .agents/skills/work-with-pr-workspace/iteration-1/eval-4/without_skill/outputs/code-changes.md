# Code Changes: Built-in arXiv MCP

## 1. NEW FILE: `src/mcp/arxiv.ts`

```typescript
export const arxiv = {
  type: "remote" as const,
  url: "https://mcp.arxiv.org",
  enabled: true,
  oauth: false as const,
}
```

> **Note:** The URL `https://mcp.arxiv.org` is a placeholder. The actual endpoint needs to be verified. If no hosted arXiv MCP exists, alternatives include community-hosted servers or a self-hosted wrapper around the arXiv REST API (`export.arxiv.org/api/query`). This would be the single blocker requiring resolution before merging.

Pattern followed: `grep-app.ts` (static export, no auth, no config factory needed since arXiv API is public).

---

## 2. MODIFY: `src/mcp/types.ts`

```diff
 import { z } from "zod"

-export const McpNameSchema = z.enum(["websearch", "context7", "grep_app"])
+export const McpNameSchema = z.enum(["websearch", "context7", "grep_app", "arxiv"])

 export type McpName = z.infer<typeof McpNameSchema>

 export const AnyMcpNameSchema = z.string().min(1)

 export type AnyMcpName = z.infer<typeof AnyMcpNameSchema>
```

---

## 3. MODIFY: `src/mcp/index.ts`

```diff
 import { createWebsearchConfig } from "./websearch"
 import { context7 } from "./context7"
 import { grep_app } from "./grep-app"
+import { arxiv } from "./arxiv"
 import type { OhMyOpenCodeConfig } from "../config/schema"

-export { McpNameSchema, type McpName } from "./types"
+export { McpNameSchema, type McpName } from "./types"

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

+  if (!disabledMcps.includes("arxiv")) {
+    mcps.arxiv = arxiv
+  }
+
   return mcps
 }
```

---

## 4. MODIFY: `src/mcp/index.test.ts`

Changes needed in existing tests (count 3 → 4) plus one new test:

```diff
 describe("createBuiltinMcps", () => {
   test("should return all MCPs when disabled_mcps is empty", () => {
     // given
     const disabledMcps: string[] = []

     // when
     const result = createBuiltinMcps(disabledMcps)

     // then
     expect(result).toHaveProperty("websearch")
     expect(result).toHaveProperty("context7")
     expect(result).toHaveProperty("grep_app")
-    expect(Object.keys(result)).toHaveLength(3)
+    expect(result).toHaveProperty("arxiv")
+    expect(Object.keys(result)).toHaveLength(4)
   })

   test("should filter out disabled built-in MCPs", () => {
     // given
     const disabledMcps = ["context7"]

     // when
     const result = createBuiltinMcps(disabledMcps)

     // then
     expect(result).toHaveProperty("websearch")
     expect(result).not.toHaveProperty("context7")
     expect(result).toHaveProperty("grep_app")
-    expect(Object.keys(result)).toHaveLength(2)
+    expect(result).toHaveProperty("arxiv")
+    expect(Object.keys(result)).toHaveLength(3)
   })

   test("should filter out all built-in MCPs when all disabled", () => {
     // given
-    const disabledMcps = ["websearch", "context7", "grep_app"]
+    const disabledMcps = ["websearch", "context7", "grep_app", "arxiv"]

     // when
     const result = createBuiltinMcps(disabledMcps)

     // then
     expect(result).not.toHaveProperty("websearch")
     expect(result).not.toHaveProperty("context7")
     expect(result).not.toHaveProperty("grep_app")
+    expect(result).not.toHaveProperty("arxiv")
     expect(Object.keys(result)).toHaveLength(0)
   })

   test("should ignore custom MCP names in disabled_mcps", () => {
     // given
     const disabledMcps = ["context7", "playwright", "custom"]

     // when
     const result = createBuiltinMcps(disabledMcps)

     // then
     expect(result).toHaveProperty("websearch")
     expect(result).not.toHaveProperty("context7")
     expect(result).toHaveProperty("grep_app")
-    expect(Object.keys(result)).toHaveLength(2)
+    expect(result).toHaveProperty("arxiv")
+    expect(Object.keys(result)).toHaveLength(3)
   })

   test("should handle empty disabled_mcps by default", () => {
     // given
     // when
     const result = createBuiltinMcps()

     // then
     expect(result).toHaveProperty("websearch")
     expect(result).toHaveProperty("context7")
     expect(result).toHaveProperty("grep_app")
-    expect(Object.keys(result)).toHaveLength(3)
+    expect(result).toHaveProperty("arxiv")
+    expect(Object.keys(result)).toHaveLength(4)
   })

   test("should only filter built-in MCPs, ignoring unknown names", () => {
     // given
     const disabledMcps = ["playwright", "sqlite", "unknown-mcp"]

     // when
     const result = createBuiltinMcps(disabledMcps)

     // then
     expect(result).toHaveProperty("websearch")
     expect(result).toHaveProperty("context7")
     expect(result).toHaveProperty("grep_app")
-    expect(Object.keys(result)).toHaveLength(3)
+    expect(result).toHaveProperty("arxiv")
+    expect(Object.keys(result)).toHaveLength(4)
   })

+  test("should filter out arxiv when disabled", () => {
+    // given
+    const disabledMcps = ["arxiv"]
+
+    // when
+    const result = createBuiltinMcps(disabledMcps)
+
+    // then
+    expect(result).toHaveProperty("websearch")
+    expect(result).toHaveProperty("context7")
+    expect(result).toHaveProperty("grep_app")
+    expect(result).not.toHaveProperty("arxiv")
+    expect(Object.keys(result)).toHaveLength(3)
+  })
+
   // ... existing tavily test unchanged
 })
```

---

## 5. MODIFY: `src/mcp/AGENTS.md`

```diff
-# src/mcp/ — 3 Built-in Remote MCPs
+# src/mcp/ — 4 Built-in Remote MCPs

 **Generated:** 2026-03-06

 ## OVERVIEW

-Tier 1 of the three-tier MCP system. 3 remote HTTP MCPs created via `createBuiltinMcps(disabledMcps, config)`.
+Tier 1 of the three-tier MCP system. 4 remote HTTP MCPs created via `createBuiltinMcps(disabledMcps, config)`.

 ## BUILT-IN MCPs

 | Name | URL | Env Vars | Tools |
 |------|-----|----------|-------|
 | **websearch** | `mcp.exa.ai` (default) or `mcp.tavily.com` | `EXA_API_KEY` (optional), `TAVILY_API_KEY` (if tavily) | Web search |
 | **context7** | `mcp.context7.com/mcp` | `CONTEXT7_API_KEY` (optional) | Library documentation |
 | **grep_app** | `mcp.grep.app` | None | GitHub code search |
+| **arxiv** | `mcp.arxiv.org` | None | arXiv paper search |

 ...

 ## FILES

 | File | Purpose |
 |------|---------|
 | `index.ts` | `createBuiltinMcps()` factory |
-| `types.ts` | `McpNameSchema`: "websearch" \| "context7" \| "grep_app" |
+| `types.ts` | `McpNameSchema`: "websearch" \| "context7" \| "grep_app" \| "arxiv" |
 | `websearch.ts` | Exa/Tavily provider with config |
 | `context7.ts` | Context7 with optional auth header |
 | `grep-app.ts` | Grep.app (no auth) |
+| `arxiv.ts` | arXiv paper search (no auth) |
```

---

## Summary of Touched Files

| File | Lines Changed | Type |
|------|--------------|------|
| `src/mcp/arxiv.ts` | +6 (new) | Create |
| `src/mcp/types.ts` | 1 line modified | Modify |
| `src/mcp/index.ts` | +5 (import + block) | Modify |
| `src/mcp/index.test.ts` | ~20 lines (count fixes + new test) | Modify |
| `src/mcp/AGENTS.md` | ~6 lines | Modify |

Total: ~37 lines added/modified across 5 files. Minimal, surgical change.
