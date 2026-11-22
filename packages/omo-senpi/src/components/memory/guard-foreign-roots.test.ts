import { describe, expect, test } from "bun:test"
import { posix, win32 } from "node:path"

import { isWithin, scanForeignRoots } from "./guard-foreign-roots"

// Platform contract (#12301): the ancestor rule must hold for every Windows path form, so these cases run the
// scan and the ancestor predicate under `path.win32` on every host. Entries come from a fake listing; the scan
// never resolves them, so the verdict is purely lexical over the own roots the guard hands it.

const MEMORY = "C:\\Users\\Bear\\.omo\\memory"
const AGENTS = `${MEMORY}\\agents`
const TRANSIENT = `${MEMORY}\\transient-runs`

// A bare name is a directory entry; `{ name, isFile: true }` is a regular file.
type FakeEntry = string | { readonly name: string; readonly isFile: boolean }

function listing(
  entries: Record<string, readonly FakeEntry[] | NodeJS.ErrnoException>,
): (dir: string) => readonly { readonly name: string; readonly isFile: boolean }[] {
  return (dir) => {
    const value = entries[dir]
    if (value === undefined) throw Object.assign(new Error(`ENOENT: ${dir}`), { code: "ENOENT" })
    if (value instanceof Error) throw value
    return value.map((entry) => (typeof entry === "string" ? { name: entry, isFile: false } : entry))
  }
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

describe("scanForeignRoots under win32 path forms (#12301)", () => {
  test.each([
    ["backslash own root", `${AGENTS}\\global`],
    ["lower-cased own root", "c:\\users\\bear\\.omo\\memory\\agents\\global"],
    ["forward-slash own root", "C:/Users/Bear/.omo/memory/agents/global"],
    ["trailing-separator own root", `${AGENTS}\\global\\`],
  ])(
    "#given a single identity and a %s #when the areas are listed #then nothing foreign is found",
    (_label, ownRoot) => {
      const scan = scanForeignRoots([AGENTS, TRANSIENT], [ownRoot], listing({ [AGENTS]: ["Global"] }), win32)

      expect(scan).toEqual({ kind: "clear" })
    },
  )

  test("#given a second identity beside the own one #when the areas are listed #then the agents area is reported without naming the identity", () => {
    const scan = scanForeignRoots(
      [AGENTS, TRANSIENT],
      [`${AGENTS}\\global`],
      listing({ [AGENTS]: ["global", "other"] }),
      win32,
    )

    expect(scan).toEqual({ kind: "foreign", area: AGENTS })
  })

  test("#given regular files beside the own identity in every area #when the areas are listed #then files are not identities", () => {
    const scan = scanForeignRoots(
      [AGENTS, TRANSIENT],
      [`${AGENTS}\\global`],
      listing({
        [AGENTS]: ["global", { name: "desktop.ini", isFile: true }],
        [TRANSIENT]: [{ name: "Thumbs.db", isFile: true }],
      }),
      win32,
    )

    expect(scan).toEqual({ kind: "clear" })
  })

  test("#given an entry that differs from the own root only by case #when compared with posix rules #then it is foreign", () => {
    const scan = scanForeignRoots(["/m/agents"], ["/m/agents/global"], listing({ "/m/agents": ["Global"] }), posix)

    expect(scan).toEqual({ kind: "foreign", area: "/m/agents" })
  })

  test("#given a transient run with a second identity under its own token #when every denied area is listed #then the token's agents area is foreign", () => {
    const tokenAgents = `${TRANSIENT}\\tok-1\\agents`
    const scan = scanForeignRoots(
      [tokenAgents, AGENTS, TRANSIENT],
      [`${tokenAgents}\\global`],
      listing({ [TRANSIENT]: ["tok-1"], [tokenAgents]: ["global", "other"] }),
      win32,
    )

    expect(scan).toEqual({ kind: "foreign", area: tokenAgents })
  })

  test("#given only the run's own token under transient-runs #when the areas are listed #then the token counts as own", () => {
    const tokenAgents = `${TRANSIENT}\\tok-1\\agents`
    const scan = scanForeignRoots(
      [tokenAgents, AGENTS, TRANSIENT],
      [`${tokenAgents}\\global`],
      listing({ [TRANSIENT]: ["tok-1"], [tokenAgents]: ["global"] }),
      win32,
    )

    expect(scan).toEqual({ kind: "clear" })
  })

  test.each(["EACCES", "EPERM", "ENOTDIR", "ELOOP"])(
    "#given listing an area fails with %s #when scanned #then the area is reported unlisted",
    (code) => {
      expect(
        scanForeignRoots(
          [AGENTS, TRANSIENT],
          [`${AGENTS}\\global`],
          listing({ [AGENTS]: ["global"], [TRANSIENT]: errno(code) }),
          win32,
        ),
      ).toEqual({ kind: "unlisted", area: TRANSIENT })
      expect(
        scanForeignRoots([AGENTS, TRANSIENT], [`${AGENTS}\\global`], listing({ [AGENTS]: errno(code) }), win32),
      ).toEqual({ kind: "unlisted", area: AGENTS })
    },
  )
})

describe("isWithin under win32 path forms (#12301)", () => {
  test.each([
    ["C:\\Users\\Bear\\.omo", true],
    ["c:\\users\\bear\\.omo", true],
    ["C:/Users/Bear/.omo/memory", true],
    ["C:\\Users\\Bear\\.omo\\memory\\", true],
    ["C:\\Users/Bear\\.omo/memory", true],
    ["C:\\Users\\Bear\\.omo\\memory\\agents2", false],
    ["C:\\Users\\Bear\\.omo\\agent", false],
    ["D:\\Users\\Bear\\.omo", false],
  ] as const)(
    "#given candidate %s #when tested as an ancestor of the agents area #then it returns %p",
    (candidate, expected) => {
      expect(isWithin(candidate, AGENTS, win32)).toBe(expected)
    },
  )
})
