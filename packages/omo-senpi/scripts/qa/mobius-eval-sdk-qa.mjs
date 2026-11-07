#!/usr/bin/env bun
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isolatedEnvironment, processGroupMembers } from "./agent-toolkit-eval-sdk-qa-support.mjs"
import { changedSnapshotPaths, protectedSnapshotsUntouched, snapshotProtectedState } from "./isolation-state.mjs"

const script = fileURLToPath(import.meta.url)
const packageRoot = resolve(dirname(script), "../..")
const args = process.argv.slice(2)
function argument(name) {
  const value = args[args.indexOf(name) + 1]
  assert.ok(args.includes(name) && value && !value.startsWith("--"), `${name} requires a path`)
  return resolve(value)
}

async function supervise() {
  const evidence = argument("--evidence-dir")
  const allowed = resolve(packageRoot, "../../.omo/evidence/omo-senpi-adapter")
  const within = relative(allowed, evidence)
  assert.ok(within && !within.startsWith("..") && !isAbsolute(within), "use the senpi-qa evidence resolver")
  mkdirSync(evidence, { recursive: true })
  const transcript = join(evidence, "mobius-native.log")
  writeFileSync(transcript, `COMMAND ${JSON.stringify(process.argv)}\n`)
  const homes = [join(homedir(), ".senpi/agent"), join(homedir(), ".omo/agent")]
  const before = homes.map((path) => snapshotProtectedState(path))
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "omo-mobius-live-")))
  for (const dir of ["agent", "home", "project", "tmp"]) mkdirSync(join(sandbox, dir))
  const log = (chunk) => {
    appendFileSync(transcript, chunk)
    process.stdout.write(chunk)
  }
  let child
  let deadline
  let exitCode = 1
  let survivors = []
  try {
    child = spawn(process.execPath, [script, "--worker", sandbox], {
      cwd: join(sandbox, "project"),
      env: isolatedEnvironment(sandbox, packageRoot),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    })
    child.stdout.on("data", log)
    child.stderr.on("data", log)
    exitCode = await new Promise((accept, reject) => {
      child.once("error", reject)
      child.once("close", (code) => accept(code ?? 1))
      deadline = setTimeout(() => {
        log("FAIL Mobius QA deadline exceeded\n")
        if (process.platform === "win32") child.kill()
        else process.kill(-child.pid, "SIGKILL")
      }, 180_000)
    })
  } finally {
    clearTimeout(deadline)
    if (child?.pid && process.platform !== "win32") {
      survivors = processGroupMembers(child.pid)
      if (survivors.length) {
        process.kill(-child.pid, "SIGKILL")
        exitCode = 1
      }
    }
    if (child?.pid && process.platform === "win32" && exitCode !== 0) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true })
    }
    const after = homes.map((path) => snapshotProtectedState(path))
    const protectedStateUntouched = before.every((snapshot, i) => protectedSnapshotsUntouched(snapshot, after[i]))
    if (!protectedStateUntouched) exitCode = 1
    const receipt = {
      exitCode,
      isolatedAgentDir: join(sandbox, "agent"),
      isolatedHome: join(sandbox, "home"),
      realHomeCheckScope: "auth, settings, models, models-store, trust, hooks-state",
      protectedStateUntouched,
      changedProtectedPaths: homes.map((path, i) => ({
        path,
        changed: changedSnapshotPaths(before[i].snapshot, after[i].snapshot),
      })),
      survivors,
    }
    rmSync(sandbox, { recursive: true, force: true })
    writeFileSync(join(evidence, "mobius-native.json"), `${JSON.stringify(receipt, null, 2)}\n`)
    log(`MOBIUS_QA ${JSON.stringify(receipt)}\n`)
  }
  return exitCode
}

try {
  if (args.includes("--worker")) {
    const { runMobiusNativeScenario } = await import("./mobius-eval-sdk-scenario.mjs")
    await runMobiusNativeScenario({ sandbox: argument("--worker"), pluginRoot: join(packageRoot, "plugin") })
    process.exitCode = 0
  } else {
    process.exitCode = await supervise()
  }
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
}
