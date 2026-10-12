import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { removeTreeSync } from "../test-support/remove-tree"

describe("test environment isolation", () => {
  test("#given the host has an OpenCode server password #when the test preload runs #then the credential is not inherited by tests", () => {
    expect(process.env.OPENCODE_SERVER_PASSWORD).toBeUndefined()
  })
})


describe("test file environment integrity", () => {
  test("#given shared worker files #when a file restores or leaks env keys #then teardown reports leaks and the next file sees the baseline", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-env-integrity-"))
    try {
      const integrityPath = resolve(import.meta.dir, "../test-support/environment-integrity.ts")
      writeFileSync(join(root, "preload.ts"), `import { installEnvironmentIntegrityCheck } from ${JSON.stringify(integrityPath)}\ninstallEnvironmentIntegrityCheck()\n`)
      writeFileSync(join(root, "bunfig.toml"), '[test]\npreload = ["./preload.ts"]\n')
      const mutation = [
        'process.env.OMO_ENV_ADDED = "secret-added-value"',
        'delete process.env.OMO_ENV_REMOVED',
        'process.env.OMO_ENV_CHANGED = "secret-changed-value"',
      ].join("\n")
      const env: NodeJS.ProcessEnv = { ...process.env, OMO_ENV_REMOVED: "original", OMO_ENV_CHANGED: "original" }
      delete env.CI
      delete env.GITHUB_ACTIONS
      const mutatePath = join(root, "a-mutate.test.ts")
      const nextPath = join(root, "b-next.test.ts")
      writeFileSync(nextPath, [
        'import { expect, test } from "bun:test"',
        'test("next file has original env", () => {',
        '  expect(process.env.OMO_ENV_ADDED).toBeUndefined()',
        '  expect(process.env.OMO_ENV_REMOVED).toBe("original")',
        '  expect(process.env.OMO_ENV_CHANGED).toBe("original")',
        '})',
      ].join("\n"))
      const run = () => spawnSync(process.execPath, ["test", "--parallel=1", "--no-isolate", mutatePath, nextPath], { cwd: root, env, encoding: "utf8", timeout: 20_000 })
      writeFileSync(mutatePath, [
        'import { afterAll, expect, test } from "bun:test"',
        'const baseline = { ...process.env }',
        mutation,
        'afterAll(() => { delete process.env.OMO_ENV_ADDED; Object.assign(process.env, baseline) })',
        'test("mutated file runs", () => { process.env.OMO_ENV_ADDED = "secret-added-value"; delete process.env.OMO_ENV_REMOVED; process.env.OMO_ENV_CHANGED = "secret-changed-value"; expect(process.env.OMO_ENV_ADDED).toBeDefined() })',
      ].join("\n"))
      const clean = run()
      expect(`${clean.stdout}${clean.stderr}`).toContain("2 pass")
      expect(clean.status).toBe(0)
      // Removing the file's restore is the negative control required by #9390.
      writeFileSync(mutatePath, [
        'import { expect, test } from "bun:test"',
        mutation,
        'test("mutated file runs", () => { process.env.OMO_ENV_ADDED = "secret-added-value"; delete process.env.OMO_ENV_REMOVED; process.env.OMO_ENV_CHANGED = "secret-changed-value"; expect(process.env.OMO_ENV_ADDED).toBeDefined() })',
      ].join("\n"))
      const leaking = run()
      const output = `${leaking.stdout}${leaking.stderr}`
      expect(leaking.status).not.toBe(0)
      expect(output).toContain("a-mutate.test.ts")
      expect(output).toContain("added [OMO_ENV_ADDED]; removed [OMO_ENV_REMOVED]; changed [OMO_ENV_CHANGED]")
      expect(output).not.toContain("secret-added-value")
      expect(output).not.toContain("secret-changed-value")
      expect(output).toContain("next file has original env")
      expect(output).toContain("2 pass")
    } finally {
      removeTreeSync(root)
    }
  }, 30_000)
})
