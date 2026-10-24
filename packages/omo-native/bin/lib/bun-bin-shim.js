import { chmodSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir as osHomedir } from "node:os"
import { dirname, join, relative } from "node:path"
import { bunRoot, findBunBinary, isUnderBunGlobalTree } from "./bun-runtime.js"

const NODE_SHEBANG = "#!/usr/bin/env node\n"
// sh executes the second line; JS sees a string expression followed by a comment. No install
// paths are interpolated into code, so spaces, quotes and newlines in BUN_INSTALL stay data.
const BUN_PRELUDE = [
  "#!/bin/sh",
  `':' //; if [ "$OMO_RUNTIME" != node ]; then for b in "\${BUN_INSTALL:-$HOME/.bun}/bin/bun" "$HOME/.bun/bin/bun"; do if [ -x "$b" ]; then exec "$b" "$0" "$@"; fi; done; if command -v bun >/dev/null 2>&1; then exec bun "$0" "$@"; fi; fi; exec node "$0" "$@"`,
  "",
].join("\n")

const BIN_ENTRIES = [
  { label: "bin", segments: ["bin", "omo"] },
  { label: "node-modules-bin", segments: ["install", "global", "node_modules", ".bin", "omo"] },
]

/** Prepare only the package-owned file. Bun's bin symlinks must never become regular files. */
function prepareEntrypoint(io) {
  const source = io.readFile(io.scriptPath, "utf8")
  if (source.startsWith(BUN_PRELUDE)) return
  if (!source.startsWith(NODE_SHEBANG)) throw new Error("unrecognized omo entrypoint")
  const temporary = `${io.scriptPath}.${io.pid}.tmp`
  try {
    io.write(temporary, BUN_PRELUDE + source.slice(NODE_SHEBANG.length), { mode: 0o755 })
    io.chmod(temporary, 0o755)
    io.rename(temporary, io.scriptPath)
  } finally {
    io.remove(temporary, { force: true })
  }
}

function restoreLegacyBin(binPath, io) {
  let stats
  try {
    stats = io.lstat(binPath)
  } catch {
    return "absent-bin"
  }
  if (stats.isSymbolicLink()) {
    return io.realpath(binPath) === io.scriptPath ? "current" : "foreign-link"
  }
  if (!stats.isFile()) return "foreign-entry"
  const source = io.readFile(binPath, "utf8")
  const legacy = /^#!\/bin\/sh\n# omo-ai bun launcher shim v\d+[^\n]*\n/.exec(source)
  if (!legacy || !source.slice(legacy[0].length).startsWith(`# entry: ${io.scriptPath}\n`)) return "foreign-file"
  const temporary = `${binPath}.${io.pid}.tmp`
  try {
    io.symlink(relative(io.realpath(dirname(binPath)), io.scriptPath), temporary)
    io.rename(temporary, binPath)
  } finally {
    io.remove(temporary, { force: true })
  }
  return "repaired"
}

function repairBinEntry(entry, root, io) {
  const path = join(root, ...entry.segments)
  try {
    return { label: entry.label, path, action: restoreLegacyBin(path, io), error: undefined }
  } catch (error) {
    if (io.env.OMO_DEBUG) io.warn(`omo: bun launcher migration left untouched at ${path}: ${error.message}`)
    return { label: entry.label, path, action: "failed", error: error.message }
  }
}

/**
 * Trusted postinstall prepares Bun-only startup (#9293); launches also repair older installs.
 * Prepare the entrypoint before replacing old marked wrappers, so a failed preparation leaves
 * their working Bun launch path intact. Windows/npm retain their shipped Node entrypoint.
 */
export function ensureBunBinShim(input) {
  const env = input.env ?? process.env
  const homedir = input.homedir ?? osHomedir
  const platform = input.platform ?? process.platform
  const io = {
    env,
    scriptPath: input.scriptPath,
    lstat: input.lstat ?? lstatSync,
    realpath: input.realpath ?? realpathSync,
    readFile: input.readFile ?? readFileSync,
    write: input.write ?? writeFileSync,
    rename: input.rename ?? renameSync,
    chmod: input.chmod ?? chmodSync,
    symlink: input.symlink ?? symlinkSync,
    remove: input.remove ?? rmSync,
    pid: input.pid ?? process.pid,
    warn: input.warn ?? ((message) => console.error(message)),
  }

  if (platform !== "darwin" && platform !== "linux") return { action: "skipped-platform", error: undefined, entries: [] }
  if (!isUnderBunGlobalTree(input.scriptPath, { env, homedir, platform, realpath: io.realpath })) {
    return { action: "skipped-install", error: undefined, entries: [] }
  }
  if (!findBunBinary({ env, homedir, platform, exists: input.exists, realpath: io.realpath })) {
    return { action: "skipped-no-bun", error: undefined, entries: [] }
  }
  try {
    prepareEntrypoint(io)
  } catch (error) {
    if (env.OMO_DEBUG) io.warn(`omo: bun entrypoint left untouched at ${io.scriptPath}: ${error.message}`)
    return { action: "failed", error: error.message, entries: [] }
  }

  const entries = BIN_ENTRIES.map((entry) => repairBinEntry(entry, bunRoot(env, homedir, platform), io))
  const primary = entries[0]
  return { action: primary.action, error: primary.error, entries }
}
