/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { reapLspDaemons } from "./lsp-daemon-reaper"

async function writeDaemonVersion(codexHome: string, version: string, pid: string): Promise<string> {
  const dir = join(codexHome, "codex-lsp", "daemon", version)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "daemon.pid"), `${pid}\n`)
  await writeFile(join(dir, "daemon.sock"), "")
  return dir
}

describe("reapLspDaemons", () => {
  test("#given running daemon version dirs #when reaping #then kills pids and removes dirs", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "omo-reap-"))
    const dirA = await writeDaemonVersion(codexHome, "v0.1.0", "111")
    const dirB = await writeDaemonVersion(codexHome, "v0.2.0", "222")
    const killed: number[] = []

    const reaped = await reapLspDaemons(codexHome, {
      killProcess: (pid) => {
        killed.push(pid)
        return true
      },
    })

    expect(killed.sort()).toEqual([111, 222])
    expect(reaped.length).toBe(2)
    expect(existsSync(dirA)).toBe(false)
    expect(existsSync(dirB)).toBe(false)
  })

  test("#given no daemon root #when reaping #then returns empty without throwing", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "omo-reap-empty-"))
    const reaped = await reapLspDaemons(codexHome, { killProcess: () => true })
    expect(reaped).toEqual([])
  })

  test("#given a dir without a pid file #when reaping #then removes it and kills nothing", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "omo-reap-nopid-"))
    const dir = join(codexHome, "codex-lsp", "daemon", "v9.9.9")
    await mkdir(dir, { recursive: true })
    const killed: number[] = []

    const reaped = await reapLspDaemons(codexHome, {
      killProcess: (pid) => {
        killed.push(pid)
        return true
      },
    })

    expect(killed).toEqual([])
    expect(reaped).toEqual([])
    expect(existsSync(dir)).toBe(false)
  })
})
