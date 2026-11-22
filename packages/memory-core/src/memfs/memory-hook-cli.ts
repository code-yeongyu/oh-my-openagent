import { runMemoryHook } from "./memory-hook"

process.exitCode = runMemoryHook(process.argv.slice(3), process.cwd())
