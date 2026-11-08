import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createOmoSenpiComponents } from "../../extension/component-list"
import { readBundledSkillNames } from "./bare-skill-command"

// Every slash command omo tells a Native user to type must dispatch (#9042): a bundled skill
// (served bare by this component), an omo-registered command, or an engine command.

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const repoRoot = join(packageRoot, "../..")
const senpiDistDir = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
// The engine's own builtin list, read as data: scraping the dist text broke when an entry
// gained fields and wrapped onto several lines (senpi #2482).
const { BUILTIN_SLASH_COMMANDS } = (await import(pathToFileURL(join(senpiDistDir, "core/slash-commands.js")).href)) as {
  BUILTIN_SLASH_COMMANDS: ReadonlyArray<{ name: string }>
}

const NATIVE_SKILL_ROOTS = [join(packageRoot, "skills"), join(repoRoot, "packages/shared-skills/skills")]
const NATIVE_GUIDES = ["docs/guide/overview.md", "docs/guide/orchestration.md", "README.md"].map((path) => join(repoRoot, path))

// An opening inline-code span that starts with a command token: `/ulw-execute`, `/ulw-execute plan`.
const DOCUMENTED_COMMAND = /(?:^|[\s(|"'>])`\/([a-z][a-z0-9-]*)(?=[\s`])/gm

function walkFiles(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : walkFiles(path, keep)
    return keep(path) ? [path] : []
  })
}

function matchesOf(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
}

function nativeSurfaceFiles(): string[] {
  const skillFiles = NATIVE_SKILL_ROOTS.flatMap((root) =>
    readdirSync(root)
      .map((name) => join(root, name, "SKILL.md"))
      .filter((path) => existsSync(path)),
  )
  return [...skillFiles, ...NATIVE_GUIDES]
}

function engineCommandNames(): Set<string> {
  const builtin = BUILTIN_SLASH_COMMANDS.map((command) => command.name)
  const extensionCommands = walkFiles(join(senpiDistDir, "core/extensions/builtin"), (path) => path.endsWith(".js")).flatMap((path) =>
    matchesOf(/registerCommand\("([a-z-]+)"/g, readFileSync(path, "utf8")),
  )
  return new Set([...builtin, ...extensionCommands])
}

function omoCommandNames(): Set<string> {
  const sources = walkFiles(join(packageRoot, "src"), (path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
  return new Set(sources.flatMap((path) => matchesOf(/registerCommand\("([a-z-]+)"/g, readFileSync(path, "utf8"))))
}

function bundledSkillNames(): Set<string> {
  return new Set(NATIVE_SKILL_ROOTS.flatMap((root) => [...readBundledSkillNames(root)]))
}

describe("documented slash commands on OmO Native", () => {
  test("#given omo's shipped skills and Native guides #when they name a /command #then that command dispatches", () => {
    const known = new Set([...bundledSkillNames(), ...omoCommandNames(), ...engineCommandNames()])
    const unregistered = nativeSurfaceFiles().flatMap((path) =>
      matchesOf(DOCUMENTED_COMMAND, readFileSync(path, "utf8"))
        .filter((name) => !known.has(name))
        .map((name) => `${relative(repoRoot, path)}: /${name}`),
    )

    expect(unregistered).toEqual([])
  })

  test("#given the scan's inputs #when resolved #then each source is populated, so an empty set cannot pass vacuously", () => {
    expect(bundledSkillNames()).toContain("ulw-execute")
    expect(omoCommandNames()).toContain("tasks")
    expect(engineCommandNames()).toContain("model")
    expect(engineCommandNames()).toContain("goal")
    const documented = nativeSurfaceFiles().flatMap((path) => matchesOf(DOCUMENTED_COMMAND, readFileSync(path, "utf8")))
    expect(documented).toContain("ulw-execute")
  })

  test("#given the component order #when omo registers #then skill-commands precedes every component with an input handler", () => {
    const names = createOmoSenpiComponents({ name: "task", register() {} }).map((component) => component.name)
    const aliasIndex = names.indexOf("skill-commands")

    expect(aliasIndex).toBeGreaterThanOrEqual(0)
    for (const reader of ["telemetry", "ultrawork", "skill-pointers", "ulw-execute-continuation", "ulw-loop", "fallback-architect", "task", "memory"]) {
      expect({ reader, before: aliasIndex < names.indexOf(reader) }).toEqual({ reader, before: true })
    }
  })
})
