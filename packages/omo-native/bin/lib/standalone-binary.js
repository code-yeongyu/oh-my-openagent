import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs"
import { join } from "node:path"

const SAMPLE_BYTES = 64 * 1024

// A compiled omo copies itself to ~/.omo/binary-runtime/<version>/omo on its first run
// (materializeProvisionedExecutable in compile-runtime.ts), so a standalone binary that has run
// once is that file or a byte-identical copy of it. Copies are compared by size and a bounded
// head+tail sample: these binaries are ~100 MB and the doctor must stay fast.
export function standaloneBinaryVersion(binPath, homeDir, isWindows) {
  const root = join(homeDir, ".omo", "binary-runtime")
  let versions
  try {
    versions = readdirSync(root)
  } catch {
    return null
  }
  const real = realPathOf(binPath)
  const size = regularFileSize(real)
  if (size === undefined) return null
  for (const version of versions) {
    const provisioned = realPathOf(join(root, version, isWindows ? "omo.exe" : "omo"))
    if (provisioned === real) return version
    if (regularFileSize(provisioned) === size && sameSamples(real, provisioned, size)) return version
  }
  return null
}

function realPathOf(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function regularFileSize(path) {
  try {
    const stats = statSync(path)
    return stats.isFile() ? stats.size : undefined
  } catch {
    return undefined
  }
}

function sameSamples(left, right, size) {
  const length = Math.min(SAMPLE_BYTES, size)
  const tail = Math.max(0, size - length)
  const a = readSamples(left, length, tail)
  const b = readSamples(right, length, tail)
  return a !== undefined && b !== undefined && a.equals(b)
}

function readSamples(path, length, tailOffset) {
  let descriptor
  try {
    descriptor = openSync(path, "r")
    const buffer = Buffer.alloc(length * 2)
    readSync(descriptor, buffer, 0, length, 0)
    readSync(descriptor, buffer, length, length, tailOffset)
    return buffer
  } catch {
    return undefined
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}
