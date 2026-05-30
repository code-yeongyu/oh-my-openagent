/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import { installModuleMockLifecycle } from "./module-mock-lifecycle"

describe("installModuleMockLifecycle", () => {
  test("restores every mock specifier while cloning ESM namespace snapshots", () => {
    // given
    const originalExports = { named: "original" }
    const moduleNamespaceExports = Object.defineProperty({ named: "namespace" }, Symbol.toStringTag, {
      value: "Module",
    })
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
      loadOriginalModule: (specifier) => ({
        ok: true,
        value: specifier === "./namespace" ? moduleNamespaceExports : originalExports,
      }),
    })

    // when
    mockApi.module("./dependency", () => ({ named: "mocked" }))
    mockApi.module("./namespace", () => ({ named: "mocked namespace" }))
    mockApi.restore()

    // then
    const plainRestoreCall = moduleCalls.find((call) => call.specifier === "./dependency" && call.value.named === "original")
    const namespaceOriginalRestoreCall = moduleCalls.find(
      (call) => call.specifier === "./namespace" && call.value.named === "namespace",
    )
    const namespaceResolvedRestoreCall = moduleCalls.find(
      (call) => call.specifier === "resolved:./namespace" && call.value.named === "namespace",
    )
    expect(plainRestoreCall?.value).toBe(originalExports)
    expect(namespaceOriginalRestoreCall?.value).toEqual({ named: "namespace" })
    expect(namespaceOriginalRestoreCall?.value).not.toBe(moduleNamespaceExports)
    expect(namespaceResolvedRestoreCall?.value).toEqual({ named: "namespace" })
    expect(namespaceResolvedRestoreCall?.value).not.toBe(moduleNamespaceExports)
  })

  test("clears tracked snapshots after the delegate restore runs", () => {
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

    const { restoreModuleMocks } = installModuleMockLifecycle(mockApi, {
      getCallerUrl: () => "file:///repo/tests/example.test.ts",
      resolveSpecifier: (specifier) => `resolved:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    // when
    mockApi.module("./dependency", () => ({ named: "mocked" }))
    mockApi.restore()
    restoreModuleMocks()

    // then
    expect(events).toEqual([
      "module:./dependency:mocked",
      "delegate:restore",
      "module:./dependency:original",
      "module:resolved:./dependency:original",
    ])
  })

  test("reapplies the last restore snapshot when mock.restore is called twice", () => {
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

  test("restores each original mock specifier while sharing one resolved snapshot", () => {
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
      resolveSpecifier: () => "file:///repo/src/dependency.ts",
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    // when
    mockApi.module("../src/dependency", () => ({ named: "first mock" }))
    mockApi.module("./dependency", () => ({ named: "second mock" }))
    mockApi.restore()

    // then
    expect(moduleCalls).toEqual([
      { specifier: "../src/dependency", value: { named: "first mock" } },
      { specifier: "./dependency", value: { named: "second mock" } },
      { specifier: "../src/dependency", value: { named: "original" } },
      { specifier: "file:///repo/src/dependency.ts", value: { named: "original" } },
      { specifier: "./dependency", value: { named: "original" } },
    ])
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

    // then
    expect(moduleCalls).toEqual([{ specifier: "virtual:missing", value: { named: "mocked" } }])
  })
})
