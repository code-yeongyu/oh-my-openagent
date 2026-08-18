#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

const args = process.argv.slice(2)
const runDir = process.env.OMO_MEMORY_SUPERVISOR_TASKKILL_RUN_DIR
if (runDir === undefined) throw new Error("termination fixture requires a run directory")
const child = JSON.parse(readFileSync(join(runDir, "child-started.json"), "utf8")) as { readonly pid: number }
const kill = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(pid, signal)
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
  }
}

const signalGroupIndex = args.indexOf("--signal-group")
if (signalGroupIndex >= 0) {
  const targetPid = Number(args[signalGroupIndex + 1])
  const signal = args[signalGroupIndex + 2]
  if (!Number.isInteger(targetPid) || (signal !== "SIGTERM" && signal !== "SIGKILL")) {
    throw new Error("signal-group fixture requires a pid and supported signal")
  }
  kill(child.pid, signal)
  if (signal === "SIGKILL") kill(targetPid, signal)
} else {
  const pidIndex = args.indexOf("/pid")
  const targetPid = Number(args[pidIndex + 1])
  if (!Number.isInteger(targetPid)) throw new Error("taskkill fixture requires a pid")
  await writeFile(join(runDir, "taskkill-invocation.json"), `${JSON.stringify({ args })}\n`, "utf8")
  for (const pid of [child.pid, targetPid]) kill(pid, "SIGKILL")
}
