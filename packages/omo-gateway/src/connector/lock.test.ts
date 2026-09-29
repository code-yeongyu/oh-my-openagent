import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { acquireConnectorLock, connectorLockPath, connectorName, readConnectorLock, type ConnectorLockRecord, type LockProbe } from "./lock"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function lockInput(probe?: LockProbe) {
  const root = mkdtempSync(join(tmpdir(), "omo-gateway-lock-"))
  roots.push(root)
  const path = connectorLockPath(join(root, "agent"), "slack", "T000TEST")
  return { path, platform: "slack", account_id: "T000TEST", scope: "qa", ...(probe === undefined ? {} : { probe }) }
}

function plant(path: string, record: Partial<ConnectorLockRecord> | string): void {
  mkdirSync(dirname(path), { recursive: true })
  const base = { pid: 1, pid_start: null, nonce: "planted", platform: "slack", account_id: "T000TEST", scope: "qa", started_at: "2026-01-01T00:00:00.000Z" }
  writeFileSync(path, typeof record === "string" ? record : JSON.stringify({ ...base, ...record }))
}

async function deadPid(): Promise<number> {
  const child = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" })
  await child.exited
  return child.pid
}

describe("connector lock", () => {
  test("#given no lock #when acquired #then the file is 0600 in a 0700 dir and names this process", async () => {
    // given
    const input = lockInput()

    // when
    const result = await acquireConnectorLock(input)

    // then
    expect(result.kind).toBe("acquired")
    expect(statSync(input.path).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(input.path)).mode & 0o777).toBe(0o700)
    const record: ConnectorLockRecord = JSON.parse(readFileSync(input.path, "utf8"))
    expect(record.pid).toBe(process.pid)
    expect(record.account_id).toBe("T000TEST")
  })

  test("#given a live holder #when twelve starters race #then exactly one acquires and the rest see it", async () => {
    // given
    const input = lockInput()

    // when
    const results = await Promise.all(Array.from({ length: 12 }, () => acquireConnectorLock(input)))

    // then
    const acquired = results.flatMap((result) => (result.kind === "acquired" ? [result.lock] : []))
    expect(acquired).toHaveLength(1)
    const winner = acquired[0]?.record.nonce
    for (const result of results) if (result.kind === "held") expect(result.holder.nonce).toBe(winner ?? "")
  })

  test("#given a lock whose pid is dead #when acquired #then it is taken over", async () => {
    // given
    const input = lockInput()
    const pid = await deadPid()
    plant(input.path, { pid })

    // when
    const result = await acquireConnectorLock(input)

    // then
    expect(result.kind).toBe("acquired")
    if (result.kind === "acquired") expect(result.lock.tookOver).toEqual({ pid, reason: "dead" })
  })

  test("#given a live pid whose start identity changed #when acquired #then it is taken over, and an incomparable identity is not", async () => {
    // given
    const probe: LockProbe = { liveness: () => "alive", startIdentity: async () => "scheme-a:2" }
    const mismatch = lockInput(probe)
    plant(mismatch.path, { pid: 4242, pid_start: "scheme-a:1" })
    const incomparable = lockInput(probe)
    plant(incomparable.path, { pid: 4242, pid_start: "scheme-b:1" })

    // when
    const taken = await acquireConnectorLock(mismatch)
    const kept = await acquireConnectorLock(incomparable)

    // then
    expect(taken.kind === "acquired" ? taken.lock.tookOver : null).toEqual({ pid: 4242, reason: "start_mismatch" })
    expect(kept.kind === "held" ? kept.holder.pid : null).toBe(4242)
  })

  test("#given a pid we cannot signal (another uid) #when acquired #then the lock stays held", async () => {
    // given
    const input = lockInput({ liveness: () => "unknown", startIdentity: async () => null })
    plant(input.path, { pid: 4242, pid_start: "scheme-a:1" })

    // when
    const result = await acquireConnectorLock(input)

    // then
    expect(result.kind).toBe("held")
  })

  test("#given a corrupt lock file #when acquired #then it is taken over as corrupt", async () => {
    // given
    const input = lockInput()
    plant(input.path, "{ not json")

    // when
    const result = await acquireConnectorLock(input)

    // then
    expect(result.kind === "acquired" ? result.lock.tookOver : null).toEqual({ pid: null, reason: "corrupt" })
  })

  test("#given another starter wins between our stale read and our rename #when acquired #then its lock is put back and reported", async () => {
    // given: the probe answers "dead" for the stale pid and, at that moment, a winner writes its fresh lock
    const input = lockInput()
    const winner = { pid: process.pid, nonce: "winner" }
    const probe: LockProbe = {
      liveness(pid) {
        if (pid !== 4242) return "alive"
        plant(input.path, winner)
        return "dead"
      },
      startIdentity: async () => null,
    }
    plant(input.path, { pid: 4242 })

    // when
    const result = await acquireConnectorLock({ ...input, probe })

    // then
    expect(result.kind === "held" ? result.holder.nonce : null).toBe("winner")
    const onDisk: ConnectorLockRecord = JSON.parse(readFileSync(input.path, "utf8"))
    expect(onDisk.nonce).toBe("winner")
  })

  test("#given our lock was replaced by another holder #when we release #then their file stays", async () => {
    // given
    const input = lockInput()
    const result = await acquireConnectorLock(input)
    plant(input.path, { pid: process.pid, nonce: "someone-else" })

    // when
    if (result.kind === "acquired") await result.lock.release()

    // then
    expect(existsSync(input.path)).toBe(true)
    expect((await readConnectorLock(input.path))?.record.nonce).toBe("someone-else")
  })

  test("#given our own lock #when released #then the file is gone", async () => {
    // given
    const input = lockInput()
    const result = await acquireConnectorLock(input)

    // when
    if (result.kind === "acquired") await result.lock.release()

    // then
    expect(existsSync(input.path)).toBe(false)
  })

  test("#given an account id that escapes the directory #when named #then it is refused", () => {
    expect(() => connectorName("slack", "../T000TEST")).toThrow("not a safe file name")
    expect(() => connectorName("slack", ".hidden")).toThrow("not a safe file name")
    expect(connectorName("slack", "T000TEST")).toBe("slack-T000TEST")
  })
})
