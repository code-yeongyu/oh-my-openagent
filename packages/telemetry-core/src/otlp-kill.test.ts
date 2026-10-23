import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { readSpoolRequest } from "./otlp-spool-file"
import { attributeMap, createSpoolRoot, decodeLogs, logRecordsOf, makeTransport, recordingFetch, spoolNames } from "./otlp-test-support"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

async function readLine(stream: ReadableStream<Uint8Array>, timeoutMs: number): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ""
  const deadline = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`child did not report EMITTED within ${timeoutMs} ms`)), timeoutMs).unref?.()
  })
  while (!text.includes("\n")) {
    const chunk = await Promise.race([reader.read(), deadline])
    if (chunk.done) throw new Error(`child exited before EMITTED: ${text}`)
    text += decoder.decode(chunk.value)
  }
  reader.releaseLock()
  return text.trim()
}

describe("crash before the first flush", () => {
  test("#given a process killed with SIGKILL after 7 emits #when a new process starts #then the 7 records are on disk under a valid header and replayed exactly once", async () => {
    // given
    const created = createSpoolRoot("telemetry-core-kill-")
    roots.push(created.cleanup)
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "otlp-kill-child.ts"), created.dir], {
      stdout: "pipe",
      stderr: "inherit",
    })
    const line = await readLine(child.stdout, 15_000)
    child.kill("SIGKILL")
    await child.exited

    // when
    const [active] = spoolNames(created.dir)
    const onDisk = readSpoolRequest(join(created.dir, active ?? ""))
    const { calls, fetch } = recordingFetch()
    const restarted = makeTransport(created.dir, { fetch, autoStart: true, nowMs: () => Date.now() + 301_000 })
    await restarted.ready
    await restarted.shutdown()

    // then
    expect(line).toBe(`EMITTED ${child.pid}`)
    expect(child.signalCode).toBe("SIGKILL")
    expect(active).toMatch(new RegExp(`^active-logs-${child.pid}-[0-9a-f]{32}\\.otlp$`))
    expect(onDisk.kind).toBe("ok")
    expect(onDisk.records).toBe(7)
    expect(calls.length).toBe(1)
    const uids = logRecordsOf(decodeLogs(calls[0]?.body ?? new Uint8Array())).map((r) => attributeMap(r.attributes)["log.record.uid"])
    expect(new Set(uids).size).toBe(7)
    expect(spoolNames(created.dir)).toEqual([])
  }, 60_000)
})
