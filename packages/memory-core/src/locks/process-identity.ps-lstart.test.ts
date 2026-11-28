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

  test("#given a reader under a non-C locale and a non-UTC zone #when it probes a pid #then ps is asked for the C rendering in UTC", async () => {
    // given: a ps stand-in that renders as the real one does, from the environment it is given: the reader's locale
    // changes the words, the reader's zone shifts the wall time (Seoul is UTC+9)
    process.env.LC_ALL = "ko_KR.UTF-8"
    process.env.TZ = "Asia/Seoul"
    const rendered: string[] = []
    const exec = (command: string, args: string[], env?: NodeJS.ProcessEnv) => {
      const { LC_ALL: locale, TZ: zone } = env ?? process.env
      const hour = zone === "UTC" ? "10" : "19"
      const text = locale === "C" ? `Mon Nov  2 ${hour}:00:00 2026` : `2026년 11월  2일 월요일 ${hour}시 00분 00초`
      rendered.push(`${command} ${args.join(" ")}`)
      return Promise.resolve(text)
    }

    // when
    const identity = await readPsLstartIdentity(4242, exec)

    // then
    expect(rendered).toEqual(["/bin/ps -o lstart= -p 4242"])
    expect(identity).toBe("ps-lstart-utc:Mon Nov 2 10:00:00 2026")
  })
})

// The upgrade window (#15260 review L2): a lock an older reader recorded in its local time (`ps-lstart:`) is compared
// with the live pid's UTC rendering (`ps-lstart-utc:`). The recorder's zone is unknown, but every zone offset lies in
// [-12h, +14h] and is a whole number of 15 minutes, so a recorded wall time no such offset maps onto the live start
// proves the pid was reused.
describe("legacy ps-lstart record against a UTC reading", () => {
  const live = "ps-lstart-utc:Mon Nov 2 10:00:00 2026"

  test.each([
    ["New York (UTC-5)", "ps-lstart:Mon Nov 2 05:00:00 2026"],
    ["Kiritimati (UTC+14), the next day", "ps-lstart:Tue Nov 3 00:00:00 2026"],
    ["Baker Island (UTC-12), the day before", "ps-lstart:Sun Nov 1 22:00:00 2026"],
    ["Kathmandu (UTC+5:45)", "ps-lstart:Mon Nov 2 15:45:00 2026"],
    ["UTC itself", "ps-lstart:Mon Nov 2 10:00:00 2026"],
  ])("#given a record a %s reader wrote for the live start #when compared #then no conflict", (_zone, recorded) => {
    expect(startIdentitiesConflict(recorded, live)).toBe(false)
  })

  test.each([
    ["a start three days earlier", "ps-lstart:Fri Oct 30 10:00:00 2026"],
    ["a start 15 hours after the live one in any zone", "ps-lstart:Tue Nov 3 01:00:00 2026"],
    ["a start 13 hours before it in any zone", "ps-lstart:Sun Nov 1 21:00:00 2026"],
    ["the same minute with other seconds", "ps-lstart:Mon Nov 2 05:00:07 2026"],
    ["an offset that is no whole number of 15 minutes", "ps-lstart:Mon Nov 2 05:10:00 2026"],
  ])("#given a record of %s #when compared #then the pid was reused: conflict", (_case, recorded) => {
    expect(startIdentitiesConflict(recorded, live)).toBe(true)
  })

  test("#given a legacy record in a non-C locale #when compared #then it cannot be read: no conflict", () => {
    expect(startIdentitiesConflict("ps-lstart:2026년 11월 2일 월요일 05시 00분 00초", live)).toBe(false)
  })

  test("#given an unreadable UTC reading #when compared with a legacy record #then no conflict", () => {
    expect(startIdentitiesConflict("ps-lstart:Mon Nov 2 05:00:00 2026", "ps-lstart-utc:garbled")).toBe(false)
  })
})
