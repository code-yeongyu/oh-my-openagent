import { workerData, parentPort } from "worker_threads"
import type { MessagePort } from "worker_threads"
import { discoverSkillsInDirAsync } from "./async-loader"
import type { LoadedSkill, SkillScope } from "./types"

interface WorkerInput {
  dirs: string[]
  scopes: SkillScope[]
}

interface WorkerOutputSuccess {
  ok: true
  skills: LoadedSkill[]
}

interface WorkerOutputError {
  ok: false
  error: { message: string; stack?: string }
}

const { signalBuffer } = workerData as { signalBuffer: SharedArrayBuffer }
const signal = new Int32Array(signalBuffer)

if (!parentPort) {
  throw new Error("Worker must be run with parentPort")
}

parentPort.once("message", (data: { port: MessagePort; input: WorkerInput }) => {
  const { port, input } = data

  void (async () => {
    try {
      const results = await Promise.all(input.dirs.map((dir) => discoverSkillsInDirAsync(dir)))

      const skills = results.flat()

      const output: WorkerOutputSuccess = { ok: true, skills }

      port.postMessage(output)
      Atomics.store(signal, 0, 1)
      Atomics.notify(signal, 0)
    } catch (error: unknown) {
      const output: WorkerOutputError = {
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      }

      port.postMessage(output)
      Atomics.store(signal, 0, 1)
      Atomics.notify(signal, 0)
    }
  })()
})
