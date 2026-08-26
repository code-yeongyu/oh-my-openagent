#!/usr/bin/env node
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnNode } from "./lib/child-process.js"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const cliPath = join(packageRoot, "plugin", "runtime", "agent-toolkit", "cli.js")

try {
  await spawnNode(cliPath, process.argv.slice(2))
} catch (error) {
  console.error(`omo-agent-toolkit: ${error.message}`)
  process.exitCode = 1
}
