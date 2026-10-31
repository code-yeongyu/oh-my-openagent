import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createConnection, createServer } from "node:net"
import { createInterface } from "node:readline"

import { loadJobExperimentKernel } from "./windows-job-name-native.test-support"

// An experiment, not a production liveness oracle. Exit 1 with a receipt means
// the name-survival hypothesis was falsified; an exception produces no receipt.
const [mode = "experiment", jobName, pipePath] = process.argv.slice(2)
const signal = AbortSignal.timeout(20_000)

if (mode === "descendant") {
  if (pipePath === undefined) throw new Error("missing descendant pipe")
  const socket = createConnection(pipePath)
  socket.on("connect", () => socket.write(`${process.pid}\n`))
  socket.on("data", () => socket.end())
  socket.on("close", () => process.exit(0))
} else if (mode === "creator") {
  if (jobName === undefined || pipePath === undefined) throw new Error("missing creator arguments")
  const kernel = await loadJobExperimentKernel()
  let job = kernel.createJob(jobName)
  if (kernel.api.AssignProcessToJobObject(job, kernel.api.GetCurrentProcess()) === 0) {
    throw new Error(`AssignProcessToJobObject failed: ${kernel.api.GetLastError()}`)
  }
  process.on("message", message => {
    if (message === "spawn") {
      const child = spawn(process.execPath, [import.meta.filename, "descendant", jobName, pipePath], {
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, BUN_BE_BUN: "1" },
      })
      child.on("error", error => { throw error })
      process.send?.("spawned")
    } else if (message === "close-job") {
      if (job === 0n || kernel.api.CloseHandle(job) === 0) throw new Error("CloseHandle failed")
      job = 0n
      process.send?.("closed")
    }
  })
  process.send?.("ready")
} else {
  if (process.platform !== "win32") throw new Error("this experiment requires native Windows")
  const kernel = await loadJobExperimentKernel()
  const name = `Global\\omo-memory-name-experiment-${randomUUID()}`
  const pipe = `\\\\.\\pipe\\omo-memory-name-experiment-${randomUUID()}`
  const server = createServer()
  let acceptedSocket: import("node:net").Socket | undefined
  const connected = new Promise<{ socket: import("node:net").Socket; pid: Promise<number> }>((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    signal.addEventListener("abort", aborted, { once: true })
    server.once("connection", socket => {
      acceptedSocket = socket
      signal.removeEventListener("abort", aborted)
      const lines = createInterface({ input: socket })
      const pid = once(lines, "line", { signal }).then(([line]) => {
        lines.close()
        const value = Number(line)
        if (!Number.isSafeInteger(value) || value <= 0) throw new Error("invalid descendant pid")
        return value
      })
      resolve({ socket, pid })
    })
  })
  const listening = once(server, "listening", { signal })
  server.listen(pipe)
  await listening
  const creator = spawn(process.execPath, [import.meta.filename, "creator", name, pipe], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    windowsHide: true,
    env: { ...process.env, BUN_BE_BUN: "1" },
  })
  const creatorExit = once(creator, "exit", { signal })
  let observerJob = 0n
  let descendant = 0n
  let peer: Awaited<typeof connected> | undefined
  try {
    const [ready] = await once(creator, "message", { signal })
    if (ready !== "ready") throw new Error("creator did not report readiness")
    const spawned = once(creator, "message", { signal })
    creator.send("spawn")
    await spawned
    peer = await connected
    descendant = kernel.openProcess(await peer.pid)
    observerJob = kernel.openJob(name).handle
    if (observerJob === 0n) throw new Error("job missing before handles close")
    const member = new Uint32Array(1)
    if (kernel.api.IsProcessInJob(descendant, observerJob, member) === 0 || member[0] !== 1) {
      throw new Error("descendant never joined the creator job")
    }
    if (!kernel.isAlive(descendant)) throw new Error("descendant exited before the experiment")
    if (kernel.api.CloseHandle(observerJob) === 0) throw new Error("observer CloseHandle failed")
    observerJob = 0n
    if (mode !== "crash") {
      const closed = once(creator, "message", { signal })
      creator.send("close-job")
      const [acknowledgement] = await closed
      if (acknowledgement !== "closed") throw new Error("creator did not close its job handle")
    }
    const beforeCreatorDeath = kernel.openJob(name)
    if (beforeCreatorDeath.handle !== 0n) kernel.api.CloseHandle(beforeCreatorDeath.handle)
    const descendantAliveBeforeKill = kernel.isAlive(descendant)
    creator.kill("SIGKILL")
    await creatorExit
    const descendantAliveAfterKill = kernel.isAlive(descendant)
    const afterCreatorDeath = kernel.openJob(name)
    if (afterCreatorDeath.handle !== 0n) kernel.api.CloseHandle(afterCreatorDeath.handle)
    const falsified = descendantAliveBeforeKill && descendantAliveAfterKill
      && (mode === "crash" ? beforeCreatorDeath.handle !== 0n : beforeCreatorDeath.handle === 0n && beforeCreatorDeath.error === 2)
      && afterCreatorDeath.handle === 0n && afterCreatorDeath.error === 2
    console.log(JSON.stringify({
      scenario: mode,
      hypothesis: "missing-job-name-proves-idle",
      verdict: falsified ? "FALSIFIED" : "NOT_FALSIFIED",
      descendantAliveBeforeKill,
      descendantAliveAfterKill,
      observerJobHandles: 0,
      namePresentBeforeCreatorDeath: beforeCreatorDeath.handle !== 0n,
      afterCreatorDeathError: afterCreatorDeath.error,
    }))
    process.exitCode = falsified ? 1 : 0
  } finally {
    if (observerJob !== 0n) kernel.api.CloseHandle(observerJob)
    if (creator.exitCode === null && creator.signalCode === null) {
      creator.kill("SIGKILL")
      await creatorExit
    }
    if (descendant !== 0n) {
      const socketClosed = peer === undefined || peer.socket.destroyed
        ? Promise.resolve()
        : once(peer.socket, "close", { signal })
      if (kernel.isAlive(descendant)) kernel.api.TerminateProcess(descendant, 1)
      await socketClosed
      kernel.api.CloseHandle(descendant)
    }
    acceptedSocket?.destroy()
    const serverClosed = once(server, "close", { signal })
    server.close()
    await serverClosed
  }
}
