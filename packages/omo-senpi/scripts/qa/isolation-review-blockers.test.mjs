import { expect, test } from "bun:test"
import { closeSync, fstatSync, mkdtempSync, openSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as isolationState from "./isolation-state.mjs"

const {
  classifyObservedChanges,
  credentialDigest,
  digestDirectory,
  isolationVerdict,
  snapshotDirectory,
  snapshotProtectedState,
} = isolationState

const LIMITS = { maxFiles: 10, maxBytes: 1024, maxEntries: 10 }

function codedError(code) {
  return Object.assign(new Error(code), { code })
}

function completeProtected(entries = []) {
  return { snapshot: new Map(entries), complete: true, errors: [] }
}

test("#given direct, protected-observed, persistent-observed, and volatile changes #when the canonical verdict is built #then only volatile paths are excluded from the sorted union", () => {
  // Given
  const before = completeProtected([["auth.json", "before"]])
  const after = completeProtected([["auth.json", "after"]])

  // When
  const verdict = isolationVerdict(before, after, [
    "sessions/live.jsonl",
    "nested/persistent.json",
    "auth.json",
    "nested/persistent.json",
  ])

  // Then
  expect(classifyObservedChanges(["nested/persistent.json"]).other).toEqual(["nested/persistent.json"])
  expect(verdict.changedPaths).toEqual(["auth.json", "nested/persistent.json"])
  expect(verdict.untouched).toBe(false)
})

test("#given only explicitly volatile observed writes #when the canonical verdict is built #then the protected home remains untouched", () => {
  // Given
  const before = completeProtected([["auth.json", "stable"]])
  const after = completeProtected([["auth.json", "stable"]])

  // When
  const verdict = isolationVerdict(before, after, ["cache\\index.json", "logs/run.log", "sessions/live.jsonl"])

  // Then
  expect(verdict.changedPaths).toEqual([])
  expect(verdict.untouched).toBe(true)
})

test("#given a protected change or incomplete protected snapshot #when the canonical verdict is built #then untouched fails closed", () => {
  // Given
  const stable = completeProtected([["auth.json", "stable"]])
  const changed = completeProtected([["auth.json", "changed"]])
  const incomplete = { snapshot: new Map(stable.snapshot), complete: false, errors: [{ path: "auth.json", code: "EIO" }] }

  // When
  const changedVerdict = isolationVerdict(stable, changed, [])
  const incompleteVerdict = isolationVerdict(stable, incomplete, [])

  // Then
  expect(changedVerdict.changedPaths).toEqual(["auth.json"])
  expect(changedVerdict.untouched).toBe(false)
  expect(incompleteVerdict.untouched).toBe(false)
})

test("#given POSIX and Windows-shaped observed paths #when changes are classified #then volatile prefixes are canonical on both platforms", () => {
  // Given
  const paths = ["sessions/a", "sessions\\b", "cache/a", "cache\\b", "logs/a", "logs\\b", "state\\keep.json"]

  // When
  const classified = classifyObservedChanges(paths)

  // Then
  expect(classified.volatile).toEqual(["cache/a", "cache/b", "logs/a", "logs/b", "sessions/a", "sessions/b"])
  expect(classified.other).toEqual(["state/keep.json"])
})

test("#given credential files are absent or inaccessible #when credentialDigest reads directly #then only ENOENT is treated as absent", () => {
  // Given
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-credential-io-"))
  try {
    const absent = () => { throw codedError("ENOENT") }

    // When
    const digest = credentialDigest(root, { readFile: absent })

    // Then
    expect(typeof digest).toBe("string")
    for (const code of ["EACCES", "EIO"]) {
      expect(() => credentialDigest(root, { readFile() { throw codedError(code) } })).toThrow(code)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#given bounded observation root enumeration fails #when snapshotDirectory runs #then inaccessible IO is structured and incomplete while absence is empty-complete", () => {
  // Given
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-root-io-"))
  try {
    for (const code of ["EACCES", "EIO"]) {
      // When
      const scan = snapshotDirectory(join(root, "missing"), LIMITS, { opendirSync() { throw codedError(code) } })

      // Then
      expect(scan.complete).toBe(false)
      expect(scan.errors).toEqual([{ path: ".", code }])
    }
    for (const code of ["ENOENT", "ENOTDIR"]) {
      const scan = snapshotDirectory(root, LIMITS, { opendirSync() { throw codedError(code) } })
      expect(scan.complete).toBe(true)
      expect(scan.errors).toEqual([])
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#given digest enumeration and reads fail through injected seams #when digestDirectory runs #then transient absence is tolerated and inaccessible IO propagates", () => {
  // Given
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-digest-io-"))
  try {
    for (const code of ["ENOENT", "ENOTDIR"]) {
      expect(digestDirectory(root, { readdir() { throw codedError(code) } })).toBe("absent")
    }

    // When / Then
    for (const code of ["EACCES", "EIO"]) {
      expect(() => digestDirectory(root, { readdir() { throw codedError(code) } })).toThrow(code)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#given pre-open metadata changed and current-path diagnostic stat fails #when public readers report the race #then the established replacement error wins", () => {
  for (const kind of ["observed", "protected"]) {
    for (const openingCode of ["FILE_REPLACED", "FILE_CHANGED"]) {
      for (const diagnosticCode of ["ENOENT", "EACCES"]) {
        // Given
        const root = mkdtempSync(join(tmpdir(), `omo-senpi-diagnostic-${kind}-`))
        const name = kind === "observed" ? "state.json" : "auth.json"
        const path = join(root, name)
        try {
          writeFileSync(path, "AAAA")
          let statCalls = 0
          const io = {
            openSync,
            closeSync,
            fstatSync(fd, options) {
              const metadata = fstatSync(fd, options)
              return openingCode === "FILE_REPLACED"
                ? { ...metadata, ino: metadata.ino + 1n }
                : { ...metadata, size: metadata.size + 1n }
            },
            statSync(file, options) {
              statCalls += 1
              if (file === path && statCalls > 1) throw codedError(diagnosticCode)
              return statSync(file, options)
            },
          }

          // When
          const result = kind === "observed"
            ? snapshotDirectory(root, LIMITS, io)
            : snapshotProtectedState(root, io)

          // Then
          expect(result.complete).toBe(false)
          expect(result.errors).toEqual([{ path: name, code: openingCode }])
        } finally {
          rmSync(root, { recursive: true, force: true })
        }
      }
    }
  }
})

test("#given a primary read error and failing shrink diagnostic #when an observed file is hashed #then the primary read error is preserved", () => {
  // Given
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-read-diagnostic-"))
  const path = join(root, "state.json")
  try {
    writeFileSync(path, "AAAA")
    let fstatCalls = 0
    const io = {
      openSync,
      closeSync,
      statSync,
      readSync() { throw codedError("EREAD") },
      fstatSync(fd, options) {
        fstatCalls += 1
        if (fstatCalls > 1) throw codedError("EFSTAT")
        return fstatSync(fd, options)
      },
    }

    // When
    const result = snapshotDirectory(root, LIMITS, io)

    // Then
    expect(result.complete).toBe(false)
    expect(result.errors).toEqual([{ path: "state.json", code: "EREAD" }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
