// The per-leg assertions of the packaged eval smoke: each of the nine eval results the scripted provider drives,
// the host-hook read receipts, and the spilled 4 MiB item. Each check throws with the receipt it did not find.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { processIsolation } from "./omo-native-eval-smoke-sandbox.mjs"
import { largeCellSpill, readEvalResults, textOf } from "./omo-native-eval-smoke-run.mjs"

const LARGE_ITEM = "x".repeat(4194304)

/** Checks every leg of one finished run; returns the PASS lines to print once shutdown is also proven clean. */
export function assertEvalLegs(sandbox, result) {
  const results = readEvalResults(sandbox.sessionDir)
  const failure = results.find((message) => message.isError)
  if (failure) throw new Error(`packaged eval failed: ${textOf(failure)}\n${result.stderr.slice(-4000)}`)
  if (/Cannot find|ENOENT|missing.*asset|Failed to load extension/i.test(result.stderr)) {
    throw new Error(`missing packaged asset: ${result.stderr.slice(-4000)}`)
  }
  if (results.length !== 9) {
    throw new Error(`expected js, py, list, sandbox probe, sandbox store, large cell, peek, release, after; got ${results.length}`)
  }
  const [js, py, list, isolated, stored, large, peek, release, after] = results
  if (!textOf(js).includes("JS_OK 42") || !textOf(js).includes(sandbox.marker)) {
    throw new Error(`JavaScript/read receipt missing: ${textOf(js)}`)
  }
  if (!textOf(py).includes("PY_OK 42")) throw new Error(`Python receipt missing: ${textOf(py)}`)
  const pythonPid = Number(textOf(py).match(/PY_PID (\d+)/)?.[1])
  if (!Number.isSafeInteger(pythonPid) || pythonPid <= 0) throw new Error("Python PID receipt missing")
  try {
    process.kill(pythonPid, 0)
    throw new Error(`Python interpreter survived shutdown: ${pythonPid}`)
  } catch (error) {
    if (!(error instanceof Error) || error.code !== "ESRCH") throw error
  }
  if (list.details?.action !== "list" || !["js", "py"].every((language) =>
    list.details.cells.some((cell) => cell.language === language && cell.state === "completed"))) {
    throw new Error(`cell list receipt missing: ${textOf(list)}`)
  }
  if (processIsolation && js.details?.runtime?.isolation !== "process") {
    throw new Error(`process-isolated kernel not used: ${JSON.stringify(js.details?.runtime)}`)
  }
  // A positive read alone is no sandbox proof: the persistent kernel has process and fetch, the QuickJS VM has neither.
  if (!textOf(isolated).includes(JSON.stringify(["undefined", "undefined", sandbox.marker]))) {
    throw new Error(`sandbox probe: expected no ambient process/fetch and the marker, got ${textOf(isolated)}`)
  }
  // The sandbox cell reports its own runtime, not the persistent kernel's (senpi #2811).
  const sandboxRuntime = isolated.details?.runtime
  if (sandboxRuntime?.name !== "quickjs" || sandboxRuntime?.isolation !== "sandbox" || typeof sandboxRuntime?.version !== "string") {
    throw new Error(`sandbox cell runtime: expected quickjs/sandbox, got ${JSON.stringify(sandboxRuntime)}`)
  }
  // An isolated cell's own error is a settled cell result (status "error"), not a failed tool call.
  if (stored.details?.cells?.[0]?.status !== "error" || !textOf(stored).includes("eval_isolate_no_state")) {
    throw new Error(`sandbox store() was not refused with eval_isolate_no_state: ${textOf(stored)}`)
  }
  if (large.isError || peek.isError) throw new Error(`large sandbox cell: ${textOf(large)} / ${textOf(peek)}`)
  if (!textOf(release).includes("RELEASED") || !textOf(after).includes("AFTER_LARGE")) {
    throw new Error(`release/after cells: ${textOf(release)} / ${textOf(after)}`)
  }
  if (!textOf(peek).includes("x".repeat(256)) || textOf(peek).includes("BIG_DONE")) {
    throw new Error(`peek did not show the streamed 4 MiB item before the cell settled: ${textOf(peek).slice(0, 400)}`)
  }
  const spill = largeCellSpill(sandbox.sessionDir)
  const expected = createHash("sha256").update(LARGE_ITEM).digest("hex")
  const actual = createHash("sha256").update(spill.match(/x{1024,}/u)?.[0] ?? "").digest("hex")
  if (actual !== expected) throw new Error(`large item spill sha256 ${actual} != source ${expected}`)
  const receipts = readFileSync(sandbox.receiptPath, "utf8").trim().split("\n").map((line) => JSON.parse(line))
  const reads = receipts.length / 2
  if (receipts.length !== 4 || [0, 2].some((index) =>
      receipts[index].kind !== "tool_call" || receipts[index + 1].kind !== "tool_result" ||
      receipts[index].id !== receipts[index + 1].id || receipts[index + 1].isError ||
      !JSON.stringify(receipts[index + 1].content).includes(sandbox.marker))) {
    throw new Error(`expected two real host reads (kernel cell, sandbox cell) through before/after hooks, got ${reads}`)
  }
  return [
    `PASS JS_OK 42 marker=${sandbox.marker} through one permission/hook read`,
    "PASS PY_OK 42",
    "PASS eval list contains JavaScript and Python cells",
    `PASS sandbox cell (quickjs ${isolated.details.runtime.version}): no process, no fetch, marker read through the host hook${processIsolation ? "; kernel cells ran process-isolated" : ""}`,
    "PASS sandbox store() refused with eval_isolate_no_state",
    `PASS 4 MiB sandbox item visible through peek before settling; spill sha256=${expected}`,
  ]
}
