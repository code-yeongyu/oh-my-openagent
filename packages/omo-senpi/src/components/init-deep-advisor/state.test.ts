/// <reference types="bun-types" />

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { COOLDOWN_DAYS } from "./constants"
import {
  cleanupTempDirs,
  commitAll,
  git,
  initRepo,
  makeTempDir,
  sourceFile,
  writeFileAt,
} from "./fixtures.test-support"
import {
  getAdvisorStateDir,
  isCoolingDown,
  isGloballyDeclined,
  isProjectDeclined,
  readCooldownUntil,
  readLastProposedHead,
  readSnapshot,
  repoHash,
  writeCooldown,
  writeGlobalDecline,
  writeLastProposedHead,
  writeProjectDecline,
} from "./state"
import type { InitDeepSnapshotV1 } from "./state"

const MS_PER_DAY = 86_400_000

afterEach(() => {
  cleanupTempDirs()
})

function makeStateDir(): string {
  return makeTempDir("omo-advisor-state-")
}

function makeRepo(): string {
  const root = initRepo("omo-advisor-repo-")
  writeFileAt(root, join("src", "a.ts"), sourceFile(5))
  commitAll(root, "init")
  return root
}

function writeSnapshotRaw(root: string, contents: string): void {
  mkdirSync(join(root, ".omo"), { recursive: true })
  writeFileSync(join(root, ".omo", "init-deep.json"), contents)
}

describe("getAdvisorStateDir", () => {
  test("#given an agent home env #when resolving the advisor state dir #then it nests under the omo-native state dir", () => {
    // given
    const home = makeTempDir("omo-advisor-home-")

    // when
    const dir = getAdvisorStateDir({ SENPI_CODING_AGENT_DIR: home })

    // then
    expect(dir.endsWith(join("omo-senpi", "omo-native", "init-deep-advisor-state"))).toBe(true)
  })
})

describe("repoHash", () => {
  test("#given the same repo #when hashing twice #then the hash is stable", () => {
    // given
    const root = makeRepo()

    // when
    const first = repoHash(root)
    const second = repoHash(root)

    // then
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  test("#given two distinct repos #when hashing #then the hashes differ", () => {
    // given
    const rootA = makeRepo()
    const rootB = makeRepo()

    // when / then
    expect(repoHash(rootA)).not.toBe(repoHash(rootB))
  })

  test("#given a linked worktree of one repo #when hashing #then it shares the main repo hash", () => {
    // given
    const root = makeRepo()
    const worktreeParent = makeTempDir("omo-advisor-wt-")
    const worktree = join(worktreeParent, "linked")
    git(root, ["worktree", "add", "-b", "linked-branch", worktree])

    // when / then
    expect(repoHash(worktree)).toBe(repoHash(root))
  })
})

describe("global and project declines", () => {
  test("#given a fresh state dir #when writing a global decline #then it reads back as declined", () => {
    // given
    const stateDir = makeStateDir()
    expect(isGloballyDeclined(stateDir)).toBe(false)

    // when
    writeGlobalDecline(stateDir)

    // then
    expect(isGloballyDeclined(stateDir)).toBe(true)
  })

  test("#given a nested state dir that does not exist yet #when writing a project decline #then the parent is created", () => {
    // given
    const stateDir = join(makeStateDir(), "nested", "advisor")

    // when
    writeProjectDecline(stateDir, "hash-a")

    // then
    expect(isProjectDeclined(stateDir, "hash-a")).toBe(true)
  })

  test("#given a project decline for one repo #when checking another repo #then it is not declined", () => {
    // given
    const stateDir = makeStateDir()
    writeProjectDecline(stateDir, "hash-a")

    // when / then
    expect(isProjectDeclined(stateDir, "hash-b")).toBe(false)
  })
})

describe("cooldown", () => {
  test("#given a cooldown written now #when reading the deadline #then it is COOLDOWN_DAYS ahead", () => {
    // given
    const stateDir = makeStateDir()
    const at = 1_700_000_000_000

    // when
    writeCooldown(stateDir, "hash-a", at)

    // then
    expect(readCooldownUntil(stateDir, "hash-a")).toBe(at + COOLDOWN_DAYS * MS_PER_DAY)
    expect(isCoolingDown(stateDir, "hash-a", at + MS_PER_DAY)).toBe(true)
    expect(isCoolingDown(stateDir, "hash-a", at + COOLDOWN_DAYS * MS_PER_DAY)).toBe(false)
  })

  test("#given no cooldown record #when reading the deadline #then it returns 0", () => {
    // given
    const stateDir = makeStateDir()

    // when / then
    expect(readCooldownUntil(stateDir, "missing")).toBe(0)
    expect(isCoolingDown(stateDir, "missing", Date.now())).toBe(false)
  })

  test("#given a malformed cooldown record #when reading the deadline #then it returns 0", () => {
    // given
    const stateDir = makeStateDir()
    const dir = join(stateDir, "init-deep-advisor-cooldowns")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "bad"), "not json{{{")

    // when / then
    expect(readCooldownUntil(stateDir, "bad")).toBe(0)
  })

  test("#given a cooldown record with a non-number until #when reading the deadline #then it returns 0", () => {
    // given
    const stateDir = makeStateDir()
    const dir = join(stateDir, "init-deep-advisor-cooldowns")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "typed"), JSON.stringify({ until: "soon" }))

    // when / then
    expect(readCooldownUntil(stateDir, "typed")).toBe(0)
  })
})

describe("last proposed head", () => {
  test("#given a written head #when reading it back #then it round-trips", () => {
    // given
    const stateDir = makeStateDir()
    const head = "a".repeat(40)

    // when
    writeLastProposedHead(stateDir, "hash-a", head)

    // then
    expect(readLastProposedHead(stateDir, "hash-a")).toBe(head)
  })

  test("#given no proposal record #when reading the head #then it returns null", () => {
    // given
    const stateDir = makeStateDir()

    // when / then
    expect(readLastProposedHead(stateDir, "missing")).toBeNull()
  })

  test("#given a malformed proposal record #when reading the head #then it returns null", () => {
    // given
    const stateDir = makeStateDir()
    const dir = join(stateDir, "init-deep-advisor-proposals")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "bad"), "{not json")
    writeFileSync(join(dir, "typed"), JSON.stringify({ lastProposedHead: 42 }))

    // when / then
    expect(readLastProposedHead(stateDir, "bad")).toBeNull()
    expect(readLastProposedHead(stateDir, "typed")).toBeNull()
  })
})

describe("readSnapshot", () => {
  test("#given no snapshot file #when reading #then it reports missing", () => {
    // given
    const root = makeTempDir("omo-advisor-snapshot-")

    // when / then
    expect(readSnapshot(root)).toEqual({ kind: "missing" })
  })

  test("#given a complete valid snapshot #when reading #then it reports valid with the parsed snapshot", () => {
    // given
    const root = makeTempDir("omo-advisor-snapshot-")
    const snapshot: InitDeepSnapshotV1 = {
      commitSha: "b".repeat(40),
      fileCount: 12,
      loc: 3400,
      timestamp: 1_700_000_000_000,
      mode: "committed",
    }
    writeSnapshotRaw(root, JSON.stringify(snapshot))

    // when
    const result = readSnapshot(root)

    // then
    expect(result).toEqual({ kind: "valid", snapshot })
  })

  test("#given a snapshot with extra fields #when reading #then it stays valid (forward compatible)", () => {
    // given
    const root = makeTempDir("omo-advisor-snapshot-")
    writeSnapshotRaw(
      root,
      JSON.stringify({
        commitSha: "c".repeat(40),
        fileCount: 1,
        loc: 2,
        timestamp: 3,
        mode: "local",
        futureField: { nested: true },
      }),
    )

    // when
    const result = readSnapshot(root)

    // then
    expect(result.kind).toBe("valid")
  })

  test("#given unparseable JSON #when reading #then it reports invalid", () => {
    // given
    const root = makeTempDir("omo-advisor-snapshot-")
    writeSnapshotRaw(root, "{not json")

    // when / then
    expect(readSnapshot(root)).toEqual({ kind: "invalid" })
  })

  test("#given non-object JSON roots #when reading #then each reports invalid", () => {
    // given
    const roots = ["[]", "null", "true", '"a string"', "42"]

    // when / then
    for (const raw of roots) {
      const root = makeTempDir("omo-advisor-snapshot-")
      writeSnapshotRaw(root, raw)
      expect(readSnapshot(root)).toEqual({ kind: "invalid" })
    }
  })

  test("#given a snapshot missing a required field #when reading #then it reports invalid", () => {
    // given
    const root = makeTempDir("omo-advisor-snapshot-")
    writeSnapshotRaw(
      root,
      JSON.stringify({ commitSha: "d".repeat(40), fileCount: 1, loc: 2, mode: "local" }),
    )

    // when / then
    expect(readSnapshot(root)).toEqual({ kind: "invalid" })
  })

  test("#given a snapshot with wrong field types #when reading #then it reports invalid", () => {
    // given
    const root = makeTempDir("omo-advisor-snapshot-")
    writeSnapshotRaw(
      root,
      JSON.stringify({ commitSha: 12345, fileCount: "1", loc: 2, timestamp: 3, mode: "local" }),
    )

    // when / then
    expect(readSnapshot(root)).toEqual({ kind: "invalid" })
  })

  test("#given negative or non-finite numbers #when reading #then it reports invalid", () => {
    // given
    const negativeRoot = makeTempDir("omo-advisor-snapshot-")
    writeSnapshotRaw(
      negativeRoot,
      JSON.stringify({ commitSha: "e".repeat(40), fileCount: -1, loc: 2, timestamp: 3, mode: "local" }),
    )
    const infiniteRoot = makeTempDir("omo-advisor-snapshot-")
    writeSnapshotRaw(
      infiniteRoot,
      '{"commitSha":"eeee","fileCount":1,"loc":1e999,"timestamp":3,"mode":"local"}',
    )

    // when / then
    expect(readSnapshot(negativeRoot)).toEqual({ kind: "invalid" })
    expect(readSnapshot(infiniteRoot)).toEqual({ kind: "invalid" })
  })

  test("#given a mode outside the frozen enum #when reading #then it reports invalid", () => {
    // given
    const root = makeTempDir("omo-advisor-snapshot-")
    writeSnapshotRaw(
      root,
      JSON.stringify({ commitSha: "f".repeat(40), fileCount: 1, loc: 2, timestamp: 3, mode: "hybrid" }),
    )

    // when / then
    expect(readSnapshot(root)).toEqual({ kind: "invalid" })
  })
})
