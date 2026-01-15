/**
 * Updated skills.ts for oh-my-opencode
 * 
 * This file adds the react-best-practices skill to the builtin skills.
 * Location: src/features/builtin-skills/skills.ts
 */

import type { BuiltinSkill } from "./types";

const playwrightSkill: BuiltinSkill = {
  name: "playwright",
  description: "MUST USE for any browser-related tasks. Browser automation via Playwright MCP - verification, browsing, information gathering, web scraping, testing, screenshots, and all browser interactions.",
  template: `# Playwright Browser Automation

This skill provides browser automation capabilities via the Playwright MCP server.`,
  mcpConfig: {
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest"]
    }
  }
};

const reactBestPracticesSkill: BuiltinSkill = {
  name: "react-best-practices",
  description: "React and Next.js performance optimization guidelines from Vercel Engineering. Contains 45+ rules across 8 categories, prioritized by impact. Use when writing, reviewing, or refactoring React/Next.js code.",
  template: `# React Best Practices (Vercel Engineering)

Comprehensive performance optimization guide for React and Next.js applications.

## Priority Categories

| Priority | Category | Impact |
|----------|----------|--------|
| 1 | Eliminating Waterfalls | CRITICAL |
| 2 | Bundle Size Optimization | CRITICAL |
| 3 | Server-Side Performance | HIGH |
| 4 | Client-Side Data Fetching | MEDIUM-HIGH |
| 5 | Re-render Optimization | MEDIUM |
| 6 | Rendering Performance | MEDIUM |
| 7 | JavaScript Performance | LOW-MEDIUM |
| 8 | Advanced Patterns | LOW |

## CRITICAL: Eliminating Waterfalls

\`\`\`typescript
// ❌ BAD: Sequential (3 round trips)
const user = await fetchUser()
const posts = await fetchPosts()
const comments = await fetchComments()

// ✅ GOOD: Parallel (1 round trip)
const [user, posts, comments] = await Promise.all([
  fetchUser(), fetchPosts(), fetchComments()
])
\`\`\`

## CRITICAL: Avoid Barrel File Imports

\`\`\`typescript
// ❌ BAD: Loads 1,583 modules
import { Check } from 'lucide-react'

// ✅ GOOD: Loads 1 module
import Check from 'lucide-react/dist/esm/icons/check'
\`\`\`

## CRITICAL: Dynamic Imports for Heavy Components

\`\`\`typescript
import dynamic from 'next/dynamic'
const MonacoEditor = dynamic(() => import('./monaco-editor'), { ssr: false })
\`\`\`

## HIGH: Minimize RSC Serialization

\`\`\`tsx
// ❌ BAD: Serializes all 50 fields
return <Profile user={user} />

// ✅ GOOD: Serializes 1 field
return <Profile name={user.name} />
\`\`\`

## MEDIUM: Functional setState

\`\`\`typescript
// ❌ BAD: Stale closure risk
setItems([...items, newItem])

// ✅ GOOD: Always uses latest state
setItems(curr => [...curr, newItem])
\`\`\`

## MEDIUM: Lazy State Initialization

\`\`\`typescript
// ❌ BAD: Runs every render
const [index] = useState(buildSearchIndex(items))

// ✅ GOOD: Runs once
const [index] = useState(() => buildSearchIndex(items))
\`\`\`

## Anti-Patterns (NEVER)

- Sequential awaits for independent operations
- Barrel file imports (lucide-react, @mui/material, etc.)
- Passing full objects across RSC boundary
- .sort() on React state (mutates in place, use .toSorted())
- as any, @ts-ignore, @ts-expect-error

## References

- https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices
- https://vercel.com/blog/how-we-optimized-package-imports-in-next-js
- https://vercel.com/blog/how-we-made-the-vercel-dashboard-twice-as-fast
`
};

export function createBuiltinSkills(): BuiltinSkill[] {
  return [playwrightSkill, reactBestPracticesSkill];
}
