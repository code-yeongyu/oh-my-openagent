#!/usr/bin/env bun
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const senpiBin = process.env.SENPI_BIN ?? Bun.which("senpi")
const sandbox = createSandbox()

function writeConfig(stepCount) {
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify({
    categories: {
      quick: {
        models: [
          { model: "extension-only/primary", reasoning: "off" },
          { model: "omo-mock/mock-1", reasoning: "minimal" },
        ],
      },
    },
    memory: {
      enabled: true,
      facts: { enabled: false },
      reflection: {
        trigger: { step_count: stepCount, on_compaction: false },
      },
    },
  }, null, 2)}\n`)
}

function writeParentOnlyProvider() {
  const path = join(sandbox.root, "parent-only-provider.ts")
  writeFileSync(path, `
import registerMockProvider from ${JSON.stringify(mockProviderEntry)}

export default function register(pi) {
  registerMockProvider(pi)
  pi.registerProvider("extension-only", {
    name: "parent-only provider",
    baseUrl: "file://parent-only",
    apiKey: "mock",
    api: "openai-completions",
    models: [{
      id: "primary",
      name: "Parent-only primary",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 4096
    }],
    streamSimple() {
      throw new Error("parent-only model must never execute")
    }
  })
}
`)
  return path
}

function writeChildShim() {
  const path = join(sandbox.root, "senpi-child-shim")
  writeFileSync(path, `#!/bin/sh
if [ -n "$TRANSCRIPT_PATH" ]; then
  printf '%s\n' "$*" >> "$(dirname "$TRANSCRIPT_PATH")/attempts.log"
fi
exec ${JSON.stringify(senpiBin)} -e ${JSON.stringify(mockProviderEntry)} "$@"
`)
  Bun.spawnSync(["chmod", "+x", path])
  return path
}

function writeCompletionHold(completions) {
  const path = join(sandbox.root, "completion-hold.js")
  writeFileSync(path, `
import { mkdirSync, readdirSync, watch } from "node:fs"

export default function holdUntilReflectionCompletes(pi) {
  pi.on("agent_settled", () => {
    mkdirSync(${JSON.stringify(completions)}, { recursive: true })
    const existing = new Set(readdirSync(${JSON.stringify(completions)}))
    const subscription = watch(${JSON.stringify(completions)}, () => {
      const completed = readdirSync(${JSON.stringify(completions)})
        .some((name) => name.endsWith(".json") && !existing.has(name))
      if (!completed) return
      clearTimeout(timer)
      subscription.close()
    })
    const timer = setTimeout(() => subscription.close(), 90000)
  })
}
`)
  return path
}

function writeMockScript(steps) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({ steps }, null, 2)}\n`)
}

async function runParent(parentProvider, childShim, prompt, extraExtensions = []) {
  const child = spawn(senpiBin, [
    "-e", parentProvider,
    ...extraExtensions.flatMap((extension) => ["-e", extension]),
    "-p",
    "--mode", "json",
    "--provider", "omo-mock",
    "--model", "mock-1",
    "--session-dir", join(sandbox.agentDir, "sessions"),
    prompt,
  ], {
    cwd: sandbox.cwd,
    env: {
      ...process.env,
      SENPI_BIN: childShim,
      SENPI_CODING_AGENT_DIR: sandbox.agentDir,
      XDG_CONFIG_HOME: sandbox.xdgConfigHome,
      OMO_MEMORY_HOME: join(sandbox.root, "memory"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => { stderr += chunk })
  const code = await new Promise((resolve) => child.once("close", resolve))
  if (code !== 0) throw new Error(stderr.slice(-1000) || `parent exited ${code}`)
}

function memoryRepo() {
  const agents = join(sandbox.root, "memory", "agents")
  const identity = readdirSync(agents)[0]
  if (identity === undefined) throw new Error("memory identity missing")
  return {
    identity,
    repo: join(agents, identity, "repo"),
    completions: join(agents, identity, "runtime", "reflection", "completions"),
  }
}

function waitForCompletion(dir, existing) {
  mkdirSync(dir, { recursive: true })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.close()
      reject(new Error("timed out waiting for reflection completion"))
    }, 90_000)
    const subscription = watch(dir, () => {
      const file = readdirSync(dir).find((name) => name.endsWith(".json") && !existing.has(name))
      if (file === undefined) return
      clearTimeout(timer)
      subscription.close()
      resolve(JSON.parse(readFileSync(join(dir, file), "utf8")))
    })
  })
}

async function main() {
  if (senpiBin === null || !existsSync(senpiBin)) throw new Error(`senpi binary missing: ${senpiBin}`)
  seedSandbox(sandbox)
  mkdirSync(join(sandbox.agentDir, "sessions"), { recursive: true })
  writeFileSync(join(sandbox.agentDir, "auth.json"), `${JSON.stringify({
    "omo-mock": { type: "api_key", key: "mock" },
    "extension-only": { type: "api_key", key: "mock" },
  }, null, 2)}\n`)
  const parentProvider = writeParentOnlyProvider()
  const childShim = writeChildShim()

  writeConfig(0)
  writeMockScript([
    {
      type: "tool_call",
      name: "memory",
      arguments: {
        command: "create",
        file_path: "system/facts.md",
        description: "fallback QA seed",
        file_text: "seed before fallback",
        reason: "seed fallback QA memory",
      },
    },
    { type: "text", text: "seeded" },
  ])
  await runParent(parentProvider, childShim, "seed memory")

  const state = memoryRepo()
  writeFileSync(join(state.repo, "mock-script.json"), `${JSON.stringify({
    steps: [
      {
        type: "tool_call",
        name: "edit",
        arguments: {
          path: "system/facts.md",
          edits: [{ oldText: "seed before fallback", newText: "seed before fallback\nfallback reflection merged" }],
        },
      },
      {
        type: "tool_call",
        name: "bash",
        arguments: { command: "git add system/facts.md && git commit -m 'qa: fallback reflection'" },
      },
      { type: "text", text: "reflection complete" },
    ],
  }, null, 2)}\n`)
  Bun.spawnSync(["git", "add", "mock-script.json"], { cwd: state.repo })
  const commit = Bun.spawnSync(["git", "commit", "-m", "qa: reflection script"], { cwd: state.repo })
  if (commit.exitCode !== 0) throw new Error(commit.stderr.toString())

  writeConfig(1)
  writeMockScript([{ type: "text", text: "triggered" }])
  const existing = new Set(existsSync(state.completions) ? readdirSync(state.completions) : [])
  const completionPromise = waitForCompletion(state.completions, existing)
  await runParent(
    parentProvider,
    childShim,
    "trigger reflection",
    [writeCompletionHold(state.completions)],
  )
  const completion = await completionPromise
  const runDir = join(dirname(state.completions), "runs", completion.runId)
  const attempts = readFileSync(join(runDir, "attempts.log"), "utf8").trim().split("\n")
    .map((line) => line.match(/--model ([^ ]+)/)?.[1])
    .filter(Boolean)

  if (completion.outcome !== "merged") throw new Error(JSON.stringify(completion))
  if (completion.model !== "omo-mock/mock-1") throw new Error(`wrong completion model: ${completion.model}`)
  if (attempts.join(",") !== "extension-only/primary,omo-mock/mock-1") {
    throw new Error(`wrong model attempts: ${attempts.join(",")}`)
  }
  if (!readFileSync(join(state.repo, "system", "facts.md"), "utf8").includes("fallback reflection merged")) {
    throw new Error("fallback reflection did not merge")
  }
  console.log(JSON.stringify({
    result: "PASS",
    attempts,
    outcome: completion.outcome,
    model: completion.model,
    isolationRoot: sandbox.root,
  }))
}

try {
  await main()
} finally {
  if (process.env.OMO_SENPI_KEEP_QA !== "1") rmSync(sandbox.root, { recursive: true, force: true })
}
