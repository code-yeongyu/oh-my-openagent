/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import { installModuleMockLifecycle } from "./module-mock-lifecycle"
import { mockNestedFixture } from "./module-mock-lifecycle-nested/caller"

describe("installModuleMockLifecycle Bun integration", () => {
  test("restores in-test ESM mock bindings during cleanup", async () => {
    // given
    mock.module("./module-mock-lifecycle-fixture", () => ({ named: "mocked-aftereach" }))
    const mockedModule = await import("./module-mock-lifecycle-fixture")

    // when
    mock.restore()

    // then
    expect(mockedModule.named).toBe("original")
  })

  test("keeps restored module mocks restored after test setup cleanup", async () => {
    // when
    const restoredModule = await import(`./module-mock-lifecycle-fixture?aftereach=${Date.now()}`)

    // then
    expect(restoredModule.named).toBe("original")
  })

  test("uses Bun resolution so extensionless TypeScript imports capture the loaded module", () => {
    // given
    const moduleCalls: Array<{ specifier: string; value: Record<string, unknown> }> = []
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        moduleCalls.push({ specifier, value: factory() })
      },
      restore: mock(() => {}),
    }

    installModuleMockLifecycle(mockApi)

    // when
    mockApi.module("./module-mock-lifecycle-fixture", () => ({ named: "mocked" }))
    mockApi.restore()

    // then
    const restoreCall = moduleCalls.find((call) => /\/src\/testing\/module-mock-lifecycle-fixture\.ts$/.test(call.specifier))
    expect(restoreCall?.specifier).toMatch(/\/src\/testing\/module-mock-lifecycle-fixture\.ts$/)
    expect(restoreCall?.value.named).toBe("original")
  })

  test("resolves relative mocks from the helper caller instead of the lifecycle module", () => {
    // given
    const moduleCalls: Array<{ specifier: string; value: Record<string, unknown> }> = []
    const mockApi = {
      module: (specifier: string, factory: () => Record<string, unknown>) => {
        moduleCalls.push({ specifier, value: factory() })
      },
      restore: mock(() => {}),
    }

    installModuleMockLifecycle(mockApi)

    // when
    mockNestedFixture(mockApi)
    mockApi.restore()

    // then
    const restoreCall = moduleCalls.find((call) => /\/src\/testing\/module-mock-lifecycle-nested\/fixture\.ts$/.test(call.specifier))
    expect(restoreCall?.specifier).toMatch(/\/src\/testing\/module-mock-lifecycle-nested\/fixture\.ts$/)
    expect(restoreCall?.value.named).toBe("original")
  })

  test("restores Bun module mocks for later cache-busted imports", async () => {
    // given
    mock.module("./module-mock-lifecycle-fixture", () => ({ named: "mocked" }))
    const mockedModule = await import("./module-mock-lifecycle-fixture")

    // when
    mock.restore()
    const restoredModule = await import(`./module-mock-lifecycle-fixture?restored=${Date.now()}`)

    // then
    expect(mockedModule.named).toBe("original")
    expect(restoredModule.named).toBe("original")
  })

  test("keeps Bun module mocks restored when cleanup calls mock.restore twice", async () => {
    // given
    mock.module("./module-mock-lifecycle-fixture", () => ({ named: "mocked" }))
    const mockedModule = await import("./module-mock-lifecycle-fixture")

    // when
    mock.restore()
    mock.restore()
    const restoredModule = await import(`./module-mock-lifecycle-fixture?double-restore=${Date.now()}`)

    // then
    expect(mockedModule.named).toBe("original")
    expect(restoredModule.named).toBe("original")
  })

  test("allows a later relative mock after restoring a resolved original", async () => {
    // given
    mock.module("./module-mock-lifecycle-fixture", () => ({ named: "first mock" }))
    const firstMockedModule = await import("./module-mock-lifecycle-fixture")

    // when
    mock.restore()
    mock.module("./module-mock-lifecycle-fixture", () => ({ named: "second mock" }))
    const secondMockedModule = await import("./module-mock-lifecycle-fixture")

    // then
    expect(firstMockedModule.named).toBe("second mock")
    expect(secondMockedModule.named).toBe("second mock")
  })

  test("allows a later caller-relative mock after restoring a file-url original", async () => {
    // given
    mock.module("./module-mock-lifecycle-nested/fixture", () => ({ named: "first mock" }))
    const firstMockedModule = await import("./module-mock-lifecycle-nested/fixture")

    // when
    mock.restore()
    mockNestedFixture(mock)
    const secondMockedModule = await import("./module-mock-lifecycle-nested/fixture")

    // then
    expect(firstMockedModule.named).toBe("mocked")
    expect(secondMockedModule.named).toBe("mocked")
  })

  test("restores Bun module mocks outside the lifecycle helper directory", async () => {
    // given
    mock.module("../cli/run/json-output", () => ({
      createJsonOutputManager: () => ({ mocked: true }),
    }))
    const mockedModule = await import("../cli/run/json-output")

    // when
    mock.restore()
    const restoredModule = await import(`../cli/run/json-output?restored=${Date.now()}`)

    // then
    expect("mocked" in mockedModule.createJsonOutputManager()).toBe(false)
    expect("mocked" in restoredModule.createJsonOutputManager()).toBe(false)
    expect(typeof restoredModule.createJsonOutputManager().redirectToStderr).toBe("function")
  })

  test("restores dependency mocks after a cache-busted consumer import", async () => {
    // given
    mock.module("./module-mock-lifecycle-fixture", () => ({ named: "mocked" }))
    const consumerModule = await import(`./module-mock-lifecycle-consumer?mocked=${Date.now()}`)

    // when
    mock.restore()
    const restoredModule = await import(`./module-mock-lifecycle-fixture?restored-dep=${Date.now()}`)

    // then
    expect(consumerModule.consumed).toBe("original")
    expect(restoredModule.named).toBe("original")
  })
})
