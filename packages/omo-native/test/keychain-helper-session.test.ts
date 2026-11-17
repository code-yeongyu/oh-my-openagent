import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { ACCOUNT, createHarness, type Harness, isDarwin, readLine } from "./keychain-helper.test-support"

describe.skipIf(!isDarwin)(
  "omo-keychain helper session: EOF watcher, signals, locked keychain (#11262 design 2, 3.6)",
  () => {
    let harness: Harness

    beforeAll(async () => {
      harness = await createHarness()
    })

    afterAll(async () => {
      await harness.dispose()
    })

    const spawnHeld = async (request: object) => {
      const child = Bun.spawn([harness.helper, "--keychain", harness.keychain, "--no-ui", "--hold-before-reply"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {},
      })
      child.stdin.write(`${JSON.stringify(request)}\n`)
      child.stdin.flush()
      const held = await readLine(child.stderr)
      expect(held.line).toBe("held\n")
      return child
    }

    test("a non-mutating verb exits at once on EOF before its reply and ignores HUP/INT/TERM", async () => {
      const child = await spawnHeld({ v: 1, verb: "read", account: ACCOUNT })
      for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"] as const) child.kill(signal)
      child.stdin.end()
      const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
      expect(exitCode).toBe(4)
      expect(child.signalCode).toBeNull()
      expect(stdout).toBe("")
    })

    test("a mutating verb still lands after its client is gone", async () => {
      const child = await spawnHeld({ v: 1, verb: "write", account: ACCOUNT, value: "dummy-after-eof" })
      child.kill("SIGTERM")
      child.stdin.end()
      expect(await child.exited).toBe(0)
      expect((await harness.run({ v: 1, verb: "read", account: ACCOUNT })).reply).toMatchObject({
        owned: true,
        value: "dummy-after-eof",
      })
    })

    test("#given another process keeps the helper's stdin open #when the helper's caller exits #then the helper ends on its own (#14029)", async () => {
      // The caller shell spawns the helper behind a writer that outlives the caller and never closes the helper's stdin,
      // the way an inherited pipe end did in the field: EOF never comes, so only the caller's exit can end the helper.
      const caller = Bun.spawn(
        [
          "/bin/sh",
          "-c",
          `{ printf '%s\\n' "$2"; exec /bin/sh -c 'echo "writer $$" >&2; exec sleep 30'; } | "$0" --keychain "$1" --no-ui --hold-before-reply & wait`,
          harness.helper,
          harness.keychain,
          JSON.stringify({ v: 1, verb: "read", account: ACCOUNT }),
        ],
        { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: {} },
      )
      const reader = caller.stderr.getReader()
      const decoder = new TextDecoder()
      let stderr = ""
      while (!(stderr.includes("held\n") && /writer \d+\n/.test(stderr))) {
        const chunk = await reader.read()
        if (chunk.done) break
        stderr += decoder.decode(chunk.value, { stream: true })
      }
      const writer = Number(/writer (\d+)\n/.exec(stderr)?.[1])
      expect(stderr).toContain("held\n")
      try {
        caller.kill("SIGKILL")
        await caller.exited
        // The helper is the last holder of the caller's stdout, so end of file there is the helper's exit.
        expect(await new Response(caller.stdout).text()).toBe("")
      } finally {
        if (writer > 1) process.kill(writer, "SIGKILL")
      }
    }, 10_000)

    test("#given a mutating native call that never returns #when its client is gone past the grace #then the helper exits on the deadline", async () => {
      const account = "c".repeat(64)
      const child = Bun.spawn(
        [harness.helper, "--keychain", harness.keychain, "--no-ui", "--stall-mutation", "--grace-ms", "200"],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: {} },
      )
      child.stdin.write(`${JSON.stringify({ v: 1, verb: "write", account, value: "dummy-stalled" })}\n`)
      child.stdin.flush()
      expect((await readLine(child.stderr)).line).toBe("stalled\n")
      child.stdin.end()
      expect(await child.exited).toBe(5)
    }, 10_000)

    test("#given a client that never closes stdin #when the helper's lifetime runs out #then it exits", async () => {
      const child = Bun.spawn(
        [harness.helper, "--keychain", harness.keychain, "--no-ui", "--hold-before-reply", "--lifetime-ms", "300"],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: {} },
      )
      child.stdin.write(`${JSON.stringify({ v: 1, verb: "read", account: ACCOUNT })}\n`)
      child.stdin.flush()
      expect((await readLine(child.stderr)).line).toBe("held\n")
      expect(await child.exited).toBe(5)
      child.stdin.end()
    }, 10_000)

    test("a reply is followed by a wait for EOF, so the client decides when the helper exits", async () => {
      const child = Bun.spawn([harness.helper, "--keychain", harness.keychain, "--no-ui"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {},
      })
      child.stdin.write(`${JSON.stringify({ v: 1, verb: "read", account: ACCOUNT })}\n`)
      child.stdin.flush()
      const reply = await readLine(child.stdout)
      expect(JSON.parse(reply.line)).toMatchObject({ owned: true })
      expect(child.exitCode).toBeNull()
      child.stdin.end()
      expect(await child.exited).toBe(0)
    })

    test("approve on another identity's item with no UI answers locked, never denied (design 2 and 5, headless)", async () => {
      const foreign = "f".repeat(64)
      expect(await harness.fixture("add", foreign, "dummy-foreign")).toContain("status 0")
      const { reply } = await harness.run({ v: 1, verb: "approve", account: foreign })
      expect(reply).toMatchObject({ error: "locked" })
      expect(await harness.fixture("delete", foreign)).toContain("status 0")
    })

    test("a locked keychain answers locked with no UI for read, approve and write", async () => {
      expect((await harness.run({ v: 1, verb: "write", account: ACCOUNT, value: "dummy-locked" })).reply).toMatchObject(
        { ok: true },
      )
      expect(await harness.fixture("lock")).toContain("status 0")
      try {
        for (const request of [
          { v: 1, verb: "read", account: ACCOUNT },
          { v: 1, verb: "approve", account: ACCOUNT },
          { v: 1, verb: "write", account: `${"b".repeat(64)}`, value: "dummy" },
          { v: 1, verb: "retire", account: ACCOUNT },
          { v: 1, verb: "remove", account: ACCOUNT },
        ]) {
          const { reply } = await harness.run(request)
          expect(reply).toMatchObject({ error: "locked" })
          const lockedStatuses: unknown[] = [-25308, -25293]
          expect(lockedStatuses).toContain(reply?.status)
        }
      } finally {
        expect(await harness.fixture("unlock")).toContain("status 0")
      }
      expect((await harness.run({ v: 1, verb: "remove", account: ACCOUNT })).reply).toEqual({ ok: true })
    })
  },
)
