import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect } from "bun:test"

const root = join(import.meta.dir, "../..")

// Exercise the ratchet configuration (the shipped config that enables these rules), so losing its
// jsPlugins entry must fail too. Fixtures are written outside the repository, inside the OS temp
// root, so no repo-side scan can meet them.
export const findings = (source: string, code: string): { readonly message: string }[] => {
  const dir = mkdtempSync(join(tmpdir(), "omo-testing-rules-"))
  try {
    const file = join(dir, "fixture.test.ts")
    writeFileSync(file, source)
    const result = Bun.spawnSync(
      [join(root, "node_modules/.bin/oxlint"), "-c", "script/lint-ratchet.oxlintrc.json", "-f", "json", file],
      { cwd: root },
    )
    expect([0, 1]).toContain(result.exitCode)
    const { diagnostics }: { diagnostics: { code?: string; message?: string }[] } = JSON.parse(result.stdout.toString())
    return diagnostics
      .filter((diagnostic) => diagnostic.code === code)
      .map(({ message }) => ({ message: message ?? "" }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
