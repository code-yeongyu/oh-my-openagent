/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import { installModuleMockLifecycle } from "./module-mock-lifecycle"

describe("installModuleMockLifecycle inactive restore ownership", () => {
  test("keeps unrelated re-applied persistent mocks when inactive restore caller is unresolved", () => {
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

    const { beginTestMockTracking, endTestMockTracking } = installModuleMockLifecycle(mockApi, {
      getCallerStack: () => `Error\n    at ${callerUrl}:5:1`,
      getCallerUrl: () => callerUrl,
      trackOnlyDuringActiveTest: true,
      isPersistentModuleMockOwner: () => true,
      resolveSpecifier: (specifier, ownerUrl) => `resolved:${ownerUrl}:${specifier}`,
      loadOriginalModule: () => ({ ok: true, value: { named: "original" } }),
    })

    mockApi.module("./first", () => ({ named: "first mock" }))
    callerUrl = "file:///repo/tests/second.test.ts"
    mockApi.module("./second", () => ({ named: "second mock" }))
    callerUrl = "file:///repo/tests/first.test.ts"
    beginTestMockTracking()
    mockApi.restore()
    endTestMockTracking()

    // when
    callerUrl = "file:///repo/testing/unknown-owner.ts"
    mockApi.restore()

    // then
    expect(events).toEqual([
      "module:./first:first mock",
      "module:./second:second mock",
      "delegate:restore",
      "module:./first:first mock",
      "module:resolved:file:///repo/tests/first.test.ts:./first:first mock",
      "module:./second:second mock",
      "module:resolved:file:///repo/tests/second.test.ts:./second:second mock",
      "delegate:restore",
      "module:./first:original",
      "module:resolved:file:///repo/tests/first.test.ts:./first:original",
      "module:./second:second mock",
      "module:resolved:file:///repo/tests/second.test.ts:./second:second mock",
    ])
  })
})
