import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { extractGlobalConstraints } from "./extractor"

const FIXTURE_ROOT = join(import.meta.dir, "__fixtures__")

function createFixtureDir(name: string): string {
  const dir = join(FIXTURE_ROOT, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeFixture(dir: string, relativePath: string, content: string) {
  const fullPath = join(dir, relativePath)
  mkdirSync(join(fullPath, ".."), { recursive: true })
  writeFileSync(fullPath, content)
}

describe("extractGlobalConstraints", () => {
  beforeEach(() => {
    if (existsSync(FIXTURE_ROOT)) {
      rmSync(FIXTURE_ROOT, { recursive: true, force: true })
    }
  })

  afterEach(() => {
    if (existsSync(FIXTURE_ROOT)) {
      rmSync(FIXTURE_ROOT, { recursive: true, force: true })
    }
  })

  //#given an empty project directory
  //#when extractGlobalConstraints is called
  //#then it returns a minimal constraints document without errors
  it("handles empty project gracefully", async () => {
    const dir = createFixtureDir("empty-project")

    const result = await extractGlobalConstraints(dir)

    expect(typeof result).toBe("string")
    expect(result).toContain("## Existing Types")
    expect(result).toContain("## Project Conventions")
    expect(result).toContain("## Dependencies")
    expect(result).not.toContain("undefined")
    expect(result).not.toContain("null")
  })

  //#given a project with Zod schema files
  //#when extractGlobalConstraints is called
  //#then it extracts Zod type names
  it("extracts Zod schema type names", async () => {
    const dir = createFixtureDir("zod-project")
    writeFixture(dir, "src/config/schema/user.ts", `
import { z } from "zod"

export const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
})

export type User = z.infer<typeof UserSchema>
`)
    writeFixture(dir, "src/config/schema/settings.ts", `
import { z } from "zod"

export const SettingsSchema = z.object({
  theme: z.enum(["dark", "light"]),
  notifications: z.boolean().default(true),
})

export type Settings = z.infer<typeof SettingsSchema>
`)

    const result = await extractGlobalConstraints(dir)

    expect(result).toContain("## Existing Types")
    expect(result).toContain("UserSchema")
    expect(result).toContain("SettingsSchema")
    expect(result).toContain("User")
    expect(result).toContain("Settings")
  })

  //#given a project with TypeScript interface files
  //#when extractGlobalConstraints is called
  //#then it extracts exported interface names
  it("extracts TypeScript interface names", async () => {
    const dir = createFixtureDir("interface-project")
    writeFixture(dir, "src/types.ts", `
export interface ApiResponse {
  status: number
  data: unknown
}

export interface UserProfile {
  id: string
  name: string
  email: string
}
`)

    const result = await extractGlobalConstraints(dir)

    expect(result).toContain("## Existing Types")
    expect(result).toContain("ApiResponse")
    expect(result).toContain("UserProfile")
  })

  //#given a project with type aliases
  //#when extractGlobalConstraints is called
  //#then it extracts type alias names
  it("extracts type alias names", async () => {
    const dir = createFixtureDir("type-alias-project")
    writeFixture(dir, "src/types.ts", `
export type UserId = string
export type Priority = "high" | "medium" | "low"
export type Config = Record<string, unknown>
`)

    const result = await extractGlobalConstraints(dir)

    expect(result).toContain("## Existing Types")
    expect(result).toContain("UserId")
    expect(result).toContain("Priority")
    expect(result).toContain("Config")
  })

  //#given a project with AGENTS.md
  //#when extractGlobalConstraints is called
  //#then it extracts project conventions
  it("extracts conventions from AGENTS.md", async () => {
    const dir = createFixtureDir("agents-project")
    writeFixture(dir, "AGENTS.md", `# Project Knowledge Base

## CONVENTIONS

- **Package manager**: Bun only
- **Naming**: kebab-case dirs
- **Testing**: BDD comments

## ANTI-PATTERNS

- No npm or yarn
- No @types/node
`)

    const result = await extractGlobalConstraints(dir)

    expect(result).toContain("## Project Conventions")
    expect(result).toContain("Bun only")
  })

  //#given a project with package.json
  //#when extractGlobalConstraints is called
  //#then it extracts dependency information
  it("extracts dependencies from package.json", async () => {
    const dir = createFixtureDir("deps-project")
    writeFixture(dir, "package.json", JSON.stringify({
      name: "test-project",
      dependencies: {
        "zod": "^3.23.0",
        "express": "^4.18.0",
      },
      devDependencies: {
        "typescript": "^5.0.0",
      },
    }, null, 2))

    const result = await extractGlobalConstraints(dir)

    expect(result).toContain("## Dependencies")
    expect(result).toContain("zod")
    expect(result).toContain("express")
    expect(result).toContain("typescript")
  })

  //#given a project with all artifact types
  //#when extractGlobalConstraints is called
  //#then output contains all three sections
  it("produces complete markdown with all sections", async () => {
    const dir = createFixtureDir("full-project")
    writeFixture(dir, "src/schema.ts", `
import { z } from "zod"
export const ItemSchema = z.object({ id: z.string() })
export type Item = z.infer<typeof ItemSchema>
`)
    writeFixture(dir, "src/types.ts", `
export interface Widget { name: string }
export type WidgetId = string
`)
    writeFixture(dir, "AGENTS.md", `# KB\n## CONVENTIONS\n- Use Bun\n`)
    writeFixture(dir, "package.json", JSON.stringify({
      name: "full",
      dependencies: { "lodash": "^4.17.0" },
    }))

    const result = await extractGlobalConstraints(dir)

    expect(result).toContain("## Existing Types")
    expect(result).toContain("## Project Conventions")
    expect(result).toContain("## Dependencies")

    expect(result).toContain("ItemSchema")
    expect(result).toContain("Widget")
    expect(result).toContain("WidgetId")

    expect(result).toContain("lodash")
  })

  //#given a non-existent directory
  //#when extractGlobalConstraints is called
  //#then it returns minimal constraints without throwing
  it("handles non-existent directory gracefully", async () => {
    const result = await extractGlobalConstraints("/tmp/nonexistent-project-12345")

    expect(typeof result).toBe("string")
    expect(result).toContain("## Existing Types")
    expect(result).toContain("## Project Conventions")
    expect(result).toContain("## Dependencies")
  })

  //#given the extraction function
  //#when called on any project
  //#then it makes no LLM calls (deterministic)
  it("output is pure markdown text", async () => {
    const dir = createFixtureDir("markdown-check")

    const result = await extractGlobalConstraints(dir)

    expect(result).toMatch(/^# Global Constraints/)
    expect(result).not.toContain("{")
    const sections = result.match(/^## /gm) || []
    expect(sections.length).toBeGreaterThanOrEqual(3)
  })

  //#given a project with deeply nested schema files
  //#when extractGlobalConstraints is called
  //#then it finds schemas in subdirectories
  it("scans nested directories for schemas", async () => {
    const dir = createFixtureDir("nested-project")
    writeFixture(dir, "src/modules/auth/schema.ts", `
import { z } from "zod"
export const AuthTokenSchema = z.object({ token: z.string() })
`)
    writeFixture(dir, "src/modules/billing/types.ts", `
export interface Invoice { amount: number }
`)

    const result = await extractGlobalConstraints(dir)

    expect(result).toContain("AuthTokenSchema")
    expect(result).toContain("Invoice")
  })

  //#given the extraction function
  //#when called
  //#then it completes in under 5 seconds
  it("runs fast (< 5 seconds)", async () => {
    const dir = createFixtureDir("perf-project")
    const start = performance.now()
    await extractGlobalConstraints(dir)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(5000)
  })
})
