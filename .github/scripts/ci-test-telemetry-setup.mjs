import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export function instrumentArguments(args, configPath, timingsPath, workers) {
  let configured = false
  const result = args.map((arg) => {
    if (arg.startsWith("--config=")) {
      configured = true
      return `--config=${configPath}`
    }
    return arg === "--parallel" ? `--parallel=${workers}` : arg
  })
  const testIndex = result.indexOf("test")
  if (testIndex < 0) throw new Error("expected a Bun test invocation")
  // With the existing panic wrapper, config belongs to its inner Bun command.
  if (!configured) result.splice(testIndex, 0, `--config=${configPath}`)
  result.push(`--timings=${timingsPath}`, "--update-timings")
  return result
}

export const SAFE_INVOCATION = /^[a-z0-9-]+$/

export function prepareInstrumentation(directory, invocation, args, workers) {
  if (!SAFE_INVOCATION.test(invocation) || !["2", "4"].includes(workers)) {
    throw new TypeError("expected safe invocation and 2 or 4 workers")
  }
  mkdirSync(directory, { recursive: true })
  const prefix = resolve(directory, invocation)
  const configArgument = args.find((arg) => arg.startsWith("--config="))
  const originalPath = resolve(configArgument?.slice("--config=".length) ?? "bunfig.toml")
  const original = readFileSync(originalPath, "utf8")
  const preloads = Bun.TOML.parse(original).test?.preload
  if (!Array.isArray(preloads) || !preloads.every((name) => typeof name === "string")) {
    throw new TypeError("expected [test].preload to be an array of strings")
  }
  const preloadScript = fileURLToPath(new URL("./ci-test-preload.mjs", import.meta.url))
  const configPath = resolve(`.ci-telemetry-${invocation}-${process.pid}.toml`)
  const preloadOutput = `${prefix}-preload.jsonl`
  const timingsPath = `${prefix}-files.json`
  const launch = instrumentArguments(args, configPath, timingsPath, workers)
  const preloadPattern = /^preload\s*=\s*\[[^\]]*\]/m
  if (!preloadPattern.test(original)) throw new TypeError("expected a single-line-replaceable preload array")
  // No history is read: collecting timings must not rebalance the measured run.
  rmSync(timingsPath, { force: true })
  writeFileSync(preloadOutput, "")
  try {
    writeFileSync(configPath, original.replace(
      preloadPattern, `preload = [${JSON.stringify(preloadScript.replaceAll("\\", "/"))}]`,
    ))
  } catch (error) {
    rmSync(configPath, { force: true })
    throw error
  }
  return { prefix, preloads, configPath, preloadOutput, timingsPath, launch }
}
