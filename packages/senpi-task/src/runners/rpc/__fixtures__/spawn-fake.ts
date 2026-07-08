import { type ChildProcess, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const FAKE_CHILD_PATH = fileURLToPath(new URL("./fake-child.mjs", import.meta.url))

export function spawnFakeChild(env?: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [FAKE_CHILD_PATH], {
    cwd: process.cwd(),
    env: env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  })
}
