/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import { installModuleMockLifecycle } from "./module-mock-lifecycle"

describe("installModuleMockLifecycle", () => {
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

  test("captures the original module only once per resolved specifier", () => {
    // given
    let loadCount = 0
    const mockApi = {
      module: mock(() => {}),
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
