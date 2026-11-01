import { expect, spyOn, test } from "bun:test"
import * as ffi from "bun:ffi"
import * as childProcess from "node:child_process"
import * as fs from "node:fs"
import { Duplex, PassThrough } from "node:stream"
import { attachDesktopSyncChannel } from "./channel"
import { readFrames, writeFrame } from "./framing"

// #11997 rows 1-2 on win32. senpi hands the engine ONE Duplex built over two one-way pipes (read 5, write 6;
// senpi utils/inherited-duplex.ts) after clearing HANDLE_FLAG_INHERIT on both handles itself (senpi
// private-fds.ts -> utils/private-fd-inherit.ts; the spawned-child leak proof is senpi's
// host-private-fd-inherit.test.ts). The receiver must take that stream as handed: no platform refusal, no
// descriptor or handle of its own, no second flag clear, and no child process that could carry the stream.
function watchHandleAndProcessCreation() {
  const spies = [
    spyOn(fs, "open"), spyOn(fs, "openSync"),
    spyOn(childProcess, "spawn"), spyOn(childProcess, "spawnSync"), spyOn(childProcess, "fork"),
    spyOn(childProcess, "exec"), spyOn(childProcess, "execSync"), spyOn(childProcess, "execFile"), spyOn(childProcess, "execFileSync"),
    spyOn(Bun, "spawn"), spyOn(Bun, "spawnSync"),
    // Clearing an inherit flag from JavaScript means SetHandleInformation through FFI.
    spyOn(ffi, "dlopen"),
  ]
  return {
    calls: () => spies.reduce((total, spy) => total + spy.mock.calls.length, 0),
    restore: () => { for (const spy of spies) spy.mockRestore() },
  }
}

test("the receiver bootstraps over the two one-way halves senpi hands it and creates nothing itself", async () => {
  // given: the desktop->engine pipe (fd 5) and the engine->desktop pipe (fd 6), joined into one stream as senpi does
  const toEngine = new PassThrough()
  const toDesktop = new PassThrough()
  const handed = new Duplex({
    read() {},
    write(chunk, _encoding, done) { toDesktop.write(chunk, done) },
    destroy(error, done) { toEngine.destroy(); toDesktop.destroy(); done(error) },
  })
  toEngine.on("data", (chunk: Buffer) => handed.push(chunk))
  const frames: unknown[] = []
  readFrames(toDesktop, (packet) => {
    frames.push(packet)
    if (typeof packet !== "object" || packet === null || !("id" in packet) || !("op" in packet)) return
    writeFrame(toEngine, { id: packet.id, ok: true, value: packet.op === "bootstrap" ? { child: "win-child" } : { accepted: true } })
  }, () => {})
  const watch = watchHandleAndProcessCreation()
  try {
    // when: the engine attaches and issues one request
    const result = await attachDesktopSyncChannel(handed)
    if (result.kind !== "connected") throw new Error(`receiver answered ${JSON.stringify(result)}`)
    expect(await result.channel.request({ op: "descriptor" })).toEqual({ accepted: true })
    result.channel.close()
    // then: every frame went out on the engine->desktop half, and the receiver disposed the stream it owns
    expect(frames).toEqual([
      { id: 1, op: "bootstrap" },
      { id: 2, op: "request", capability: "win-child", request: { op: "descriptor" } },
    ])
    expect(handed.destroyed).toBe(true)
    expect(watch.calls()).toBe(0)
  } finally {
    watch.restore()
    handed.destroy()
  }
})

test("a declaration senpi refused (no stream) is unavailable and opens nothing in its place", async () => {
  const watch = watchHandleAndProcessCreation()
  try {
    expect(await attachDesktopSyncChannel(undefined)).toEqual({ kind: "unavailable", reason: "private_channel_unavailable" })
    expect(watch.calls()).toBe(0)
  } finally {
    watch.restore()
  }
})
