import { spawn } from "node:child_process"

const [supervisorPath, runDir] = process.argv.slice(2)
if (supervisorPath === undefined || runDir === undefined) throw new Error("supervisorPath and runDir are required")

const supervisor = spawn(process.execPath, [supervisorPath, runDir], {
  detached: true,
  stdio: "ignore",
})
supervisor.unref()
process.stdout.write(`${JSON.stringify({ supervisorPid: supervisor.pid })}\n`)
process.stdin.resume()
