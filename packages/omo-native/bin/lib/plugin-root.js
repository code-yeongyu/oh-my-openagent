import { createHash } from "node:crypto"
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs"
import { basename, dirname, join, parse, resolve } from "node:path"
import { LAUNCH_SPEC_FILENAME } from "./launch-spec-mode.js"
import { prunePluginCaches } from "./plugin-root-cache.js"

const OTHER_WRITE = 0o022
const STICKY = 0o1000

function errorCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code
}

function statPath(path, io) {
  return (io.lstat ?? lstatSync)(path)
}

function currentUid(io) {
  const uid = io.getuid === undefined ? process.getuid?.() : io.getuid()
  if (uid === undefined) throw new Error("cannot determine current uid for plugin relocation")
  return uid
}

function assertTrustedDirectory(path, stat, uid) {
  if (!stat.isDirectory()) throw new Error(`unsafe plugin path is not a directory: ${path}`)
  if (stat.uid !== uid && stat.uid !== 0) throw new Error(`unsafe plugin path owner at ${path}: ${stat.uid}`)
  const mode = stat.mode & 0o7777
  const rootSticky = stat.uid === 0 && (mode & STICKY) !== 0
  if ((mode & OTHER_WRITE) !== 0 && !rootSticky) throw new Error(`unsafe writable plugin path ancestor: ${path}`)
}

function assertTrustedAncestors(path, security) {
  let current = resolve(path)
  const root = parse(current).root
  while (true) {
    assertTrustedDirectory(current, statPath(current, security.io), security.uid)
    if (current === root) return
    current = dirname(current)
  }
}

function ensurePrivateDirectory(path, security) {
  let existing = resolve(path)
  const missing = []
  let absolute
  while (true) {
    try {
      absolute = join(realpathSync(existing), ...missing)
      break
    } catch (error) {
      if (!errorCode(error, "ENOENT") || existing === dirname(existing)) throw error
      missing.unshift(basename(existing))
      existing = dirname(existing)
    }
  }
  const root = parse(absolute).root
  const parts = absolute.slice(root.length).split(/[\\/]+/).filter(Boolean)
  let current = root
  for (const part of parts) {
    current = join(current, part)
    let stat
    try {
      stat = statPath(current, security.io)
    } catch (error) {
      if (!errorCode(error, "ENOENT")) throw error
      let created = false
      try {
        mkdirSync(current, { mode: 0o700 })
        created = true
      } catch (creationError) {
        if (!errorCode(creationError, "EEXIST")) throw creationError
      }
      stat = statPath(current, security.io)
      if (!stat.isDirectory() || stat.uid !== security.uid) throw new Error(`unsafe new plugin cache directory: ${current}`)
      if (created) {
        chmodSync(current, 0o700)
        stat = statPath(current, security.io)
      }
    }
    assertTrustedDirectory(current, stat, security.uid)
    if (current === absolute && (stat.uid !== security.uid || (stat.mode & 0o7777) !== 0o700)) {
      throw new Error(`plugin cache directory must be private and user-owned: ${current}`)
    }
  }
  return absolute
}

function sourceSnapshot(pluginRoot, security) {
  assertTrustedAncestors(pluginRoot, security)
  const entries = []
  function visit(relative, path) {
    const stat = statPath(path, security.io)
    const directory = stat.isDirectory()
    if (!directory && !stat.isFile()) throw new Error(`plugin contains a symlink or special file: ${path}`)
    if (stat.uid !== 0) throw new Error(`root-owned plugin payload contains a foreign owner: ${path}`)
    const mode = stat.mode & 0o7777
    if ((mode & OTHER_WRITE) !== 0) throw new Error(`root-owned plugin payload is group/world-writable: ${path}`)
    const entry = { relative, directory, mode }
    entries.push(entry)
    if (directory) {
      for (const name of readdirSync(path).sort()) visit(relative ? join(relative, name) : name, join(path, name))
    } else {
      entry.digest = createHash("sha256").update(readFileSync(path)).digest("hex")
    }
  }
  visit("", pluginRoot)
  if (!entries.some((entry) => entry.relative === LAUNCH_SPEC_FILENAME && !entry.directory)) {
    throw new Error(`root-owned plugin is missing a regular ${LAUNCH_SPEC_FILENAME}`)
  }
  const hash = createHash("sha256")
  for (const entry of entries) {
    hash.update(`${entry.directory ? "d" : "f"}\0${entry.relative}\0${entry.mode.toString(8)}\0${entry.digest ?? ""}\0`)
  }
  return { entries, fingerprint: hash.digest("hex") }
}

function assertUnchangedSource(pluginRoot, expected, security) {
  if (sourceSnapshot(pluginRoot, security).fingerprint !== expected.fingerprint) {
    throw new Error("root-owned plugin changed during relocation")
  }
}

function validateCacheTree(cacheRoot, sourceEntries, security) {
  const expected = new Map(sourceEntries.map((entry) => [entry.relative, entry]))
  const seen = new Set()
  function visit(relative, path) {
    const entry = expected.get(relative)
    if (entry === undefined) throw new Error(`plugin cache contains an unexpected path: ${path}`)
    const stat = statPath(path, security.io)
    if (stat.uid !== security.uid) throw new Error(`plugin cache path is not user-owned: ${path}`)
    if (entry.directory) {
      if (!stat.isDirectory() || (stat.mode & 0o7777) !== 0o700) throw new Error(`plugin cache directory is not private: ${path}`)
    } else {
      const mode = 0o600 | (entry.mode & 0o100)
      if (!stat.isFile() || (stat.mode & 0o7777) !== mode) throw new Error(`plugin cache file has unsafe type or mode: ${path}`)
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex")
      if (digest !== entry.digest) throw new Error(`plugin cache file does not match its source: ${path}`)
    }
    seen.add(relative)
    if (entry.directory) {
      for (const name of readdirSync(path).sort()) visit(relative ? join(relative, name) : name, join(path, name))
    }
  }
  visit("", cacheRoot)
  if (seen.size !== expected.size) throw new Error("plugin cache is incomplete")
}

function copySnapshot(paths, snapshot, security) {
  const { pluginRoot, cacheRoot } = paths
  const staging = mkdtempSync(join(cacheRoot, ".plugin-root-"))
  chmodSync(staging, 0o700)
  try {
    for (const entry of snapshot.entries) {
      if (entry.relative === "") continue
      const source = join(pluginRoot, entry.relative)
      const destination = join(staging, entry.relative)
      if (entry.directory) {
        mkdirSync(destination, { mode: 0o700 })
        chmodSync(destination, 0o700)
      } else {
        copyFileSync(source, destination)
        chmodSync(destination, 0o600 | (entry.mode & 0o100))
      }
    }
    validateCacheTree(staging, snapshot.entries, security)
    assertUnchangedSource(pluginRoot, snapshot, security)
    const target = join(cacheRoot, snapshot.fingerprint)
    try {
      ;(security.io.rename ?? renameSync)(staging, target)
    } catch (error) {
      try {
        statPath(target, security.io)
      } catch (targetError) {
        if (errorCode(targetError, "ENOENT")) throw error
        throw targetError
      }
    }
    validateCacheTree(target, snapshot.entries, security)
    assertUnchangedSource(pluginRoot, snapshot, security)
    return target
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** @param {string} installedPluginRoot @param {string} cacheRoot @param {{ platform?: string, getuid?: () => number | undefined, lstat?: (path: string) => ReturnType<typeof lstatSync>, rename?: (source: string, destination: string) => void }} [io] @returns {string} */
export function resolvePluginRoot(installedPluginRoot, cacheRoot, io = {}) {
  if ((io.platform ?? process.platform) === "win32") return installedPluginRoot
  const installedRoot = resolve(installedPluginRoot)
  let specStat
  try {
    specStat = statPath(join(installedRoot, LAUNCH_SPEC_FILENAME), io)
  } catch (error) {
    if (errorCode(error, "ENOENT") || errorCode(error, "ENOTDIR")) return installedPluginRoot
    throw error
  }
  const security = { uid: currentUid(io), io }
  if (specStat.uid === security.uid) return installedPluginRoot
  if (specStat.uid !== 0) throw new Error(`plugin launch spec is owned by unsupported uid ${specStat.uid}`)
  if (!specStat.isFile()) throw new Error("root-owned plugin launch spec is not a regular file")

  const pluginRoot = realpathSync(installedRoot)
  const snapshot = sourceSnapshot(pluginRoot, security)
  const privateRoot = ensurePrivateDirectory(cacheRoot, security)
  const target = join(privateRoot, snapshot.fingerprint)
  let targetExists = true
  try {
    statPath(target, security.io)
  } catch (error) {
    if (!errorCode(error, "ENOENT")) throw error
    targetExists = false
  }
  if (targetExists) {
    validateCacheTree(target, snapshot.entries, security)
    assertUnchangedSource(pluginRoot, snapshot, security)
    return target
  }
  const selected = copySnapshot({ pluginRoot, cacheRoot: privateRoot }, snapshot, security)
  try {
    prunePluginCaches(privateRoot, selected, security)
  } catch (error) {
    console.error(`WARN plugin cache: could not prune old private copies: ${error instanceof Error ? error.message : String(error)}`)
  }
  return selected
}
