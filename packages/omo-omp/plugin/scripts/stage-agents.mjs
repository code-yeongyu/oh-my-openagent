#!/usr/bin/env node
import { copyFile, mkdir, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const agentsSource = join(pluginRoot, "agents")

// Same resolution order as the extension's agent-home component: env override, then the branded
// ~/.omo sentinel, then ~/.omp/agent.
const AGENT_DIR_ENV_NAMES = ["OMP_CODING_AGENT_DIR", "OMO_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"]
const AGENT_HOME_SENTINEL = "config.yml"

function resolveAgentHome() {
  for (const name of AGENT_DIR_ENV_NAMES) {
    const configured = process.env[name]?.trim()
    if (configured) return configured
  }
  const { homedir } = process.env
  const home = homedir() ?? ""
  const brandedHome = join(home, ".omo")
  const { existsSync } = require("node:fs")
  if (existsSync(join(brandedHome, AGENT_HOME_SENTINEL))) return brandedHome
  return join(home, ".omp", "agent")
}

export async function stageAgents() {
  const agentHome = resolveAgentHome()
  const targetDir = join(agentHome, "agents")
  await mkdir(targetDir, { recursive: true })

  const entries = await readdir(agentsSource)
  let staged = 0
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue
    await copyFile(join(agentsSource, entry), join(targetDir, entry))
    staged += 1
  }

  console.log(`staged ${staged} omo-omp agents into ${targetDir}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await stageAgents()
}
