import { describe, expect, test } from "bun:test"

import { findings } from "./ratchet-findings.ts"

const moduleMockCode = "omo-testing(no-module-mock)"

describe("no-module-mock through the ratchet lint configuration", () => {
  const replaced: readonly (readonly [string, string, number])[] = [
    ["a direct bun mock.module", 'import { mock } from "bun:test"; mock.module("./a", () => ({}));', 1],
    ["an aliased bun mock", 'import { mock as mockFn } from "bun:test"; mockFn.module("./a", () => ({}));', 1],
    ["a bun:test namespace import", 'import * as bunTest from "bun:test"; bunTest.mock.module("./a", () => ({}));', 1],
    [
      "a bun mock destructured from require",
      'const { mock } = require("bun:test"); mock.module("./a", () => ({}));',
      1,
    ],
    [
      "a required bun:test namespace",
      'const bunTest = require("bun:test"); bunTest.mock.module("./a", () => ({}));',
      1,
    ],
    [
      "a cast alias of bun mock",
      'import { mock } from "bun:test"; const mockModule = mock as typeof mock & {}; mockModule.module("./a", () => ({}));',
      1,
    ],
    ["a mock.module above its import", 'mock.module("./a", () => ({})); import { mock } from "bun:test";', 1],
    [
      "a bun mock from an inline createRequire",
      'const { mock } = createRequire(import.meta.url)("bun:test"); mock.module("./a", () => ({}));',
      1,
    ],
    ["a mock read off require", 'require("bun:test").mock.module("./a", () => ({}));', 1],
    [
      "a namespace from an inline createRequire",
      'createRequire(import.meta.url)("bun:test").mock.module("./a", () => ({}));',
      1,
    ],
    ["bun's vi.mock alias", 'import { vi } from "bun:test"; vi.mock("./a", () => ({}));', 1],
    ["vitest vi.mock and vi.doMock", 'import { vi } from "vitest"; vi.mock("./a"); vi.doMock("./b");', 2],
    ["a global vi.mock", 'vi.mock("./a", () => ({}));', 1],
    [
      "jest.mock and unstable_mockModule",
      'import { jest } from "@jest/globals"; jest.mock("./a"); jest.unstable_mockModule("./b", () => ({}));',
      2,
    ],
  ]

  for (const [name, source, count] of replaced) {
    test(`reports ${name}`, () => {
      const found = findings(source, moduleMockCode)
      expect(found.length).toBe(count)
      expect(found[0]?.message).toMatch(/Inject the dependency instead/)
    })
  }

  const allowed: readonly (readonly [string, string])[] = [
    [
      "bun mock functions, spies and restore",
      'import { mock, spyOn } from "bun:test"; mock(() => 1); spyOn(api, "get"); mock.restore();',
    ],
    ["bun vi.fn and vi.spyOn", 'import { vi } from "bun:test"; vi.fn(); vi.spyOn(api, "get");'],
    ["vitest vi.fn and vi.spyOn", 'import { vi } from "vitest"; vi.fn(); vi.spyOn(api, "get");'],
    ["an observing vi.mock with spy: true", 'import { vi } from "vitest"; vi.mock("./a", { spy: true });'],
    ["a local object named mock", 'const mock = { module: () => 1 }; mock.module("./a");'],
    ["an unrelated .module call", 'registry.module("./a", () => ({}));'],
    ["a vi imported from a non-test module", 'import { vi } from "./fake-vi"; vi.mock("./a");'],
    ["a type-only bun:test import", 'import type { mock } from "bun:test"; declare const m: typeof mock;'],
  ]

  for (const [name, source] of allowed) {
    test(`allows ${name}`, () => {
      expect(findings(source, moduleMockCode)).toEqual([])
    })
  }
})
