import { once } from "node:events"
import { parentPort, workerData } from "node:worker_threads"
import { z } from "zod"
import { publishLockRecord } from "./lock-publish"
import { buildLockRecord } from "./lock-record"

const lockPath = z.string().parse(workerData)
if (parentPort === null) throw new Error("worker fixture requires a parent")
const finish = once(parentPort, "message")
await publishLockRecord(lockPath, await buildLockRecord("natural-exit"))
parentPort.postMessage({ event: "ready" })
await finish
