import { afterEach, describe, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MAX_RECEIPT_SCAN_BYTES, readInputReceipt } from "./input-receipt"

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function transcript(): string {
  const dir = mkdtempSync(join(tmpdir(), "input-receipt-"))
  dirs.push(dir)
  const path = join(dir, "session.jsonl")
  writeFileSync(path, `${JSON.stringify({ type: "session", id: "durable" })}\n`)
  return path
}

function admission(clientMessageId: string, state: string, outcome?: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify({ type: "custom", customType: "rpc_client_message_admission", data: { clientMessageId, state, ...(outcome === undefined ? {} : { outcome }) } })}\n`
}

function filler(bytes: number): string {
  const line = `${JSON.stringify({ type: "message", message: { role: "assistant", content: "x".repeat(1000) } })}\n`
  return line.repeat(Math.ceil(bytes / line.length))
}

describe("readInputReceipt (senpi admission receipts in the session transcript)", () => {
  test("#given an older input sealed after a newer one was queued #when the last input is looked up #then its own receipt answers", async () => {
    const path = transcript()
    appendFileSync(path, admission("t1:1:1", "running") + admission("t1:1:2", "queued") + admission("t1:1:1", "completed", { kind: "interrupted_by_reopen" }))

    expect(await readInputReceipt(path, "t1:1:2")).toEqual({ state: "accepted" })
    expect(await readInputReceipt(path, "t1:1:1")).toEqual({ state: "done", outcome: { kind: "interrupted_by_reopen" } })
  })

  test("#given a receipt line that straddles a scan chunk #when it is looked up #then the carried line still parses", async () => {
    const path = transcript()
    appendFileSync(path, admission("t1:1:1", "completed", { kind: "deadline", deadline: { kind: "max_runtime" } }) + filler(256 * 1024 - 200))

    expect(await readInputReceipt(path, "t1:1:1")).toEqual({ state: "done", outcome: { kind: "deadline", deadline: { kind: "max_runtime" } } })
  })

  test("#given Hangul in a receipt's detail #when a chunk boundary falls inside a syllable #then the text comes back intact", async () => {
    const detail = "한국어 입력이 비워졌습니다"
    const receipt = admission("t1:1:1", "completed", { kind: "error", reason: "provider_unavailable", detail, action: "다시 보내세요" })
    const header = `${JSON.stringify({ type: "session", id: "durable" })}\n`
    const detailAt = Buffer.from(receipt).indexOf(Buffer.from(detail))
    const fillerLine = (content: number) => `${JSON.stringify({ type: "message", message: { role: "user", content: "p".repeat(content) } })}\n`
    const overhead = Buffer.byteLength(fillerLine(0))
    // Each Hangul syllable is 3 bytes: offsets 1 and 2 put the 256 KiB boundary inside the first one.
    for (const inside of [1, 2]) {
      const path = transcript()
      // file = header + receipt + one filler line, sized so size - 256 KiB = header + detailAt + inside.
      const fillerBytes = 256 * 1024 + detailAt + inside - Buffer.byteLength(receipt)
      appendFileSync(path, receipt + fillerLine(fillerBytes - overhead))
      expect(statSync(path).size - 256 * 1024).toBe(Buffer.byteLength(header) + detailAt + inside)

      const read = await readInputReceipt(path, "t1:1:1")

      expect(read).toEqual({ state: "done", outcome: { kind: "error", reason: "provider_unavailable", detail, action: "다시 보내세요" } })
    }
  })

  test("#given a large transcript #when the receipt lies beyond the scan cap #then the read stops at the cap instead of loading the file", async () => {
    const path = transcript()
    appendFileSync(path, admission("t1:1:1", "queued") + filler(MAX_RECEIPT_SCAN_BYTES + 64 * 1024))
    appendFileSync(path, admission("t1:1:2", "running"))

    expect(await readInputReceipt(path, "t1:1:1")).toBeUndefined()
    expect(await readInputReceipt(path, "t1:1:2")).toEqual({ state: "applied" })
  })

  test("#given a cleared input #when it is looked up #then it reads as a failed receipt with no outcome", async () => {
    const path = transcript()
    appendFileSync(path, admission("t1:1:1", "completed", { kind: "cleared_by_abort" }))

    expect(await readInputReceipt(path, "t1:1:1")).toEqual({ state: "failed" })
  })
})
