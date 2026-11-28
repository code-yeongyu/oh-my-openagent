import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveUserOmoConfigPath, resolveOmoConfigPaths } from "../../../omo-config-core/src/loader/paths.ts"
import { resolveMemoryRoot } from "../../../memory-core/src/identity/layout.ts"

import { createSandbox } from "./drive.mjs"
import { spawnEnv } from "./model-profile-e2e.mjs"
import { SCENARIOS } from "./model-profile-e2e-scenarios.mjs"

/**
 * Regression for oh-my-openagent#13561. The model-profile QA driver builds its child environment
 * from the caller's own environment; before the fix that env carried the operator's HOME and
 * USERPROFILE untouched, so the child senpi resolved the omo config USER layer
 * (`~/.omo/omo.jsonc`) from the operator's real home and every scenario could read a live
 * operator's model profiles instead of only the seeded sandbox config. These tests call the
 * driver's REAL environment constructor (`spawnEnv`, no copy) against the driver's REAL sandbox
 * (`createSandbox`) while the parent process itself runs under a synthetic operator home seeded
 * with a poisoned user-layer config.
 */
const POISONED_MARKER = "qa-operator-home-poison"

function seedPoisonedOperatorHome() {
  const home = mkdtempSync(join(tmpdir(), "model-profile-operator-home-"))
  mkdirSync(join(home, ".omo"), { recursive: true })
  writeFileSync(
    join(home, ".omo", "omo.jsonc"),
    `${JSON.stringify({ model_profile: POISONED_MARKER, model_profiles: { "daily-normal": POISONED_MARKER } }, null, 2)}\n`,
  )
  return home
}

function withOperatorHome(run) {
  const operatorHome = seedPoisonedOperatorHome()
  const savedHome = process.env.HOME
  const savedUserProfile = process.env.USERPROFILE
  process.env.HOME = operatorHome
  process.env.USERPROFILE = operatorHome
  try {
    return run(operatorHome)
  } finally {
    if (savedHome === undefined) delete process.env.HOME
    else process.env.HOME = savedHome
    if (savedUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = savedUserProfile
    rmSync(operatorHome, { recursive: true, force: true })
  }
}

describe("model-profile-e2e spawnEnv operator home isolation (#13561)", () => {
  test("routes the child HOME and USERPROFILE into the sandbox, never the operator's home", () => {
    withOperatorHome((operatorHome) => {
      const sandbox = createSandbox()
      const sessionDir = join(sandbox.root, "sessions")
      try {
        const env = spawnEnv(sandbox, sessionDir, SCENARIOS["daily-normal-opus"])

        expect(env.HOME).toBe(sandbox.homeDir)
        expect(env.USERPROFILE).toBe(sandbox.homeDir)
        expect(env.HOME).not.toBe(operatorHome)
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true })
      }
    })
  })

  test("the real omo config path resolver never selects the poisoned operator user layer", () => {
    withOperatorHome((operatorHome) => {
      const sandbox = createSandbox()
      const sessionDir = join(sandbox.root, "sessions")
      mkdirSync(sessionDir, { recursive: true })
      try {
        const env = spawnEnv(sandbox, sessionDir, SCENARIOS["daily-normal-opus"])

        // The USER layer follows the child's HOME (omo-config-core paths.ts resolveHomeDir).
        const userPath = resolveUserOmoConfigPath(env)
        expect(userPath).toBe(join(sandbox.homeDir, ".omo", "omo.jsonc"))
        expect(userPath.startsWith(operatorHome)).toBe(false)

        // Every candidate the walk would read stays out of the operator's home, and the sandbox
        // home starts clean: no user layer materializes there, poisoned or otherwise.
        const candidates = resolveOmoConfigPaths({ cwd: sandbox.cwd, env })
        for (const candidate of candidates) expect(candidate.path.startsWith(operatorHome)).toBe(false)
        expect(existsSync(userPath)).toBe(false)

        // The poisoned operator user layer really exists: if the child inherited HOME it would
        // be merged into every scenario; with the fix it is not even a candidate.
        expect(existsSync(join(operatorHome, ".omo", "omo.jsonc"))).toBe(true)
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true })
      }
    })
  })

  test("keeps resolving the child memory root inside the sandbox under an operator home", () => {
    withOperatorHome(() => {
      const sandbox = createSandbox()
      const sessionDir = join(sandbox.root, "sessions")
      try {
        const env = spawnEnv(sandbox, sessionDir, SCENARIOS["daily-normal-opus"])

        expect(resolveMemoryRoot(env, sandbox.cwd).startsWith(sandbox.root)).toBe(true)
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true })
      }
    })
  })
})
