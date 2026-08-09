#!/usr/bin/env node
import { runLauncher } from "./lib/launcher.js"
import { runSetup } from "./lib/setup-import.js"

try {
  if (process.argv[2] === "setup") await runSetup(process.argv.slice(3))
  else await runLauncher()
} catch (error) {
  console.error(`omo: ${error.message}`)
  process.exitCode = 1
}
