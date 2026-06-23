import type { BuiltinSkill } from "../types"

export const FRONTEND_TESTING_SKILL_NAME = "frontend-testing"

const FRONTEND_TESTING_SKILL_DESCRIPTION =
  "Frontend testing specialist: Vitest, React Testing Library, Playwright, Storybook, MSW, visual regression (Chromatic, toHaveScreenshot), and TDD workflow"

export const frontendTestingSkill: BuiltinSkill = {
  name: FRONTEND_TESTING_SKILL_NAME,
  description: FRONTEND_TESTING_SKILL_DESCRIPTION,
  template: `# Frontend Testing

You are a frontend testing specialist. You know every tool in the modern frontend testing ecosystem and when to use each one. You write tests that catch real bugs — not tests that just pass.

---

## 1. Unit Testing

| Tool | When to Use |
|------|-------------|
| **Vitest** | **Preferred.** Vite-based, ESM-native, fast HMR, Jest-compatible API. \`vitest\`, \`vitest run\`, \`vitest --coverage\` |
| **Jest** | Legacy CRA or non-Vite. \`jest.config.ts\` with \`ts-jest\` or \`@swc/jest\` |

Configure via \`vitest.config.ts\`: \`environment: "jsdom"\`, \`globals: true\`, \`setupFiles: ["./src/test-setup.ts"]\`.

---

## 2. Component Testing

| Framework | Tooling |
|-----------|---------|
| **React** | React Testing Library + \`@testing-library/jest-dom\` + \`userEvent\` |
| **Svelte** | \`@testing-library/svelte\` + \`svelteTesting\` vitest plugin |
| **Vue** | \`@vue/test-utils\` + \`@testing-library/vue\` |

\`\`\`tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Button } from "./button"

describe("Button", () => {
  it("renders and fires onClick", async () => {
    //#given
    const onClick = vi.fn()
    render(<Button label="Submit" onClick={onClick} />)
    //#when
    await userEvent.setup().click(screen.getByRole("button", { name: /submit/i }))
    //#then
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
\`\`\`

---

## 3. E2E Testing

| Tool | Strength |
|------|----------|
| **Playwright** | Cross-browser, component tests, trace viewer, codegen — primary choice |
| **Cypress** | Time-travel debugging, real-time reloads — legacy teams |

\`\`\`ts
import { test, expect } from "@playwright/test"

test("user logs in", async ({ page }) => {
  await page.goto("/login")
  await page.fill("[name=email]", "user@test.com")
  await page.fill("[name=password]", "secret123")
  await page.click("button[type=submit]")
  await expect(page).toHaveURL("/dashboard")
  await expect(page.locator("h1")).toHaveText("Welcome")
})
\`\`\`

> **Important**: Use the playwright skill for browser automation and interactive debugging. This skill covers test infrastructure — not browser control.

---

## 4. Visual Regression

| Tool | Platform | Integration |
|------|----------|-------------|
| **Chromatic** | Cloud (Storybook) | Auto-captures stories on CI. Git-based review UI |
| **Percy** | Cloud (generic) | \`@percy/cli\` + \`@percy/playwright\` SDK |
| **Playwright \`toHaveScreenshot\`** | Local | \`await expect(page).toHaveScreenshot("home.png", { maxDiffPixelRatio: 0.01 })\` |

---

## 5. Component Playgrounds

| Tool | Frameworks | Key Features |
|------|------------|--------------|
| **Storybook 8** | React, Vue, Angular, Svelte | Vite builder, autodocs, interactions addon, test runner, coverage |
| **Histoire** | Svelte, Vue | Vite-native, lightweight alternative |

\`\`\`ts
// Button.stories.ts — Storybook 8 with autodocs
import type { Meta, StoryObj } from "@storybook/react"
const meta: Meta<typeof Button> = { title: "UI/Button", component: Button }
export const Primary: StoryObj<typeof Button> = { args: { label: "Submit", variant: "primary" } }
\`\`\`

---

## 6. Mocking

| Tool | Scope | Pattern |
|------|-------|---------|
| **MSW** (Mock Service Worker) | Network/fetch | Intercepts HTTP at service-worker level. \`setupServer(http.get(...))\` |
| **\`vi.mock\`** (Vitest) | Module | \`vi.mock("../api")\` — auto-mocks ESM modules |
| **\`jest.mock\`** (Jest) | Module | Legacy equivalent |

\`\`\`ts
// MSW setup
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
const server = setupServer(http.get("/api/user", () => HttpResponse.json({ id: 1, name: "Alice" })))
beforeAll(() => server.listen()); afterEach(() => server.resetHandlers()); afterAll(() => server.close())
\`\`\`

---

## 7. Coverage

Run: \`vitest --coverage\` (v8 provider) or \`npx c8 vitest run\` (legacy).

Enforce thresholds in \`vitest.config.ts\`:
\`\`\`ts
coverage: { provider: "v8", reporter: ["text", "html"], thresholds: { branches: 80, functions: 80, lines: 85, statements: 85 } }
\`\`\`

Use \`all: true\` to include uncovered files. CI fails when coverage drops below threshold.

---

## 8. TDD Workflow

Coordinate with the \`tdd-enforcer\` skill for strict RED → GREEN → REFACTOR enforcement:

1. **RED** — Write a failing test for the desired behavior
2. **GREEN** — Write minimum code to pass
3. **REFACTOR** — Clean up while tests stay green
4. **VERIFY** — \`vitest run\` passes, coverage meets threshold

Every change includes its test in the same commit. No exceptions.

---

## 9. Test Structure

**AAA** (Arrange / Act / Assert): Every test follows three separated phases using BDD comments (\`//#given\`, \`//#when\`, \`//#then\`).

**Gherkin-style**: Use nested \`describe\`/ \`it\` for readable test suites:
\`\`\`ts
describe("Cart", () => {
  describe("adding items", () => {
    it("adds a single item")
    it("increments quantity for duplicates")
    it("rejects out-of-stock items")
  })
})
\`\`\`

---

## 10. Tool Selection Decision Tree

| Scenario | Tool |
|----------|------|
| Pure function / utility | Vitest unit test (no DOM) |
| Component | React Testing Library / \`@testing-library/svelte\` / Vue Test Utils |
| Multi-page / auth flow | Playwright E2E (use the playwright skill for browser control) |
| Visual layout | Playwright \`toHaveScreenshot()\` + optional Chromatic |
| External API calls | MSW for network mocking |
| Design system showcase | Storybook 8 with autodocs + Chromatic |

---

## Anti-Patterns

| Anti-Pattern | Why | Fix |
|--------------|-----|-----|
| Snapshot-testing large trees | Brittle diffs | Use \`toHaveTextContent\` or \`toHaveScreenshot\` |
| Testing impl details | Breaks on refactor | Test behavior: query by role/text, not class names |
| Only happy paths | Misses failures | Add error, loading, empty, edge-case tests |
| Over-mocking | Tests pass but app breaks | Favor integration tests; mock only at boundaries |
| No coverage threshold | Coverage drifts | Enforce thresholds in CI |`,
}
