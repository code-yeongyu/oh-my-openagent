#!/usr/bin/env bun
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, watch, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, seedSandbox } from "./drive.mjs"
import { isolatedChildEnv } from "./sandbox-child-env.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const senpiBin = process.env.SENPI_BIN ?? Bun.which("senpi")
const sandbox = createSandbox()

function writeConfig(stepCount) {
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(
    join(sandbox.cwd, ".omo", "omo.json"),
    `${JSON.stringify(
      {
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
      },
      null,
      2,
    )}\n`,
  )
}

function writeParentOnlyProvider() {
  const path = join(sandbox.root, "parent-only-provider.ts")
  writeFileSync(
    path,
    `
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
`,
  )
  return path
}

function writeChildShim(parentProvider) {
  const path = join(sandbox.root, "senpi-child-shim")
  writeFileSync(
    path,
    `#!/bin/sh
# Simulate a catalog that still advertises the primary. Real reflection children
# load only the mock fallback, so the engine, not this shim, reports the primary miss.
for arg do
  if [ "$arg" = "--list-models" ]; then
    exec ${JSON.stringify(senpiBin)} -e ${JSON.stringify(parentProvider)} "$@"
  fi
done
if [ -n "$TRANSCRIPT_PATH" ]; then
  printf '%s\n' "$*" >> "$(dirname "$TRANSCRIPT_PATH")/attempts.log"
fi
exec ${JSON.stringify(senpiBin)} -e ${JSON.stringify(mockProviderEntry)} "$@"
`,
  )
  Bun.spawnSync(["chmod", "+x", path])
  return path
}

function writeCompletionHold(completions, existing) {
  const path = join(sandbox.root, "completion-hold.js")
  writeFileSync(
    path,
    `
import { readdirSync, watch } from "node:fs"

export default function holdUntilReflectionCompletes(pi) {
  pi.on("agent_settled", () => {
    const existing = new Set(${JSON.stringify([...existing])})
    function inspect() {
      const completed = readdirSync(${JSON.stringify(completions)})
        .some((name) => name.endsWith(".json") && !existing.has(name))
      if (!completed) return
      clearTimeout(timer)
      subscription.close()
    }
    const subscription = watch(${JSON.stringify(completions)}, inspect)
    const timer = setTimeout(() => subscription.close(), 90000)
    inspect()
  })
}
`,
  )
  return path
}

function writeMockScript(steps) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({ steps }, null, 2)}\n`)
}

async function runParent(parentProvider, childShim, prompt, extraExtensions = []) {
  const child = spawn(
    senpiBin,
    [
      "-e",
      parentProvider,
      ...extraExtensions.flatMap((extension) => ["-e", extension]),
      "-p",
      "--mode",
      "json",
      "--provider",
      "omo-mock",
      "--model",
      "mock-1",
      "--session-dir",
      join(sandbox.agentDir, "sessions"),
      prompt,
    ],
    {
      cwd: sandbox.cwd,
      env: {
        ...isolatedChildEnv(process.env, sandbox.agentDir),
        SENPI_BIN: childShim,
        HOME: sandbox.homeDir,
        USERPROFILE: sandbox.homeDir,
        XDG_CONFIG_HOME: sandbox.xdgConfigHome,
        XDG_DATA_HOME: sandbox.xdgDataHome,
        XDG_CACHE_HOME: sandbox.xdgCacheHome,
        XDG_STATE_HOME: join(sandbox.root, "xdg-state"),
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  )
  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  const code = await new Promise((resolve, reject) => {
    child.once("close", resolve)
    child.once("error", reject)
  })
  if (code !== 0) throw new Error(stderr.slice(-1000) || `parent exited ${code}`)
}

function stageSeedRepo() {
  const memoryHome = join(sandbox.root, "memory")
  const transient = join(memoryHome, "transient-runs")
  const roots = [memoryHome]
  if (existsSync(transient)) {
    for (const token of readdirSync(transient)) roots.push(join(transient, token))
  }
  const repos = roots.flatMap((root) => {
    const agents = join(root, "agents")
    if (!existsSync(agents)) return []
    return readdirSync(agents)
      .map((identity) => join(agents, identity, "repo"))
      .filter((repo) => existsSync(join(repo, ".git")))
  })
  if (repos.length !== 1) throw new Error(`expected one seed repo under ${memoryHome}, found ${repos.length}`)
  const [seedRepo] = repos
  const identity = basename(dirname(seedRepo))
  const repo = join(memoryHome, "agents", identity, "repo")
  // This second run tests model fallback for existing memory, not visibility between fresh
  // one-shots. Keep the first write under its real project identity without waiting for a sweep.
  if (seedRepo !== repo) {
    mkdirSync(dirname(repo), { recursive: true })
    renameSync(seedRepo, repo)
  }
  return { identity, repo, completions: join(dirname(repo), "runtime", "reflection", "completions") }
}

function waitForCompletion(dir, existing) {
  return new Promise((resolve, reject) => {
    function finish() {
      clearTimeout(timer)
      subscription.close()
    }
    function inspect() {
      try {
        const file = readdirSync(dir).find((name) => name.endsWith(".json") && !existing.has(name))
        if (file === undefined) return
        const completion = JSON.parse(readFileSync(join(dir, file), "utf8"))
        finish()
        resolve(completion)
      } catch (error) {
        finish()
        reject(error)
      }
    }
    const subscription = watch(dir, inspect)
    subscription.on("error", (error) => {
      finish()
      reject(error)
    })
    const timer = setTimeout(() => {
      finish()
      reject(new Error(`timed out waiting for reflection completion in ${dir}`))
    }, 90_000)
    inspect()
  })
}

async function main() {
  if (senpiBin === null || !existsSync(senpiBin)) throw new Error(`senpi binary missing: ${senpiBin}`)
  seedSandbox(sandbox)
  mkdirSync(join(sandbox.agentDir, "sessions"), { recursive: true })
  writeFileSync(
    join(sandbox.agentDir, "auth.json"),
    `${JSON.stringify(
      {
        "omo-mock": { type: "api_key", key: "mock" },
        "extension-only": { type: "api_key", key: "mock" },
      },
      null,
      2,
    )}\n`,
  )
  const parentProvider = writeParentOnlyProvider()
  const childShim = writeChildShim(parentProvider)

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

  const state = stageSeedRepo()
  writeFileSync(
    join(state.repo, "mock-script.json"),
    `${JSON.stringify(
      {
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
      },
      null,
      2,
    )}\n`,
  )
  Bun.spawnSync(["git", "add", "mock-script.json"], { cwd: state.repo })
  const commit = Bun.spawnSync(["git", "commit", "-m", "qa: reflection script"], { cwd: state.repo })
  if (commit.exitCode !== 0) throw new Error(commit.stderr.toString())

  writeConfig(1)
  writeMockScript([{ type: "text", text: "triggered" }])
  mkdirSync(state.completions, { recursive: true })
  const existing = new Set(readdirSync(state.completions))
  await runParent(parentProvider, childShim, "trigger reflection", [writeCompletionHold(state.completions, existing)])
  const completion = await waitForCompletion(state.completions, existing)
  if (completion.identity !== state.identity || completion.outcome !== "merged") {
    throw new Error(JSON.stringify(completion))
  }
  const runDir = join(dirname(state.completions), "runs", completion.runId)
  const attempts = readFileSync(join(runDir, "attempts.log"), "utf8")
    .trim()
    .split("\n")
    .map((line) => line.match(/--model ([^ ]+)/)?.[1])
    .filter(Boolean)

  if (completion.model !== "omo-mock/mock-1") throw new Error(`wrong completion model: ${completion.model}`)
  if (attempts.join(",") !== "extension-only/primary,omo-mock/mock-1") {
    throw new Error(`wrong model attempts: ${attempts.join(",")}`)
  }
  if (!readFileSync(join(state.repo, "system", "facts.md"), "utf8").includes("fallback reflection merged")) {
    throw new Error("fallback reflection did not merge")
  }
  const defaultHomeUnused =
    !existsSync(join(sandbox.homeDir, ".senpi", "agent")) && !existsSync(join(sandbox.homeDir, ".omo", "memory"))
  if (!defaultHomeUnused) throw new Error(`driver wrote a default state path under ${sandbox.homeDir}`)
  console.log(
    JSON.stringify({
      result: "PASS",
      attempts,
      outcome: completion.outcome,
      model: completion.model,
      isolationRoot: sandbox.root,
      isolatedAgentDir: sandbox.agentDir,
      defaultHomeUnused,
    }),
  )
}

try {
  await main()
} finally {
  if (process.env.OMO_SENPI_KEEP_QA !== "1") rmSync(sandbox.root, { recursive: true, force: true })
}
