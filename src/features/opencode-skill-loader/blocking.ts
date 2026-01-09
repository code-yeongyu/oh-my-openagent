import { Worker, MessageChannel, receiveMessageOnPort } from "worker_threads"
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

type WorkerOutput = WorkerOutputSuccess | WorkerOutputError

const TIMEOUT_MS = 30000

export function discoverAllSkillsBlocking(dirs: string[], scopes: SkillScope[]): LoadedSkill[] {
  const signal = new Int32Array(new SharedArrayBuffer(4))
  const { port1, port2 } = new MessageChannel()
  
  const worker = new Worker(new URL("./discover-worker.ts", import.meta.url), {
    workerData: { signal }
  })

  worker.postMessage({ port: port2 }, [port2])
  
  const input: WorkerInput = { dirs, scopes }
  port1.postMessage(input)

  const waitResult = Atomics.wait(signal, 0, 0, TIMEOUT_MS)

  if (waitResult === "timed-out") {
    worker.terminate()
    port1.close()
    throw new Error(`Worker timeout after ${TIMEOUT_MS}ms`)
  }

  const message = receiveMessageOnPort(port1)
  
  worker.terminate()
  port1.close()

  if (!message) {
    throw new Error("Worker did not return result")
  }

  const output = message.message as WorkerOutput

  if (output.ok === false) {
    const error = new Error(output.error.message)
    error.stack = output.error.stack
    throw error
  }

  return output.skills
}
