#!/usr/bin/env bun
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { createSandbox, seedSandbox } from "./drive.mjs"

const sandbox = createSandbox()
const senpiBin = process.env.SENPI_BIN ?? Bun.which("senpi")
const mockProvider = join(import.meta.dir, "mock-provider", "index.ts")

async function runSenpi() {
  if (senpiBin === null) throw new Error("senpi binary unavailable")
  const child = spawn(senpiBin, [
    "-e", mockProvider,
    "-p",
    "--mode", "json",
    "--provider", "omo-mock",
    "--model", "mock-1",
    "--session-dir", join(sandbox.agentDir, "sessions"),
    "startup skill warning QA",
  ], {
    cwd: sandbox.cwd,
    env: {
      ...process.env,
      SENPI_CODING_AGENT_DIR: sandbox.agentDir,
      XDG_CONFIG_HOME: sandbox.xdgConfigHome,
      OMO_MEMORY_HOME: join(sandbox.root, "memory"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => { stdout += chunk })
  child.stderr.on("data", (chunk) => { stderr += chunk })
  const code = await new Promise((resolve) => child.once("close", resolve))
  return { code, stdout, stderr }
}

function memorySkillsPath() {
  const agentsDir = join(sandbox.root, "memory", "agents")
  const identity = readdirSync(agentsDir)[0]
  if (identity === undefined) throw new Error("memory identity missing")
  return join(agentsDir, identity, "repo", "skills")
}

async function main() {
  seedSandbox(sandbox)
  mkdirSync(join(sandbox.agentDir, "sessions"), { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(join(sandbox.agentDir, "auth.json"), `${JSON.stringify({
    "omo-mock": { type: "api_key", key: "mock" },
  }, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify({
    memory: {
      enabled: true,
      facts: { enabled: false },
      reflection: {
        trigger: { step_count: 999999, on_compaction: false },
      },
    },
  }, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({
    steps: [{ type: "text", text: "ok" }],
  }, null, 2)}\n`)

  const result = await runSenpi()
  const output = `${result.stdout}\n${result.stderr}`
  const skillsPath = memorySkillsPath()
  if (result.code !== 0) throw new Error(result.stderr.slice(-1000) || `senpi exited ${result.code}`)
  if (output.includes("skill path does not exist")) throw new Error("missing skill path warning was emitted")
  if (output.includes("\"frontend\" collision")) throw new Error("frontend collision warning was emitted")
  if (existsSync(skillsPath)) throw new Error(`QA requires an absent skills path: ${skillsPath}`)

  console.log(JSON.stringify({
    result: "PASS",
    exit: result.code,
    missingSkillPathWarning: false,
    frontendCollision: false,
    skillsPathExists: false,
    isolationRoot: sandbox.root,
  }))
}

try {
  await main()
} finally {
  if (process.env.OMO_SENPI_KEEP_QA !== "1") {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}
