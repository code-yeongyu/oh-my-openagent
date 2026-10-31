const { mkdirSync } = require("node:fs")
const childProcess = require("node:child_process")
const { syncBuiltinESMExports } = require("node:module")

const originalSpawnSync = childProcess.spawnSync

childProcess.spawnSync = function spawnSyncWithPosixMkdir(command, args, options) {
  if (command === "mkdir" && Array.isArray(args) && args[0] === "-p") {
    for (const target of args.slice(1)) mkdirSync(target, { recursive: true })
    return {
      pid: 0,
      output: [null, Buffer.alloc(0), Buffer.alloc(0)],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: 0,
      signal: null,
      error: undefined,
    }
  }
  return originalSpawnSync.call(childProcess, command, args, options)
}

syncBuiltinESMExports()
