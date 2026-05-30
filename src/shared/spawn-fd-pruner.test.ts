import { describe, expect, test } from "bun:test"

import {
  pruneLeakedDirectoryFileDescriptors,
  type SpawnFdPrunerDependencies,
} from "./spawn-fd-pruner"

class FileDescriptorError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

function createStats(isDirectory: boolean): { isDirectory(): boolean } {
  return {
    isDirectory: () => isDirectory,
  }
}

describe("pruneLeakedDirectoryFileDescriptors", () => {
  test("#given darwin Bun process above threshold #when pruning #then only directory descriptors are closed", () => {
    // given
    const closedDescriptors: number[] = []
    const dependencies = {
      platform: "darwin",
      isBunRuntime: true,
      readdirSync: () => ["0", "1", "2", "3", "4", "not-a-fd", "5"],
      fstatSync: (fd: number) => createStats(fd !== 4),
      closeSync: (fd: number) => {
        closedDescriptors.push(fd)
      },
    } satisfies SpawnFdPrunerDependencies

    // when
    const result = pruneLeakedDirectoryFileDescriptors(dependencies, { threshold: 5 })

    // then
    expect(closedDescriptors).toEqual([3, 5])
    expect(result).toEqual({ skipped: false, inspectedCount: 3, closedCount: 2 })
  })

  test("#given fd count below threshold #when pruning #then it skips descriptor inspection", () => {
    // given
    const dependencies = {
      platform: "darwin",
      isBunRuntime: true,
      readdirSync: () => ["0", "1", "2", "3"],
      fstatSync: () => {
        throw new Error("fstatSync should not run below threshold")
      },
      closeSync: () => {
        throw new Error("closeSync should not run below threshold")
      },
    } satisfies SpawnFdPrunerDependencies

    // when
    const result = pruneLeakedDirectoryFileDescriptors(dependencies, { threshold: 10 })

    // then
    expect(result).toEqual({ skipped: true, inspectedCount: 0, closedCount: 0 })
  })

  test("#given non-darwin or non-Bun process #when pruning #then it no-ops", () => {
    // given
    const createDependencies = (
      platform: SpawnFdPrunerDependencies["platform"],
      isBunRuntime: boolean,
    ): SpawnFdPrunerDependencies => ({
      platform,
      isBunRuntime,
      readdirSync: () => {
        throw new Error("readdirSync should not run outside darwin Bun")
      },
      fstatSync: () => createStats(true),
      closeSync: () => {},
    })

    // when
    const linuxResult = pruneLeakedDirectoryFileDescriptors(createDependencies("linux", true), { threshold: 1 })
    const nodeResult = pruneLeakedDirectoryFileDescriptors(createDependencies("darwin", false), { threshold: 1 })

    // then
    expect(linuxResult).toEqual({ skipped: true, inspectedCount: 0, closedCount: 0 })
    expect(nodeResult).toEqual({ skipped: true, inspectedCount: 0, closedCount: 0 })
  })

  test("#given transient fd scan errors #when pruning #then it ignores them and keeps closing other directories", () => {
    // given
    const closedDescriptors: number[] = []
    const dependencies = {
      platform: "darwin",
      isBunRuntime: true,
      readdirSync: () => ["3", "4", "5", "6"],
      fstatSync: (fd: number) => {
        if (fd === 3) {
          throw new FileDescriptorError("EBADF")
        }

        return createStats(true)
      },
      closeSync: (fd: number) => {
        if (fd === 5) {
          throw new FileDescriptorError("EINVAL")
        }

        closedDescriptors.push(fd)
      },
    } satisfies SpawnFdPrunerDependencies

    // when
    const result = pruneLeakedDirectoryFileDescriptors(dependencies, { threshold: 1 })

    // then
    expect(closedDescriptors).toEqual([4, 6])
    expect(result).toEqual({ skipped: false, inspectedCount: 4, closedCount: 2 })
  })

  test("#given unexpected fd scan error #when pruning #then it rethrows", () => {
    // given
    const dependencies = {
      platform: "darwin",
      isBunRuntime: true,
      readdirSync: () => ["3"],
      fstatSync: () => {
        throw new FileDescriptorError("EPERM")
      },
      closeSync: () => {},
    } satisfies SpawnFdPrunerDependencies

    // when
    const prune = () => pruneLeakedDirectoryFileDescriptors(dependencies, { threshold: 1 })

    // then
    expect(prune).toThrow("EPERM")
  })
})
