import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scanRepository } from "./remote-import-guard-scan"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function repoWith(files: Record<string, string>, ignored: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "import-guard-scan-"))
  roots.push(root)
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  for (const [path, text] of Object.entries(files)) write(path, text)
  execFileSync("git", ["init", "-q"], { cwd: root })
  execFileSync("git", ["add", "."], { cwd: root })
  write(".gitignore", `${Object.keys(ignored).join("\n")}\n`)
  for (const [path, text] of Object.entries(ignored)) write(path, text)
  return root
}

describe("remote import guard scan", () => {
  test("#given a gitignored build copy beside its tracked source #then only the tracked file is scanned", () => {
    // given: a build step copies a shared skill script into a plugin, gitignored (packages/*/plugin/skills/*/scripts)
    const source = "export const load = (path: string) => import(path)\n"
    const root = repoWith(
      { "packages/shared-skills/skills/browser/scripts/run.ts": source },
      { "packages/omo-senpi/plugin/skills/browser/scripts/run.ts": source },
    )

    // when
    const scanned = scanRepository(root).map((facts) => facts.file)

    // then: the result is the same whether or not the build has run
    expect(scanned).toEqual(["packages/shared-skills/skills/browser/scripts/run.ts"])
  })
})
