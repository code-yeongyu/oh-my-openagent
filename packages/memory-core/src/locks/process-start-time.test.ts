import { describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"

import { getProcessStartIdentity, startIdentitiesConflict } from "./process-identity"
import { readDarwinProcessStartSeconds, readWin32ProcessCreationFiletime } from "./process-start-time"

const onDarwin = process.platform === "darwin"
const onWin32 = process.platform === "win32"
const UNREACHABLE_PID = 2_147_483_600
/** Milliseconds between the FILETIME epoch (1601-01-01) and the Unix epoch. */
const FILETIME_UNIX_EPOCH_OFFSET_MS = 11_644_473_600_000

function filetimeToEpochMs(filetime: bigint): number {
  return Number(filetime / 10_000n) - FILETIME_UNIX_EPOCH_OFFSET_MS
}

async function creationFiletimeViaPowerShell(pid: number): Promise<string | null> {
  return await new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).StartTime.ToFileTimeUtc()`],
      { encoding: "utf8", timeout: 20_000 },
      (error, stdout) => resolve(error === null ? stdout.trim() : null),
    )
  })
}

async function startSecondsViaShell(pid: number): Promise<number | null> {
  return await new Promise((resolve) => {
    const command = `date -j -f "%a %b %e %T %Y" "$(/bin/ps -o lstart= -p ${pid})" +%s`
    execFile("/bin/sh", ["-c", command], { encoding: "utf8" }, (error, stdout) => {
      if (error !== null) {
        resolve(null)
        return
      }
      const parsed = Number(stdout.trim())
      resolve(Number.isFinite(parsed) ? parsed : null)
    })
  })
}

describe("darwin process start time", () => {
  test.if(onDarwin)(
    "#given a freshly spawned child #when the probe reads its start time #then the value brackets the spawn instant",
    async () => {
      // #given
      const before = Math.floor(Date.now() / 1000) - 1
      const child = Bun.spawn(["/bin/sh", "-c", "sleep 5"], { stdout: "ignore", stderr: "ignore" })

      try {
        // #when
        const startSeconds = await readDarwinProcessStartSeconds(child.pid)

        // #then
        const after = Math.ceil(Date.now() / 1000) + 1
        expect(startSeconds).not.toBeNull()
        expect(startSeconds ?? 0).toBeGreaterThanOrEqual(before)
        expect(startSeconds ?? 0).toBeLessThanOrEqual(after)
      } finally {
        child.kill()
        await child.exited
      }
    },
  )

  test.if(onDarwin)(
    "#given the current pid #when the probe and /bin/ps are both consulted #then they report the same instant",
    async () => {
      // #given
      const viaShell = await startSecondsViaShell(process.pid)

      // #when
      const startSeconds = await readDarwinProcessStartSeconds(process.pid)

      // #then
      expect(viaShell).not.toBeNull()
      expect(startSeconds).not.toBeNull()
      expect(Math.abs((startSeconds ?? 0) - (viaShell ?? 0))).toBeLessThanOrEqual(1)
    },
  )

  test.if(onDarwin)(
    "#given pids that cannot be inspected #when the probe reads them #then it reports null instead of a guess",
    async () => {
      // #when + #then
      expect(await readDarwinProcessStartSeconds(UNREACHABLE_PID)).toBeNull()
      expect(await readDarwinProcessStartSeconds(0)).toBeNull()
      expect(await readDarwinProcessStartSeconds(-1)).toBeNull()
      expect(await readDarwinProcessStartSeconds(1.5)).toBeNull()
    },
  )

  test.if(onDarwin)(
    "#given the lock identity API #when it resolves the current pid #then it publishes the spawn-free epoch identity",
    async () => {
      // #given
      const startSeconds = await readDarwinProcessStartSeconds(process.pid)

      // #when
      const identity = await getProcessStartIdentity(process.pid)

      // #then
      expect(startSeconds).not.toBeNull()
      expect(identity).toBe(`proc-start-epoch:${startSeconds ?? 0}`)
    },
  )

  test.if(onDarwin)(
    "#given a dead pid #when the lock identity API resolves it #then it reports null so the lock counts as stale",
    async () => {
      // #when + #then
      expect(await getProcessStartIdentity(UNREACHABLE_PID)).toBeNull()
    },
  )
})

describe("win32 process creation time", () => {
  test.if(onWin32)(
    "#given a freshly spawned child #when kernel32 reads its creation time #then the value brackets the spawn instant",
    async () => {
      // #given
      const before = Date.now() - 1_000
      const child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30000)"], { stdout: "ignore", stderr: "ignore" })

      try {
        // #when
        const filetime = await readWin32ProcessCreationFiletime(child.pid)

        // #then
        const after = Date.now() + 1_000
        expect(filetime).not.toBeNull()
        expect(filetimeToEpochMs(filetime ?? 0n)).toBeGreaterThanOrEqual(before)
        expect(filetimeToEpochMs(filetime ?? 0n)).toBeLessThanOrEqual(after)
      } finally {
        child.kill()
        await child.exited
      }
    },
  )

  test.if(onWin32)(
    "#given the current pid #when kernel32 and PowerShell are both consulted #then they report the same FILETIME",
    async () => {
      // #given
      const viaPowerShell = await creationFiletimeViaPowerShell(process.pid)

      // #when
      const filetime = await readWin32ProcessCreationFiletime(process.pid)

      // #then
      expect(viaPowerShell).not.toBeNull()
      expect(filetime).not.toBeNull()
      expect(String(filetime)).toBe(viaPowerShell ?? "")
    },
    30_000,
  )

  test.if(onWin32)(
    "#given pids that cannot be inspected #when kernel32 reads them #then it reports null instead of a guess",
    async () => {
      // #when + #then
      expect(await readWin32ProcessCreationFiletime(UNREACHABLE_PID)).toBeNull()
      expect(await readWin32ProcessCreationFiletime(0)).toBeNull()
      expect(await readWin32ProcessCreationFiletime(-1)).toBeNull()
      expect(await readWin32ProcessCreationFiletime(1.5)).toBeNull()
    },
  )

  test.if(onWin32)(
    "#given the lock identity API #when it resolves the current pid and a dead pid #then it publishes the spawn-free FILETIME identity and null",
    async () => {
      // #given
      const filetime = await readWin32ProcessCreationFiletime(process.pid)

      // #when
      const identity = await getProcessStartIdentity(process.pid)

      // #then
      expect(filetime).not.toBeNull()
      expect(identity).toBe(`win32-creation-filetime:${String(filetime)}`)
      expect(await getProcessStartIdentity(UNREACHABLE_PID)).toBeNull()
    },
  )
})

describe("start identity comparison", () => {
  test("#given two identities in one scheme #when they disagree #then the conflict is reported so pid reuse is caught", () => {
    // #when + #then
    expect(startIdentitiesConflict("proc-start-epoch:1789041850", "proc-start-epoch:1789041999")).toBe(true)
    expect(startIdentitiesConflict("ps-lstart:Thu Sep 10 21:04:10 2026", "ps-lstart:Thu Sep 10 22:04:10 2026")).toBe(true)
  })

  test("#given identities in different schemes #when they are compared #then no conflict is reported so a live owner keeps its lock", () => {
    // #when + #then
    expect(startIdentitiesConflict("ps-lstart:Thu Sep 10 21:04:10 2026", "proc-start-epoch:1789041850")).toBe(false)
    expect(startIdentitiesConflict("proc-start-epoch:1789041850", "linux-proc-start-ticks:912")).toBe(false)
  })

  test("#given an identity with no scheme separator #when it is compared #then no conflict is reported", () => {
    // #when + #then
    expect(startIdentitiesConflict("unavailable", "proc-start-epoch:1789041850")).toBe(false)
    expect(startIdentitiesConflict(":1789041850", "proc-start-epoch:1789041850")).toBe(false)
  })

  test("#given identical identities #when they are compared #then no conflict is reported", () => {
    // #when + #then
    expect(startIdentitiesConflict("proc-start-epoch:1789041850", "proc-start-epoch:1789041850")).toBe(false)
  })
})
