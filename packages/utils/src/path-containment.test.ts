import { afterEach, describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, win32 } from "node:path"
import { isPathInside } from "./path-containment"

const shortHome = String.raw`C:\Users\RUNNER~1`
const longHome = String.raw`C:\Users\runneradmin`
const temp = String.raw`AppData\Local\Temp`

function realpath(path: string): string {
  if (win32.basename(path) === "missing.md") throw Object.assign(new Error("missing"), { code: "ENOENT" })
  return win32.normalize(path).replace(/\\RUNNER~1(?=\\|$)/i, "\\runneradmin")
}

describe("Windows path containment", () => {
  for (const [child, parent, expected] of [
    [win32.join(shortHome, temp, "note.md"), win32.join(longHome, temp), true],
    [win32.join(longHome, temp, "note.md"), win32.join(shortHome, temp), true],
    ["c:/USERS/RUNNER~1/AppData/Local/Temp\\note.md", win32.join(longHome, temp), true],
    [win32.join(shortHome, temp), win32.join(longHome, temp), true],
    [win32.join(shortHome, `${temp}-other`, "note.md"), win32.join(longHome, temp), false],
    [win32.join(shortHome, temp, "..", "private", "note.md"), win32.join(longHome, temp), false],
    [String.raw`D:\Users\runneradmin\AppData\Local\Temp\note.md`, win32.join(longHome, temp), false],
  ] as const) {
    test(`#given Windows paths #when comparing ${child} to ${parent} #then containment is ${expected}`, () => {
      const result = isPathInside(child, parent, { platform: "win32", realpath })

      expect(result, `canonical child=${win32.join(realpath(win32.dirname(child)), win32.basename(child))}; parent=${realpath(parent)}`).toBe(expected)
    })
  }
})

test("#given POSIX paths #when case differs #then they remain distinct", () => {
  const result = isPathInside("/memory/PROJECT/notes.md", "/memory/project", { platform: "linux", realpath: (path) => path })

  expect(result).toBe(false)
})

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// Windows creates directory junctions without privileges; a junction target must be absolute,
// and Windows applies `..` textually, so each case asserts the verdict the OS's own open agrees with.
function linkDir(target: string, path: string): void {
  if (process.platform === "win32") fs.symlinkSync(win32.resolve(win32.dirname(path), target), path, "junction")
  else fs.symlinkSync(target, path, "dir")
}

function symlinkFixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), "path-containment-")))
  roots.push(root)
  const inside = join(root, "inside")
  const outside = join(root, "outside")
  fs.mkdirSync(join(inside, "workspace"), { recursive: true })
  fs.mkdirSync(join(outside, "subdir"), { recursive: true })
  fs.mkdirSync(join(outside, "workspace"), { recursive: true })
  fs.writeFileSync(join(inside, "workspace", "note.md"), "inside")
  fs.writeFileSync(join(outside, "workspace", "note.md"), "outside")
  linkDir(join(outside, "subdir"), join(inside, "jump"))
  linkDir("jump/..", join(inside, "entry"))
  return { inside, child: join(inside, "entry", "workspace") }
}

const opensInside = (path: string) => fs.readFileSync(join(path, "note.md"), "utf8") === "inside"

test("#given a link whose target contains dot-dot #when native containment runs #then the verdict matches the directory the OS opens", () => {
  const { inside, child } = symlinkFixture()

  const result = isPathInside(child, inside)

  expect(result).toBe(opensInside(child))
  if (process.platform !== "win32") expect(result).toBe(false)
})

test("#given a Node-style lexical realpath fake #when default containment runs #then it still uses the native lookup", () => {
  const { inside, child } = symlinkFixture()
  const native = fs.realpathSync.native
  const legacy = spyOn(fs, "realpathSync").mockImplementation((input) => input === child ? join(inside, "workspace") : native(input))
  Object.assign(legacy, { native })
  try {
    expect(fs.realpathSync(child)).toBe(join(inside, "workspace"))

    const result = isPathInside(child, inside)

    expect(result).toBe(opensInside(child))
  } finally {
    legacy.mockRestore()
  }
})

test("#given dot-dot after a link in the input #when containment runs #then it judges the path.resolve()d path a caller opens", () => {
  const { inside } = symlinkFixture()
  const child = `${inside}/jump/../workspace`

  const result = isPathInside(child, inside)

  // The contract: callers open path.resolve(child), as Senpi's built-in tools do.
  expect(result).toBe(opensInside(resolve(child)))
  expect(result).toBe(true)
})

test("#given an absent target #when strict containment runs #then it throws instead of granting an ancestor", () => {
  const { inside } = symlinkFixture()

  expect(() => isPathInside(join(inside, "missing.md"), inside)).toThrow()
})
