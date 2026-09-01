/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import { getCallerUrlFromStack, installModuleMockLifecycle, normalizeStackPath } from "./module-mock-lifecycle"

describe("installModuleMockLifecycle", () => {
  test("#given a Windows stack path #when normalizing caller path #then it becomes a file URL rooted at the drive", () => {
    // given
    const stackPath = String.raw`D:\a\oh-my-openagent\oh-my-openagent\src\hooks\example.test.ts`

    // when
    const callerUrl = normalizeStackPath(stackPath)

    // then
    expect(callerUrl).toBe("file:///D:/a/oh-my-openagent/oh-my-openagent/src/hooks/example.test.ts")
  })

  test("#given Windows internal stack frames #when selecting caller url #then test setup and lifecycle frames are ignored", () => {
    // given
    const stack = [
      "Error",
      String.raw`    at mock.restore (D:\a\oh-my-openagent\oh-my-openagent\src\testing\module-mock-lifecycle.ts:287:23)`,
      String.raw`    at afterEach (D:\a\oh-my-openagent\oh-my-openagent\test-setup.ts:72:10)`,
      String.raw`    at module code (D:\a\oh-my-openagent\oh-my-openagent\src\hooks\example.test.ts:12:3)`,
    ].join("\n")

    // when
    const callerUrl = getCallerUrlFromStack(stack, "file:///fallback.ts")

    // then
    expect(callerUrl).toBe("file:///D:/a/oh-my-openagent/oh-my-openagent/src/hooks/example.test.ts")
  })

  test("restores the original module exports on mock.restore", () => {
    // given
    const moduleCalls: Array<{ specifier: string; value: Record<string, unknown> }> = []
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        moduleCalls.push({ specifier, value: factory() })
      },
      restore: mock(() => {}),
    }

    installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => "file:///repo/tests/example.test.ts",
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    // when
    mockApi.module("./dependency", () => ({ named: "mocked" }))
    mockApi.restore()

    // then
    expect(moduleCalls).toEqual([
      { specifier: "./dependency", value: { named: "mocked" } },
      { specifier: "resolved:./dependency", value: { named: "original" } },
    ])
  })

  test("restores original exports after running global delegate restore for owned module mocks", () => {
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

    installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => "file:///repo/tests/example.test.ts",
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    // when
    mockApi.module("./dependency", () => ({ named: "mocked" }))
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
      "module:resolved:./dependency:original",
    ])
  })

  test("#given no active module mocks #when mock.restore runs #then it delegates to Bun restore", () => {
    // given
    const events: string[] = []
    const mockApi = {
      module: (_specifier: string, _factory: () => Record<string, unknown>) => {},
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => "file:///repo/tests/example.test.ts",
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    // when
    mockApi.restore()

    // then
    expect(events).toEqual(["delegate:restore"])
  })

  test("#given unpreserved active module mock #when global test setup cleans up #then original exports are restored", () => {
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

    const lifecycle = installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => "file:///repo/tests/example.test.ts",
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
      shouldPreserveActiveMocksOnRestore: () => true,
    })

    // when
    mockApi.module("./dependency", () => ({ named: "mocked" }))
    mockApi.restore()
    lifecycle.restoreModuleMocks()
    mockApi.restore()
    lifecycle.restoreModuleMocks()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
      "module:resolved:./dependency:original",
      "delegate:restore",
    ])
  })

  test("#given unpreserved active node builtin mock #when global test setup cleans up #then original builtin exports are replayed", () => {
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

    const lifecycle = installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => "file:///repo/tests/example.test.ts",
      resolveSpecifier: () => "node:fs/promises",
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
      shouldPreserveActiveMocksOnRestore: () => true,
    })

    // when
    mockApi.module("node:fs/promises", () => ({ named: "mocked" }))
    mockApi.restore()
    lifecycle.restoreModuleMocks()

    // then
    expect(events).toEqual([
      "module:node:fs/promises:mocked",
      "delegate:restore",
      "module:node:fs/promises:original",
    ])
  })

  test("#given preserved active module mocks from two owners #when global test setup cleans up #then both owner mocks are replayed", () => {
    // given
    const events: string[] = []
    let callerUrl = "file:///repo/tests/first.test.ts"
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const lifecycle = installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => callerUrl,
      resolveSpecifier: (specifier, ownerUrl) => `${ownerUrl}:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
      shouldPreserveActiveMocksOnRestore: () => true,
    })

    mockApi.module("./dependency-a", () => ({ named: "mock-a" }))
    lifecycle.preserveModuleMocksForTestFile(callerUrl)
    callerUrl = "file:///repo/tests/second.test.ts"
    mockApi.module("./dependency-b", () => ({ named: "mock-b" }))
    lifecycle.preserveModuleMocksForTestFile(callerUrl)

    // when
    mockApi.restore()
    lifecycle.restoreModuleMocks()

    // then
    expect(events).toEqual([
      "module:./dependency-a:mock-a",
      "module:./dependency-b:mock-b",
      "delegate:restore",
      "module:./dependency-a:mock-a",
      "module:./dependency-b:mock-b",
    ])
  })

  test("#given preserved active module mock #when global test setup cleans up #then preserved mock stays active", () => {
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

    const lifecycle = installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => "file:///repo/tests/example.test.ts",
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
      shouldPreserveActiveMocksOnRestore: () => true,
    })

    // when
    mockApi.module("./dependency", () => ({ named: "mocked" }))
    lifecycle.preserveModuleMocksForTestFile("file:///repo/tests/example.test.ts")
    mockApi.restore()
    lifecycle.restoreModuleMocks()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:mocked",
    ])
  })

  test("#given two test files register module mocks #when one file restores scoped mocks #then the other mock stays active", () => {
    // given
    const events: string[] = []
    let callerUrl = "file:///repo/tests/first.test.ts"
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {}),
    }

    const lifecycle = installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => callerUrl,
      resolveSpecifier: (specifier, ownerUrl) => `${ownerUrl}:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    mockApi.module("./dependency-a", () => ({ named: "mock-a" }))
    callerUrl = "file:///repo/tests/second.test.ts"
    mockApi.module("./dependency-b", () => ({ named: "mock-b" }))

    // when
    lifecycle.restoreModuleMocksForTestFile("file:///repo/tests/first.test.ts")

    // then
    expect(events).toEqual([
      "module:./dependency-a:mock-a",
      "module:./dependency-b:mock-b",
      "module:file:///repo/tests/first.test.ts:./dependency-a:original",
    ])
  })

  test("#given concurrent test files have module mocks #when one calls mock.restore #then only that file's mocks are removed", () => {
    // given
    const events: string[] = []
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
      getCallerUrl: () => callerUrl,
      resolveSpecifier: (specifier, ownerUrl) => `${ownerUrl}:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    mockApi.module("./dependency-a", () => ({ named: "mock-a" }))
    callerUrl = "file:///repo/tests/second.test.ts"
    mockApi.module("./dependency-b", () => ({ named: "mock-b" }))

    // when
    callerUrl = "file:///repo/tests/first.test.ts"
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./dependency-a:mock-a",
      "module:./dependency-b:mock-b",
      "delegate:restore",
      "module:file:///repo/tests/first.test.ts:./dependency-a:original",
      "module:./dependency-b:mock-b",
    ])
  })

  test("#given two owners mock the same module #when the newer owner restores #then the previous owner mock is replayed", () => {
    // given
    const events: string[] = []
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
      getCallerUrl: () => callerUrl,
      resolveSpecifier: () => "resolved:./shared-dependency",
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    mockApi.module("./dependency", () => ({ named: "first-mock" }))
    callerUrl = "file:///repo/tests/second.test.ts"
    mockApi.module("./dependency", () => ({ named: "second-mock" }))

    // when
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./dependency:first-mock",
      "module:./dependency:second-mock",
      "delegate:restore",
      "module:./dependency:first-mock",
      "module:./dependency:first-mock",
    ])
  })

  test("#given restore caller has no owned module mocks #when mock.restore runs #then unpreserved module mocks from other owners are restored", () => {
    // given
    const events: string[] = []
    let callerUrl = "file:///repo/tests/owner.test.ts"
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => callerUrl,
      resolveSpecifier: (specifier, ownerUrl) => `${ownerUrl}:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    mockApi.module("./dependency-a", () => ({ named: "mock-a" }))
    callerUrl = "file:///repo/tests/untracked-cleanup.test.ts"

    // when
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./dependency-a:mock-a",
      "delegate:restore",
      "module:file:///repo/tests/owner.test.ts:./dependency-a:original",
    ])
  })

  test("#given restore caller has no owned module mocks #when mock.restore runs #then preserved module mocks from other owners are replayed", () => {
    // given
    const events: string[] = []
    let callerUrl = "file:///repo/tests/owner.test.ts"
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const lifecycle = installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => callerUrl,
      resolveSpecifier: (specifier, ownerUrl) => `${ownerUrl}:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    mockApi.module("./dependency-a", () => ({ named: "mock-a" }))
    lifecycle.preserveModuleMocksForTestFile(callerUrl)
    callerUrl = "file:///repo/tests/untracked-cleanup.test.ts"

    // when
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./dependency-a:mock-a",
      "delegate:restore",
      "module:./dependency-a:mock-a",
    ])
  })

  test("#given owner is preserved #when owner calls mock.restore #then the owner mock is cleared", () => {
    // given
    const events: string[] = []
    let callerUrl = "file:///repo/tests/owner.test.ts"
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        events.push(`module:${specifier}:${String(factory().named)}`)
      },
      restore: mock(() => {
        events.push("delegate:restore")
      }),
    }

    const lifecycle = installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => callerUrl,
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    mockApi.module("./dependency-a", () => ({ named: "mock-a" }))
    lifecycle.preserveModuleMocksForTestFile(callerUrl)

    // when
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./dependency-a:mock-a",
      "delegate:restore",
      "module:resolved:./dependency-a:original",
    ])
  })

  test("#given restore caller owns one of multiple active module mocks #when mock.restore runs #then only caller mocks are removed", () => {
    // given
    const events: string[] = []
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
      getCallerUrl: () => callerUrl,
      resolveSpecifier: (specifier, ownerUrl) => `${ownerUrl}:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    mockApi.module("./dependency-a", () => ({ named: "mock-a" }))
    callerUrl = "file:///repo/tests/second.test.ts"
    mockApi.module("./dependency-b", () => ({ named: "mock-b" }))

    // when
    callerUrl = "file:///repo/tests/first.test.ts"
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./dependency-a:mock-a",
      "module:./dependency-b:mock-b",
      "delegate:restore",
      "module:file:///repo/tests/first.test.ts:./dependency-a:original",
      "module:./dependency-b:mock-b",
    ])
  })

  test("captures the original module only once per resolved specifier", () => {
    // given
    let loadCount = 0
    const mockApi = {
      module: mock((_specifier: string, _factory: () => Record<string, unknown>) => {}),
      restore: mock(() => {}),
    }

    installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => "file:///repo/tests/example.test.ts",
      resolveSpecifier: () => "file:///repo/src/dependency.ts",
      loadOriginalModule: () => {
        loadCount += 1
        return { ok: true, value: { named: "original" } }
      },
    })

    // when
    mockApi.module("./dependency", () => ({ named: "first" }))
    mockApi.module("./dependency", () => ({ named: "second" }))

    // then
    expect(loadCount).toBe(1)
  })

  test("does not restore unresolved modules to avoid cleanup errors", () => {
    // given
    const moduleCalls: Array<{ specifier: string; value: Record<string, unknown> }> = []
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        moduleCalls.push({ specifier, value: factory() })
      },
      restore: mock(() => {}),
    }

    installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => "file:///repo/tests/example.test.ts",
      resolveSpecifier: (specifier) => specifier,
      loadOriginalModule: () => ({ ok: false, error: new Error("Cannot find module") }),
    })

    // when
    mockApi.module("virtual:missing", () => ({ named: "mocked" }))
    mockApi.restore()

    // then - only the original mock call, no restore call for unresolved module
    expect(moduleCalls).toEqual([{ specifier: "virtual:missing", value: { named: "mocked" } }])
  })

  test("#given preserved unresolved module mock #when scoped restore runs #then Bun restore clears the active mock", () => {
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

    const lifecycle = installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => "file:///repo/tests/preserved.test.ts",
      resolveSpecifier: (specifier) => specifier,
      loadOriginalModule: () => ({ ok: false, error: new Error("Cannot find module") }),
    })

    // when
    mockApi.module("virtual:missing", () => ({ named: "mocked" }))
    lifecycle.preserveModuleMocksForTestFile("file:///repo/tests/preserved.test.ts")
    lifecycle.restoreModuleMocksForTestFile("file:///repo/tests/preserved.test.ts")

    // then
    expect(events).toEqual([
      "module:virtual:missing:mocked",
      "delegate:restore",
    ])
  })
})
