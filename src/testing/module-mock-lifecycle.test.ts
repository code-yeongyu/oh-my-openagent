/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import { installModuleMockLifecycle, normalizeStackPath } from "./module-mock-lifecycle"

describe("installModuleMockLifecycle", () => {
  test("#given a Windows stack path #when normalizing caller path #then it becomes a file URL rooted at the drive", () => {
    // given
    const stackPath = String.raw`D:\a\oh-my-openagent\oh-my-openagent\src\hooks\example.test.ts`

    // when
    const callerUrl = normalizeStackPath(stackPath)

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

  test("restores original exports after the delegate restore runs", () => {
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

  test("preserves active module mocks during global test setup cleanup", () => {
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

  test("#given restore caller has no owned module mocks #when mock.restore runs #then only preserved active module mocks are replayed", () => {
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
    lifecycle.preserveModuleMocksForTestFile("file:///repo/tests/owner.test.ts")
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

  test("#given restore caller has no owned module mocks #when active module mocks are not preserved #then mock.restore performs full cleanup", () => {
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
})
