import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OmoConfigWriteError, updateOmoConfig } from "@oh-my-opencode/omo-config-core"

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const root = mkdtempSync(join(tmpdir(), "omo-config-manual-parent-symlink-"))
let cleanedUp = false

try {
  const homeDir = join(root, "home")
  const xdgConfigHome = join(root, "xdg")
  const symlinkedProjectDir = join(homeDir, "symlinked-project")
  const targetConfigDir = join(xdgConfigHome, "omo")
  const targetConfigPath = join(targetConfigDir, "omo.jsonc")
  const originalGlobalConfig = `{"task":{"default_concurrency":8}}\n`
  mkdirSync(symlinkedProjectDir, { recursive: true })
  mkdirSync(targetConfigDir, { recursive: true })
  writeFileSync(targetConfigPath, originalGlobalConfig)
  symlinkSync(targetConfigDir, join(symlinkedProjectDir, ".omo"))

  let rejected = false
  let rejectionName = "none"
  try {
    updateOmoConfig({
      scope: "project",
      projectDir: symlinkedProjectDir,
      edits: [{ path: ["task", "default_concurrency"], value: 4 }],
      env: { HOME: homeDir, XDG_CONFIG_HOME: xdgConfigHome },
      platform: "linux",
    })
  } catch (error) {
    rejected = error instanceof OmoConfigWriteError
    rejectionName = error instanceof Error ? error.name : String(error)
  }

  const targetAfterRejectedWrite = readFileSync(targetConfigPath, "utf-8")
  const targetBackups = readdirSync(targetConfigDir).filter((entry) => entry.includes(".bak."))

  const normalProjectDir = join(homeDir, "normal-project")
  mkdirSync(normalProjectDir, { recursive: true })
  const normalResult = updateOmoConfig({
    scope: "project",
    projectDir: normalProjectDir,
    edits: [{ path: ["task", "default_concurrency"], value: 6 }],
    env: { HOME: homeDir, XDG_CONFIG_HOME: xdgConfigHome },
    platform: "linux",
  })
  const normalConfig = readFileSync(normalResult.path, "utf-8")

  assert(rejected, `expected symlinked project .omo write to reject, saw ${rejectionName}`)
  assert(targetAfterRejectedWrite === originalGlobalConfig, "fixture global config changed")
  assert(targetBackups.length === 0, "backup was created in symlink target")
  assert(normalResult.path === join(normalProjectDir, ".omo", "omo.jsonc"), "normal project write used unexpected path")
  assert(normalConfig.includes(`"default_concurrency": 6`), "normal project write did not persist the edit")

  rmSync(root, { force: true, recursive: true })
  cleanedUp = !existsSync(root)
  assert(cleanedUp, "temp fixture root still exists after cleanup")

  console.log(
    JSON.stringify(
      {
        cleanedUp,
        normalProjectWrite: "succeeded",
        normalProjectWritePath: normalResult.path,
        rejectedSymlinkedProjectOmo: rejected,
        rejectionName,
        targetBackups,
        targetGlobalConfigUnchanged: targetAfterRejectedWrite === originalGlobalConfig,
      },
      null,
      2,
    ),
  )
} finally {
  if (!cleanedUp) rmSync(root, { force: true, recursive: true })
}
