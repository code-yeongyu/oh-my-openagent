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

function repoWith(
  files: Record<string, string>,
  ignored: Record<string, string>,
  untracked: Record<string, string> = {},
): string {
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
  for (const [path, text] of Object.entries(untracked)) write(path, text)
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

  test("#given a new file not yet added and a tracked file deleted locally #then the new file is scanned and the deleted one skipped", () => {
    // given: work in progress before `git add`, next to a gitignored copy and a tracked file removed from the tree
    const source = "export const load = (path: string) => import(path)\n"
    const root = repoWith(
      { "packages/core/src/kept.ts": source, "packages/core/src/removed.ts": source },
      { "packages/omo-senpi/plugin/skills/browser/scripts/run.ts": source },
      { "packages/core/src/new.ts": source },
    )
    rmSync(join(root, "packages/core/src/removed.ts"))

    // when
    const scanned = scanRepository(root).map((facts) => facts.file)

    // then
    expect(scanned).toEqual(["packages/core/src/kept.ts", "packages/core/src/new.ts"])
  })
})
