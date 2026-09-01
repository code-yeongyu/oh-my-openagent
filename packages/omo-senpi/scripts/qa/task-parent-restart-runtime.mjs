import { existsSync, mkdirSync, watch, writeFileSync } from "node:fs"
import { delimiter, dirname, resolve } from "node:path"

export function parseArgs(argv) {
  const options = { evidenceDir: undefined, pluginPath: undefined, selfTest: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--self-test") {
      options.selfTest = true
      continue
    }
    if (argument === "--evidence-dir" || argument === "--plugin-path") {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${argument} requires a value`)
      if (argument === "--evidence-dir") options.evidenceDir = resolve(value)
      else options.pluginPath = resolve(value)
      index += 1
      continue
    }
    throw new Error(`unknown argument: ${argument}`)
  }
  return options
}

export function findCommand(command) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(directory || ".", command)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`${command} was not found on PATH`)
}

export function processAlive(pid) {
  if (typeof pid !== "number") return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function writeArtifact(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}

export function waitForFileEventCommand(path) {
  const source = [
    'const fs = require("node:fs")',
    'const nodePath = require("node:path")',
    `const target = ${JSON.stringify(path)}`,
    "if (fs.existsSync(target)) process.exit(0)",
    "const watcher = fs.watch(nodePath.dirname(target), () => {",
    "  if (!fs.existsSync(target)) return",
    "  clearTimeout(timer)",
    "  watcher.close()",
    "})",
    "const timer = setTimeout(() => { watcher.close(); process.exit(1) }, 45000)",
  ].join(";")
  return `node -e ${JSON.stringify(source)}`
}

export function waitForState(root, readValue, accepted, timeoutMs, signal) {
  return new Promise((resolveValue, reject) => {
    let settled = false
    let timer
    let watcher
    const finish = (value, error) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      watcher?.close()
      signal.removeEventListener("abort", abort)
      if (error !== undefined) reject(error)
      else resolveValue(value)
    }
    const abort = () => finish(undefined, new Error("state transition aborted"))
    const check = () => {
      try {
        const value = readValue()
        if (accepted(value)) finish(value)
      } catch (error) {
        finish(undefined, error)
      }
    }
    signal.addEventListener("abort", abort, { once: true })
    watcher = watch(root, { recursive: true }, check)
    timer = setTimeout(
      () => finish(undefined, new Error(`state transition timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
    queueMicrotask(check)
  })
}
