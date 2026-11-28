import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { extractTarGz } from "./binary-downloader"

const tempRoots: string[] = []
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeArchive(entryNames: readonly string[]): string {
  const source = mkdtempSync(join(tmpdir(), "binary-downloader-src-"))
  tempRoots.push(source)
  for (const name of entryNames) writeFileSync(join(source, name), `${name}\n`)
  const archive = `${source}.tgz`
  tempRoots.push(archive)
  execFileSync("tar", ["czf", archive, "-C", source, ...entryNames])
  return archive
}

function makeDest(): string {
  const dest = mkdtempSync(join(tmpdir(), "binary-downloader-dest-"))
  tempRoots.push(dest)
  mkdirSync(join(dest, "out"), { recursive: true })
  return dest
}

describe.skipIf(process.platform === "win32")("extractTarGz", () => {
  test("#given an archive with a non-ASCII entry name on a UTF-8 locale machine #when it is listed and extracted #then the entry is validated under its real name and lands on disk", async () => {
    const archive = makeArchive(["ascii.txt", "한.txt"])
    const dest = makeDest()
    // GNU tar and bsdtar escape non-ASCII names unless the effective codeset is UTF-8; pin one so
    // the run does not depend on the machine's ambient locale.
    const utf8Lang = process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8"
    const previousLang = process.env.LANG
    const previousLcAll = process.env.LC_ALL
    process.env.LANG = utf8Lang
    process.env.LC_ALL = ""
    try {
      await extractTarGz(archive, join(dest, "out"))
    } finally {
      if (previousLang === undefined) delete process.env.LANG
      else process.env.LANG = previousLang
      if (previousLcAll === undefined) delete process.env.LC_ALL
      else process.env.LC_ALL = previousLcAll
    }

    expect(existsSync(join(dest, "out", "ascii.txt"))).toBe(true)
    expect(existsSync(join(dest, "out", "한.txt"))).toBe(true)
  })

  test("#given a startup TAR_OPTIONS the extraction does not inherit #when the validated archive is extracted #then it runs under the same environment as the listing", async () => {
    const archive = makeArchive(["ascii.txt"])
    const dest = makeDest()
    const previous = process.env.TAR_OPTIONS
    process.env.TAR_OPTIONS = "--no-such-tar-option"
    try {
      await extractTarGz(archive, join(dest, "out"))
    } finally {
      if (previous === undefined) delete process.env.TAR_OPTIONS
      else process.env.TAR_OPTIONS = previous
    }

    expect(existsSync(join(dest, "out", "ascii.txt"))).toBe(true)
  })
})
