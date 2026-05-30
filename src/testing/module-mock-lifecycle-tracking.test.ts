/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import { installModuleMockLifecycle } from "./module-mock-lifecycle"

describe("installModuleMockLifecycle active-test tracking", () => {
  test("reapplies module-evaluation mocks with their mock factory after active restore", () => {
    // given
    const events: string[] = []
    const loadOriginalModule = mock(() => ({ ok: true as const, value: { named: "original" } }))
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const { beginTestMockTracking, endTestMockTracking } = installModuleMockLifecycle(mockApi, {
      getCallerStack: () => "Error\n    at file:///repo/tests/top-level.test.ts:5:1\n    at moduleEvaluation (native:1:11)",
      getCallerUrl: () => "file:///repo/tests/top-level.test.ts",
      trackOnlyDuringActiveTest: true,
      isPersistentModuleMockOwner: () => true,
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule,
    })

    // when
    mockApi.module("./dependency", () => ({ named: "mocked" }))
    beginTestMockTracking()
    mockApi.restore()
    endTestMockTracking()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:mocked",
      "module:resolved:./dependency:mocked",
    ])
    expect(loadOriginalModule).not.toHaveBeenCalled()
  })

  test("restores original exports for active in-test mocks", () => {
    // given
    const events: string[] = []
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const { beginTestMockTracking, endTestMockTracking } = installModuleMockLifecycle(mockApi, {
      getCallerStack: () => "Error\n    at file:///repo/tests/example.test.ts:5:1\n    at test (native:1:11)",
      getCallerUrl: () => "file:///repo/tests/example.test.ts",
      trackOnlyDuringActiveTest: true,
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    // when
    beginTestMockTracking()
    mockApi.module("./dependency", () => ({ named: "mocked" }))
    mockApi.restore()
    endTestMockTracking()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:original",
      "module:resolved:./dependency:original",
    ])
  })

  test("restores active in-test mocks even when Bun stack includes module evaluation", () => {
    // given
    const events: string[] = []
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const { beginTestMockTracking, endTestMockTracking } = installModuleMockLifecycle(mockApi, {
      getCallerStack: () => "Error\n    at file:///repo/tests/example.test.ts:5:1\n    at moduleEvaluation (native:1:11)",
      getCallerUrl: () => "file:///repo/tests/example.test.ts",
      trackOnlyDuringActiveTest: true,
      isPersistentModuleMockOwner: () => true,
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    // when
    beginTestMockTracking()
    mockApi.module("./dependency", () => ({ named: "mocked" }))
    mockApi.restore()
    endTestMockTracking()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:original",
      "module:resolved:./dependency:original",
    ])
  })

  test("treats module-evaluation mocks from another file as persistent while a different test is active", () => {
    // given
    const events: string[] = []
    let callerStack = "Error\n    at file:///repo/tests/first.test.ts:5:1\n    at test (native:1:11)"
    let callerUrl = "file:///repo/tests/first.test.ts"
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const { beginTestMockTracking, endTestMockTracking } = installModuleMockLifecycle(mockApi, {
      getCallerStack: () => callerStack,
      getCallerUrl: () => callerUrl,
      trackOnlyDuringActiveTest: true,
      isPersistentModuleMockOwner: () => true,
      resolveSpecifier: (specifier, ownerUrl) => `resolved:${ownerUrl}:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    beginTestMockTracking()
    callerStack = "Error\n    at file:///repo/tests/second.test.ts:5:1\n    at moduleEvaluation (native:1:11)"
    callerUrl = "file:///repo/tests/second.test.ts"
    mockApi.module("./dependency", () => ({ named: "top-level second" }))

    // when
    callerStack = "Error\n    at file:///repo/tests/first.test.ts:10:1\n    at cleanup (native:1:11)"
    callerUrl = "file:///repo/tests/first.test.ts"
    mockApi.restore()
    endTestMockTracking()

    // then
    expect(events).toEqual([
      "module:./dependency:top-level second",
      "delegate:restore",
      "module:./dependency:top-level second",
      "module:resolved:file:///repo/tests/second.test.ts:./dependency:top-level second",
    ])
  })

  test("clears persistent module-evaluation snapshots when restore runs while inactive", () => {
    // given
    const events: string[] = []
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const { beginTestMockTracking, endTestMockTracking } = installModuleMockLifecycle(mockApi, {
      getCallerStack: () => "Error\n    at file:///repo/tests/top-level.test.ts:5:1\n    at moduleEvaluation (native:1:11)",
      getCallerUrl: () => "file:///repo/tests/top-level.test.ts",
      trackOnlyDuringActiveTest: true,
      isPersistentModuleMockOwner: () => true,
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    // when
    mockApi.module("./dependency", () => ({ named: "mocked" }))
    mockApi.restore()
    beginTestMockTracking()
    mockApi.restore()
    endTestMockTracking()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
      "delegate:restore",
    ])
  })

  test("does not restore ordinary inactive mocks before their owner test cleanup runs", () => {
    // given
    const events: string[] = []
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const { beginTestMockTracking, endTestMockTracking } = installModuleMockLifecycle(mockApi, {
      getCallerStack: () => "Error\n    at file:///repo/tests/late-loaded.test.ts:5:1\n    at moduleEvaluation (native:1:11)",
      getCallerUrl: () => "file:///repo/tests/late-loaded.test.ts",
      trackOnlyDuringActiveTest: true,
      isPersistentModuleMockOwner: () => true,
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    beginTestMockTracking()
    endTestMockTracking()
    mockApi.module("./dependency", () => ({ named: "mocked" }))

    // when
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
    ])
  })

  test("restores original exports for beforeAll-style inactive mocks after owner test cleanup", () => {
    // given
    const events: string[] = []
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const { beginTestMockTracking, endTestMockTracking } = installModuleMockLifecycle(mockApi, {
      getCallerStack: () => "Error\n    at file:///repo/tests/before-all.test.ts:5:1\n    at beforeAll (native:1:11)",
      getCallerUrl: () => "file:///repo/tests/before-all.test.ts",
      trackOnlyDuringActiveTest: true,
      isPersistentModuleMockOwner: () => true,
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    mockApi.module("./dependency", () => ({ named: "mocked" }))

    // when
    beginTestMockTracking()
    mockApi.restore()
    endTestMockTracking()
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:mocked",
      "module:resolved:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:original",
      "module:resolved:./dependency:original",
    ])
  })

  test("restores original exports for persistent module-evaluation mocks after owner test cleanup", () => {
    // given
    const events: string[] = []
    const loadOriginalModule = mock(() => ({ ok: true as const, value: { named: "original" } }))
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const { beginTestMockTracking, endTestMockTracking } = installModuleMockLifecycle(mockApi, {
      getCallerStack: () => "Error\n    at file:///repo/tests/top-level.test.ts:5:1\n    at moduleEvaluation (native:1:11)",
      getCallerUrl: () => "file:///repo/tests/top-level.test.ts",
      trackOnlyDuringActiveTest: true,
      isPersistentModuleMockOwner: () => true,
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule,
    })

    mockApi.module("./dependency", () => ({ named: "mocked" }))

    // when
    beginTestMockTracking()
    mockApi.restore()
    endTestMockTracking()
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:mocked",
      "module:resolved:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:original",
      "module:resolved:./dependency:original",
    ])
    expect(loadOriginalModule).toHaveBeenCalledTimes(1)
  })

  test("reapplies the last active restore snapshot when a later inactive restore runs", () => {
    // given
    const events: string[] = []
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const { beginTestMockTracking, endTestMockTracking } = installModuleMockLifecycle(mockApi, {
      getCallerStack: () => "Error\n    at file:///repo/tests/example.test.ts:5:1\n    at cleanup (native:1:11)",
      getCallerUrl: () => "file:///repo/tests/example.test.ts",
      trackOnlyDuringActiveTest: true,
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    // when
    beginTestMockTracking()
    mockApi.module("./dependency", () => ({ named: "mocked" }))
    mockApi.restore()
    endTestMockTracking()
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:original",
      "module:resolved:./dependency:original",
      "delegate:restore",
      "module:./dependency:original",
      "module:resolved:./dependency:original",
    ])
  })

  test("keeps unrelated module-evaluation mocks after inactive restore", () => {
    // given
    const events: string[] = []
    let callerStack = "Error\n    at file:///repo/tests/first.test.ts:5:1\n    at moduleEvaluation (native:1:11)"
    let callerUrl = "file:///repo/tests/first.test.ts"
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    installModuleMockLifecycle(mockApi, {
      getCallerStack: () => callerStack,
      getCallerUrl: () => callerUrl,
      trackOnlyDuringActiveTest: true,
      isPersistentModuleMockOwner: () => true,
      resolveSpecifier: (specifier, ownerUrl) => `resolved:${ownerUrl}:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    mockApi.module("./first", () => ({ named: "first top-level" }))
    callerStack = "Error\n    at file:///repo/tests/second.test.ts:5:1\n    at moduleEvaluation (native:1:11)"
    callerUrl = "file:///repo/tests/second.test.ts"
    mockApi.module("./second", () => ({ named: "second top-level" }))

    // when
    callerStack = "Error\n    at file:///repo/tests/first.test.ts:10:1\n    at cleanup (native:1:11)"
    callerUrl = "file:///repo/tests/first.test.ts"
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./first:first top-level",
      "module:./second:second top-level",
      "delegate:restore",
      "module:./second:second top-level",
      "module:resolved:file:///repo/tests/second.test.ts:./second:second top-level",
    ])
  })

  test("keeps module-evaluation mocks when inactive restore cannot resolve the owner", () => {
    // given
    const events: string[] = []
    let callerStack = "Error\n    at file:///repo/tests/top-level.test.ts:5:1\n    at moduleEvaluation (native:1:11)"
    let callerUrl = "file:///repo/tests/top-level.test.ts"
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const { beginTestMockTracking, endTestMockTracking } = installModuleMockLifecycle(mockApi, {
      getCallerStack: () => callerStack,
      getCallerUrl: () => callerUrl,
      trackOnlyDuringActiveTest: true,
      isPersistentModuleMockOwner: () => true,
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    mockApi.module("./dependency", () => ({ named: "mocked" }))

    // when
    callerStack = "Error\n    at nativeAfterAll (native:1:11)"
    callerUrl = "file:///repo/testing/unknown-owner.ts"
    mockApi.restore()
    beginTestMockTracking()
    mockApi.restore()
    endTestMockTracking()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:mocked",
      "module:resolved:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:mocked",
      "module:resolved:./dependency:mocked",
    ])
  })

  test("restores re-applied persistent mocks when inactive restore cannot resolve the owner", () => {
    // given
    const events: string[] = []
    let callerStack = "Error\n    at file:///repo/tests/top-level.test.ts:5:1\n    at moduleEvaluation (native:1:11)"
    let callerUrl = "file:///repo/tests/top-level.test.ts"
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const { beginTestMockTracking, endTestMockTracking } = installModuleMockLifecycle(mockApi, {
      getCallerStack: () => callerStack,
      getCallerUrl: () => callerUrl,
      trackOnlyDuringActiveTest: true,
      isPersistentModuleMockOwner: () => true,
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    mockApi.module("./dependency", () => ({ named: "mocked" }))
    beginTestMockTracking()
    mockApi.restore()
    endTestMockTracking()

    // when
    callerStack = "Error\n    at nativeAfterAll (native:1:11)"
    callerUrl = "file:///repo/testing/unknown-owner.ts"
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:mocked",
      "module:resolved:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:original",
      "module:resolved:./dependency:original",
    ])
  })

  test("does not reapply ordinary module-evaluation mocks after active restore", () => {
    // given
    const events: string[] = []
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const { beginTestMockTracking, endTestMockTracking } = installModuleMockLifecycle(mockApi, {
      getCallerStack: () => "Error\n    at file:///repo/tests/file-local.test.ts:5:1\n    at moduleEvaluation (native:1:11)",
      getCallerUrl: () => "file:///repo/tests/file-local.test.ts",
      trackOnlyDuringActiveTest: true,
      isPersistentModuleMockOwner: () => false,
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    // when
    mockApi.module("./dependency", () => ({ named: "file local" }))
    beginTestMockTracking()
    mockApi.restore()
    endTestMockTracking()

    // then
    expect(events).toEqual([
      "module:./dependency:file local",
      "delegate:restore",
    ])
  })
})
