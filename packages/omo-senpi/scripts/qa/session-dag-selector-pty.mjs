// Real PTY /session and /resume-cancel companion to session-dag-resume-qa.mjs.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { EventEmitter, once } from "node:events"
import { readFileSync, writeFileSync, watch } from "node:fs"
import { join } from "node:path"
import pty from "node-pty"

export async function runSelectorPty({ sandbox, env, senpiCli, extension, out, bus, requestCounts }) {
  const receiptPath = join(sandbox.root, "pty-receipts.jsonl")
  writeFileSync(receiptPath, "")
  const signals = new EventEmitter()
  let output = ""
  let terminal
  let exitResult
  const receipts = () => readFileSync(receiptPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
  const watcher = watch(receiptPath, () => signals.emit("change"))
  function waitFor(predicate, label) {
    if (predicate()) return Promise.resolve()
    return new Promise((resolveWait, reject) => {
      const timer = setTimeout(() => { signals.off("change", check); reject(new Error(`PTY timeout: ${label}`)) }, 30_000)
      function check() {
        if (!predicate()) return
        clearTimeout(timer)
        signals.off("change", check)
        resolveWait()
      }
      signals.on("change", check)
    })
  }
  const checkReceipt = (label) => waitFor(() => receipts().some((row) => row.type === "qa.check" && row.label === label), label)
  async function snapshot(label) {
    const ready = checkReceipt(label)
    terminal.write(`/qa-check ${label}\r`)
    await ready
    return receipts().find((row) => row.type === "qa.check" && row.label === label).result.details.snapshot
  }
  const plain = () => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
  try {
    const bun = process.env.BUN_BIN ?? execFileSync("which", ["bun"], { encoding: "utf8" }).trim()
    terminal = pty.spawn(bun, [senpiCli, "--no-extensions", "-e", extension, "--provider", "omo-mock", "--model", "mock-1"], { cwd: sandbox.cwd, env: { ...env, TERM: "xterm-256color", QA_RECEIPT_PATH: receiptPath }, cols: 120, rows: 36 })
    terminal.onData((text) => { output += text; signals.emit("change") })
    terminal.onExit((result) => { exitResult = result; signals.emit("exit", result) })
    await waitFor(() => receipts().some((row) => row.type === "qa.session") && plain().includes("mock-1"), "interactive ready")
    const held = once(bus, "held", { signal: AbortSignal.timeout(30_000) })
    terminal.write("/qa-start\r")
    await held
    await waitFor(() => receipts().some((row) => row.type === "qa.started"), "DAG started")
    // The provider gate is the witness: work stays in-flight throughout both commands.
    const before = await snapshot("before")
    const session = receipts().find((row) => row.type === "qa.session")
    const infoShown = waitFor(() => plain().includes("Session Info"), "session info rendered")
    terminal.write("/session\r")
    await infoShown
    const afterInfo = await snapshot("after-info")
    assert.equal(afterInfo.status, "running")
    assert.equal(afterInfo.runId, before.runId)
    const selectorShown = waitFor(() => plain().includes("Resume Session"), "resume selector rendered")
    terminal.write("/resume\r")
    await selectorShown
    writeFileSync(join(out, "pty-selector-ansi.txt"), output)
    const cancelMark = output.length
    const editorRestored = waitFor(() => output.slice(cancelMark).includes("mock-1"), "editor restored after selector cancel")
    terminal.write("\x1b")
    await editorRestored
    const afterCancel = await snapshot("after-cancel")
    assert.deepEqual(afterCancel, afterInfo)
    assert.equal(receipts().filter((row) => row.type === "qa.before-switch" || row.type === "qa.shutdown").length, 0)
    assert.equal(receipts().filter((row) => row.type === "qa.session").length, 1)
    assert.equal(requestCounts.next, 0)
    assert.equal(requestCounts.live, 2)
    return { session, runId: before.runId, sessionInfoRendered: true, resumeSelectorRendered: true, selectorCancelPreservesRun: true, noLifecycleTeardown: true }
  } finally {
    if (terminal && !exitResult) {
      const exited = once(signals, "exit", { signal: AbortSignal.timeout(15_000) })
      terminal.write("/quit\r")
      try { await exited } catch (error) {
        const killed = once(signals, "exit", { signal: AbortSignal.timeout(5000) })
        terminal.kill("SIGKILL")
        await killed
        throw new Error(`PTY graceful cleanup failed: ${error}`)
      }
    }
    watcher.close()
    writeFileSync(join(out, "pty-transcript-ansi.txt"), output)
    writeFileSync(join(out, "pty-transcript.txt"), plain())
    writeFileSync(join(out, "pty-receipts.jsonl"), readFileSync(receiptPath))
    writeFileSync(join(out, "pty-exit.json"), JSON.stringify(exitResult ?? null))
  }
}
