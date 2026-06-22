import type { AgentConfig } from "@opencode-ai/sdk"
import { FRONTEND_A11Y_SKILL_NAME } from "../features/builtin-skills/skills/frontend-a11y"
import { FRONTEND_BUILD_TOOLING_SKILL_NAME } from "../features/builtin-skills/skills/frontend-build-tooling"
import { FRONTEND_PERF_SKILL_NAME } from "../features/builtin-skills/skills/frontend-perf"
import { FRONTEND_REACT_NEXTJS_SKILL_NAME } from "../features/builtin-skills/skills/frontend-react-nextjs"
import { FRONTEND_STATE_DATA_SKILL_NAME } from "../features/builtin-skills/skills/frontend-state-data"
import { FRONTEND_SVELTE_SVELTEKIT_SKILL_NAME } from "../features/builtin-skills/skills/frontend-svelte-sveltekit"
import { FRONTEND_TESTING_SKILL_NAME } from "../features/builtin-skills/skills/frontend-testing"
import { createAgentToolRestrictions } from "../shared/permission-compat"
import type { AgentMode, AgentPromptMetadata } from "./types"
import { isGptModel } from "./types"

const MODE: AgentMode = "subagent"

const SATI_FRONTEND_SKILLS = [
  FRONTEND_REACT_NEXTJS_SKILL_NAME,
  FRONTEND_SVELTE_SVELTEKIT_SKILL_NAME,
  FRONTEND_A11Y_SKILL_NAME,
  FRONTEND_PERF_SKILL_NAME,
  FRONTEND_TESTING_SKILL_NAME,
  FRONTEND_STATE_DATA_SKILL_NAME,
  FRONTEND_BUILD_TOOLING_SKILL_NAME,
  "playwright",
]

export const SATI_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "EXPENSIVE",
  promptAlias: "Sati",
  keyTrigger: "Frontend component work mentioned → fire `sati`; React/Next.js/Svelte/SvelteKit UI implementation needed → ALWAYS fire `sati` regardless of task size or apparent simplicity",
  triggers: [
    { domain: "Frontend Components", trigger: "React/Next.js or Svelte/SvelteKit component implementation, JSX/Svelte template authoring" },
    { domain: "UI/UX Implementation", trigger: "Translating design tokens, Figma specs, or wireframes into working web UI" },
    { domain: "Web Performance", trigger: "Core Web Vitals, bundle size, code splitting, render perf, runtime profiling in the browser" },
    { domain: "Accessibility", trigger: "WCAG AA compliance, ARIA, keyboard navigation, screen reader testing, focus management" },
    { domain: "Frontend Testing", trigger: "Component tests (Vitest/Jest/Testing Library), E2E (Playwright), visual regression" },
    { domain: "Frontend Build Tooling", trigger: "Vite/Webpack/Turbopack/esbuild config, tsconfig, bundler optimization, dev server setup" },
  ],
  useWhen: [
    "Building React or Next.js components, pages, or app router routes",
    "Implementing Svelte or SvelteKit pages, components, or stores",
    "Authoring accessible, semantic, WCAG AA-compliant markup and interactions",
    "Optimizing Core Web Vitals (LCP, CLS, INP) and runtime performance",
    "Setting up frontend build tooling (Vite, Turbopack, esbuild) and tsconfig",
    "Writing component tests, hooks tests, or Playwright E2E flows",
    "Managing client/server state (TanStack Query, Zustand, Svelte stores, form state)",
    "Visual verification with the playwright skill — screenshot, interact, compare",
  ],
  avoidWhen: [
    "Backend API design or server-side business logic",
    "Database schema, migrations, or query optimization",
    "DevOps, CI/CD, or infrastructure configuration",
    "Pure data science, ML modeling, or notebook work",
  ],
}

const SATI_SYSTEM_PROMPT = `You are Sati, a FRONTEND specialist with deep expertise across React/Next.js, Svelte/SvelteKit, accessibility, web performance, component architecture, and frontend build tooling.

<context>
You are invoked when a task touches the user-facing web layer: components, pages, layouts, design systems, accessibility, runtime performance, or build configuration. You own the full FRONTEND surface end-to-end — from JSX/Svelte authoring through to visual verification in a real browser.
You are self-contained: no \`task\` and no \`delegate_agent\` — you execute the work yourself using your read/write/edit tools plus the skills attached to this agent.
</context>

## BROWSER VERIFICATION LOOP

Whenever you produce visible UI, you MUST close the loop in a real browser before declaring the work done:

1. Load the \`playwright\` skill for browser automation patterns and MCP usage.
2. Start a dev server (or reuse a running one), navigate to the relevant route, and screenshot the page.
3. Interact with the component under test — click, type, focus, keyboard-navigate — and verify expected behavior.
4. If the diff is visual, capture before/after screenshots and compare.
5. Only mark a UI task complete after the browser confirms the expected output.

## SKILL USAGE

You have 8 skills attached. Use them as your primary reference, not as decoration:

| Skill | When to load |
|-------|--------------|
| \`react-nextjs-patterns\` | Any REACT component, hook, server component, app-router route, or Next.js config change |
| \`svelte-sveltekit-patterns\` | Svelte component, SvelteKit page/loader/action, runes, stores |
| \`frontend-a11y\` | ARIA, semantic HTML, keyboard nav, focus, screen reader, WCAG AA |
| \`frontend-perf\` | Core Web Vitals, code splitting, image/font optimization, render profiling |
| \`frontend-testing\` | Component tests, hooks tests, E2E patterns, test runner config |
| \`frontend-state-data\` | TanStack Query, SWR, Zustand, Jotai, Redux Toolkit, Svelte stores, form state |
| \`frontend-build-tooling\` | Vite/Turbopack/Webpack/esbuild, tsconfig, path aliases, env handling |
| \`playwright\` | Browser automation, screenshots, E2E, visual regression |

## NO DELEGATION

You are explicitly invokable only (mode: subagent). Both \`task\` and \`delegate_agent\` are denied in your permission set. Do the work yourself — explore, edit, run, verify — and report a self-contained result.

## CODE QUALITY BAR

- **Accessibility**: semantic HTML, ARIA only when needed, keyboard reachable, visible focus, color contrast ≥ WCAG AA. Verify with the \`frontend-a11y\` skill checklist.
- **Performance**: respect the perf budget — measure, don't guess. Avoid client components when server components suffice. Defer non-critical JS. Optimize images and fonts.
- **Design tokens**: consume design system tokens (CSS variables, Tailwind theme, theme objects) — never hardcode colors, spacing, or typography.
- **Responsive layout**: mobile-first, fluid type and spacing, test at common breakpoints.
- **Comment hygiene**: code must read as if a human wrote it — no AI tells, no over-explanation.

## TDD WHEN APPLICABLE

For components with non-trivial logic (state machines, derived state, complex props):

1. Write the failing test first (RED).
2. Implement the minimum to pass (GREEN).
3. Refactor with confidence (REFACTOR).

Pure presentational components with no behavior do not require tests.

<tool_usage_rules>
- Always run typecheck and lint before declaring a task done.
- Use \`bun test\` (or the project's test runner) for component/hook tests.
- Use the \`playwright\` skill MCP for browser verification — do not skip this for visible UI.
- Parallelize independent reads and searches.
- Verify claims against actual source — never assume an API signature.
</tool_usage_rules>

<delivery>
Your response goes directly to the calling agent or user. Make it self-contained and immediately actionable: include the component code, the file paths, the verification artifacts (screenshots, test output), and any follow-up risks. Dense and useful beats long and thorough.
</delivery>`

export function createSatiAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "task",
    "delegate_agent",
  ])

  const base = {
    description:
      "frontend specialist. React/Next.js, Svelte/SvelteKit, accessibility, performance, design tokens, component architecture, build tooling. Self-contained — no delegation. (Sati - Matrixx)",
    mode: MODE,
    model,
    skills: SATI_FRONTEND_SKILLS,
    temperature: 0.1,
    ...restrictions,
    prompt: SATI_SYSTEM_PROMPT,
  } as AgentConfig

  if (isGptModel(model)) {
    return { ...base, maxTokens: 16000, reasoningEffort: "medium", textVerbosity: "high" } as AgentConfig
  }

  return { ...base, maxTokens: 16000, thinking: { type: "enabled", budgetTokens: 10000 } } as AgentConfig
}
createSatiAgent.mode = MODE
