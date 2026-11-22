import { randomBytes } from "node:crypto"
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"

import { runtimeHome } from "./bin/lib/agent-dir.js"

// omo#13602 (Q: remote sessions on by default, turned off with disable): `omo remote disable` records that this user
// turned remote sessions off, so the bootstrap every omo start runs never sets them up again, even when the device
// service's own switch comes back on (a reinstall or a forget resets it); `omo remote enable` clears the record. It lives
// in omo's config root, never in the device service's state dir, which its installer owns. The OmO desktop app reads and
// writes the same file the same way.

export type RemoteOptOut = {
  readonly read: () => boolean
  readonly record: () => void
  readonly clear: () => void
}

const remoteOptOutPath = (home: string = runtimeHome()): string => join(home, ".omo", "remote-sessions.json")

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && "code" in error ? String(error.code) : undefined

// The record never follows a link (omo#13602 security review): a symlink planted at the path or as ~/.omo must not
// redirect the write onto another file. The write goes to a fresh file in the same directory, opened without following
// links, and is renamed over the path; a rename replaces a symlink there instead of writing through it.
// A ~/.omo the user links to a directory they own (dotfiles, a relocated home) is theirs (#13602 review M2): the record
// goes into the directory it resolves to, which must be a directory this user owns.
function ownedDirectory(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const resolved = realpathSync(dir)
  const target = statSync(resolved)
  if (!target.isDirectory() || (typeof process.getuid === "function" && target.uid !== process.getuid()))
    throw new Error(`${dir} is not a directory this user owns`)
  return resolved
}

function writeRecord(path: string, text: string): void {
  const dir = ownedDirectory(dirname(path))
  const target = join(dir, basename(path))
  const temp = join(dir, `.remote-sessions.${randomBytes(6).toString("hex")}.tmp`)
  const fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  try {
    writeSync(fd, text)
    fsyncSync(fd)
    closeSync(fd)
    renameSync(temp, target)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

export function remoteOptOut(path: string = remoteOptOutPath()): RemoteOptOut {
  return {
    // A record that is not a regular file (a link, a directory) or that does not parse still says the user turned remote
    // sessions off: honoring it is the safe reading, and nothing at the path is ever followed.
    read: () => {
      let isFile: boolean
      try {
        isFile = lstatSync(path).isFile()
      } catch (error) {
        if (errorCode(error) === "ENOENT") return false
        return true
      }
      if (!isFile) return true
      try {
        const value: unknown = JSON.parse(readFileSync(path, "utf8"))
        return !isRecord(value) || value["remote_sessions"] !== "on"
      } catch {
        return true
      }
    },
    record: () => writeRecord(path, `${JSON.stringify({ remote_sessions: "off", since: new Date().toISOString() })}\n`),
    // rm removes a link itself, never what it points at.
    clear: () => rmSync(path, { force: true }),
  }
}
