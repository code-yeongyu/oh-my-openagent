import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { syncRpcHandlerFailure } from "./sync-rpc-contract"

const FEATURES_REPLY = { features: ["enable-method", "acknowledge", "disable"] }

// Each mode runs in its own process: the shipped sidecar's module cache is process-wide.
async function probe(mode: "first-use" | "concurrent" | "load-fails-once"): Promise<unknown> {
  const home = await mkdtemp(join(tmpdir(), "sync-rpc-lazy-"))
  try {
    const fixture = fileURLToPath(new URL("./sync-rpc-lazy.fixture.ts", import.meta.url))
    const child = Bun.spawn([Bun.which("bun") ?? process.execPath, fixture, mode], {
      cwd: home,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        HOME: home,
        USERPROFILE: home,
        TMPDIR: home,
        TEMP: home,
        TMP: home,
        CI: "1",
        OMO_MEMORY_HOME: home,
      },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    const result = stdout.split("\n").find((line) => line.startsWith("SYNC_RPC_PROBE "))
    if (exitCode !== 0 || result === undefined)
      throw new Error(`Sync RPC probe (${mode}) exited ${exitCode}\n${stdout}\n${stderr}`)
    return JSON.parse(result.slice("SYNC_RPC_PROBE ".length))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

test("#given the shipped extension #when the first sync verb is called #then eagerly discovered handlers load the RPC sidecar only on use", async () => {
  expect(await probe("first-use")).toEqual({
    registered: ["acknowledge", "approve", "devices", "disable", "enable", "features", "pending", "status"].map(
      (verb) => `omo.memory.sync.${verb}`,
    ),
    registrationLoads: 0,
    startupLoads: 0,
    firstUseLoads: 1,
    totalLoads: 1,
    reply: FEATURES_REPLY,
  })
})

test("#given the shipped extension #when two first sync calls arrive together #then they share one sidecar load and both answer", async () => {
  expect(await probe("concurrent")).toEqual({ startupLoads: 0, loads: 1, replies: [FEATURES_REPLY, FEATURES_REPLY] })
})

test("#given a sidecar load that fails once #when sync verbs are called #then the first answers handler_failed and the next loads the sidecar again and answers", async () => {
  expect(await probe("load-fails-once")).toEqual({
    failed: syncRpcHandlerFailure(),
    loadsAfterFailure: 1,
    retried: FEATURES_REPLY,
    totalLoads: 2,
  })
})
