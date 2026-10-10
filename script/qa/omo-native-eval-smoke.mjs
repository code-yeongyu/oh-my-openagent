#!/usr/bin/env bun
// Drives a packaged omo binary through eval end to end with the source checkout hidden. The pieces live beside it:
// the sandbox (omo-native-eval-smoke-sandbox), the host processes and source hiding (omo-native-eval-smoke-host),
// one run and its result readers (omo-native-eval-smoke-run), and the per-leg checks (omo-native-eval-smoke-assertions).
import { execFile } from "node:child_process"
import { existsSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { assertEvalLegs } from "./omo-native-eval-smoke-assertions.mjs"
import { ownedProcesses, renameAside } from "./omo-native-eval-smoke-host.mjs"
import { drive } from "./omo-native-eval-smoke-run.mjs"
import { createSandbox, isolatedEnvironment } from "./omo-native-eval-smoke-sandbox.mjs"

const sourceTree = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."))
const exec = promisify(execFile)

function parseArgs(argv) {
  if (argv.length === 1) return resolve(argv[0])
  if (argv.length === 2 && argv[0] === "--binary") return resolve(argv[1])
  throw new Error("usage: bun script/qa/omo-native-eval-smoke.mjs <binary>")
}

async function main() {
  const sandbox = createSandbox(parseArgs(process.argv.slice(2)))
  const previousCwd = process.cwd()
  // Windows shells hold the checkout root open; hide every original entry there.
  const trees = process.platform === "win32"
    ? readdirSync(sourceTree).map((name) => join(sourceTree, name))
    : [sourceTree]
  const hiddenTrees = []
  const hostSockets = []
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", interrupt)
  try {
    process.chdir(sandbox.root)
    for (const tree of trees) {
      const hidden = `${tree}.eval-hidden-${sandbox.marker}`
      await renameAside(tree, hidden)
      hiddenTrees.push({ tree, hidden })
    }
    if (trees.some(existsSync)) throw new Error("source checkout remains accessible")
    const result = await drive(sandbox, controller.signal)
    if (process.platform !== "win32") {
      const shutdown = await exec(sandbox.binary, ["daemon", "stop", "--all", "--wait", "--timeout", "30"], {
        cwd: sandbox.cwd, env: isolatedEnvironment(sandbox), timeout: 60_000, signal: controller.signal,
      })
      process.stderr.write(`SHUTDOWN ${shutdown.stdout.trim()}\n`)
      for (const line of shutdown.stdout.split("\n")) {
        const socket = line.match(/^(.+\.sock): drained/)?.[1]
        if (socket) hostSockets.push(socket)
      }
    }
    if (result.code !== 0) throw new Error(`binary exited code=${result.code}\n${result.stderr.slice(-4000)}`)
    const passes = assertEvalLegs(sandbox, result)
    const survivors = await ownedProcesses(sandbox.root)
    const sockets = readdirSync(sandbox.root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isSocket())
    if (survivors.length || sockets.length || hostSockets.some(existsSync)) {
      throw new Error(`shutdown leaked owned processes/sockets: ${JSON.stringify(survivors)} sockets=${sockets.length}`)
    }
    for (const line of passes) process.stdout.write(`${line}\n`)
    process.stdout.write("PASS renamed source tree; owned workers/interpreters=0 sockets=0\n")
  } finally {
    for (const { tree, hidden } of hiddenTrees.reverse()) renameSync(hidden, tree)
    process.chdir(previousCwd)
    process.removeListener("SIGINT", interrupt)
    process.removeListener("SIGTERM", interrupt)
    const survivors = await ownedProcesses(sandbox.root)
    for (const { pid } of survivors) process.kill(pid, "SIGKILL")
    for (const namespace of new Set(hostSockets.map(dirname))) {
      if (basename(namespace).startsWith("omo-rpc-")) rmSync(namespace, { recursive: true, force: true })
    }
    rmSync(sandbox.root, { recursive: true, force: true })
    process.stderr.write(`CLEANUP source restored; sandbox removed; owned survivors terminated=${survivors.length}\n`)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
