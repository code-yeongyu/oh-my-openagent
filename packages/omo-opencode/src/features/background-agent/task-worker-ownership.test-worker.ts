import { parentPort } from "node:worker_threads"
import { TaskWorkerOwnership } from "./task-worker-ownership"

const owner = new TaskWorkerOwnership(async () => "owned")
parentPort?.on("message", () => undefined)
parentPort?.postMessage(await owner.open())
