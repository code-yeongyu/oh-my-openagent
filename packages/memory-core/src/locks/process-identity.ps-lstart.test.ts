import { afterEach, describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { readPsLstartIdentity, startIdentitiesConflict } from "./process-identity"

// #12108: on darwin/freebsd without bun:ffi the start identity falls back to `ps -o lstart=`, which prints local
// time in the reader's TZ and locale. A live owner probed by a reader in another TZ must still read as the same
// process, or `startIdentitiesConflict` proves it dead and its lock is reclaimed. The real `/bin/ps` is used where it
// exists (Linux and macOS): it renders the same live pid under two TZ values.
const hasPs = process.platform !== "win32"
const realTz = process.env.TZ
const realLcAll = process.env.LC_ALL

afterEach(() => {
  if (realTz === undefined) delete process.env.TZ
  else process.env.TZ = realTz
  if (realLcAll === undefined) delete process.env.LC_ALL
  else process.env.LC_ALL = realLcAll
})

describe("ps-lstart start identity", () => {
  test.skipIf(!hasPs)(
    "#given a live pid #when readers in two timezones probe it #then both read the same identity and no conflict",
    async () => {
      // given
      const pid = process.pid

      // when
      process.env.TZ = "America/New_York"
      const newYork = await readPsLstartIdentity(pid)
      process.env.TZ = "Pacific/Kiritimati"
      const kiritimati = await readPsLstartIdentity(pid)

      // then
      expect(newYork).not.toBeNull()
      expect(kiritimati).toBe(newYork)
      expect(startIdentitiesConflict(newYork ?? "", kiritimati ?? "")).toBe(false)
    },
  )

  test.skipIf(!hasPs)(
    "#given a lock recorded by an older reader in local time #when a reader in another timezone probes the live owner #then it is no conflict",
    async () => {
      // given: the identity an older reader wrote while running under New York time
      process.env.TZ = "America/New_York"
      const legacyLocal = await new Promise<string>((resolve, reject) =>
        execFile("/bin/ps", ["-o", "lstart=", "-p", String(process.pid)], (error, stdout) =>
          error === null ? resolve(stdout.trim()) : reject(error),
        ),
      )
      const recorded = `ps-lstart:${legacyLocal.replace(/\s+/g, " ")}`

      // when
      process.env.TZ = "Pacific/Kiritimati"
      const actual = await readPsLstartIdentity(process.pid)

      // then: the live owner keeps its lock
      expect(actual).not.toBeNull()
      expect(startIdentitiesConflict(recorded, actual ?? "")).toBe(false)
    },
  )

  test("#given a reader under a non-C locale #when it probes a pid #then ps is asked for the C rendering", async () => {
    // given: a ps stand-in that renders as the real one does, from the environment it is given
    process.env.LC_ALL = "ko_KR.UTF-8"
    const rendered: string[] = []
    const exec = (command: string, args: string[], env?: NodeJS.ProcessEnv) => {
      const locale = (env ?? process.env).LC_ALL
      const text = locale === "C" ? "Mon Nov  2 10:00:00 2026" : "2026년 11월  2일 월요일 10시 00분 00초"
      rendered.push(`${command} ${args.join(" ")}`)
      return Promise.resolve(text)
    }

    // when
    const identity = await readPsLstartIdentity(4242, exec)

    // then
    expect(rendered).toEqual(["/bin/ps -o lstart= -p 4242"])
    expect(identity?.endsWith("Mon Nov 2 10:00:00 2026")).toBe(true)
  })
})
