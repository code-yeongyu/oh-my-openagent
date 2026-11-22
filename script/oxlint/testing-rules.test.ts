import { describe, expect, test } from "bun:test"

import { findings } from "./ratchet-findings.ts"

const sleepCode = "omo-testing(no-fixed-sleep)"
const flakeCode = "omo-testing(no-flake-masking)"

describe("no-fixed-sleep through the ratchet lint configuration", () => {
  const sleeps: readonly (readonly [string, string])[] = [
    [
      "setTimeout promise with a block body",
      "test('x', async () => { await new Promise((resolve) => { setTimeout(resolve, 250); }); });",
    ],
    [
      "setTimeout promise with an expression body",
      "test('x', async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });",
    ],
    [
      "globalThis.setTimeout",
      "test('x', async () => { await new Promise<void>((done) => globalThis.setTimeout(() => done(), 31_000)); });",
    ],
    [
      "timers/promises import aliased to sleep",
      'import { setTimeout as sleep } from "node:timers/promises"; test("x", async () => { await sleep(500); });',
    ],
    [
      "bare timers/promises import",
      'import { setTimeout } from "timers/promises"; afterEach(async () => { await setTimeout(20); });',
    ],
    ["scheduler.wait in a hook", "beforeEach(async () => { await scheduler.wait(10); });"],
    ["Bun.sleep", "test('x', async () => { await Bun.sleep(100); });"],
    ["test.each modifier", "test.each([1])('x %s', async () => { await scheduler.wait(1); });"],
    ["test.concurrent modifier", "test.concurrent('x', async () => { await scheduler.wait(1); });"],
    [
      "it.skipIf modifier with a function expression",
      "it.skipIf(ci)('x', async function () { await scheduler.wait(1); });",
    ],
  ]

  for (const [name, source] of sleeps) {
    test(`reports ${name}`, () => {
      const found = findings(source, sleepCode)
      expect(found.length).toBe(1)
      expect(found[0]?.message).toMatch(/Replace this fixed sleep with a signal/)
    })
  }

  const signals: readonly (readonly [string, string])[] = [
    ["awaiting the operation itself", "test('x', async () => { await operation(); });"],
    ["a withResolvers promise", "test('x', async () => { const r = Promise.withResolvers(); await r.promise; });"],
    [
      "a sleep after fake timers",
      "test('x', async () => { vi.useFakeTimers(); await new Promise((resolve) => { setTimeout(resolve, 250); }); });",
    ],
    ["a sleep outside any test body", "serve(async () => { await scheduler.wait(10); return new Response(); });"],
    [
      "a sleep inside a helper the test awaits",
      "async function backoff(attempt) { await scheduler.wait(2 ** attempt); } test('x', async () => { await backoff(1); });",
    ],
    [
      "a timeout raced against real work",
      "test('x', async () => { await Promise.race([work, new Promise((resolve) => { setTimeout(() => resolve('pending'), 0); })]); });",
    ],
    [
      "a promise with a second scheduled statement",
      "test('x', async () => { await new Promise((resolve) => { setTimeout(resolve, 10); queueMicrotask(resolve); }); });",
    ],
    [
      "a cancelled timer without an await",
      "test('x', async () => { const timer = setTimeout(cancel, 10); await work(); clearTimeout(timer); });",
    ],
  ]

  for (const [name, source] of signals) {
    test(`allows ${name}`, () => {
      expect(findings(source, sleepCode)).toEqual([])
    })
  }
})

describe("no-flake-masking through the ratchet lint configuration", () => {
  const flagged: readonly (readonly [string, string, RegExp])[] = [
    ["a test retry option", 'test("loads", { retry: 2 }, async () => {});', /Do not retry tests/],
    ["an it retry option", 'it("loads", { retry: 2 }, async () => {});', /Do not retry tests/],
    ["a describe retry option", 'describe("loader", { retry: 3 }, () => {});', /Do not retry tests/],
    ["a test.concurrent retry option", 'test.concurrent("loads", { retry: 1 }, async () => {});', /Do not retry tests/],
    ["a test.each retry option", 'test.each([1, 2])("loads %i", { retry: 1 }, async () => {});', /Do not retry tests/],
    ["a retry option in the third argument", 'test("loads", async () => {}, { retry: 2 });', /Do not retry tests/],
    ["a vi.setConfig retry", "vi.setConfig({ retry: 2 });", /Do not retry tests/],
    ["a defineConfig test retry", "export default defineConfig({ test: { retry: 2 } });", /Do not retry tests/],
    [
      "a nested projects retry",
      "export default defineConfig({ test: { projects: [{ test: { name: 'node', retry: 1 } }] } });",
      /Do not retry tests/,
    ],
    ["a positional timeout literal", 'test("loads", async () => {}, 60_000);', /Do not raise a test's timeout/],
    ["a positional timeout expression", 'test("loads", async () => {}, 2 * 60_000);', /Do not raise a test's timeout/],
    [
      "a positional timeout identifier",
      'test("loads", async () => {}, LONG_TIMEOUT);',
      /Do not raise a test's timeout/,
    ],
    [
      "a timeout option in the second argument",
      'test("loads", { timeout: 60_000 }, async () => {});',
      /Do not raise a test's timeout/,
    ],
    [
      "a timeout option in the third argument",
      'test("loads", async () => {}, { timeout: 60_000 });',
      /Do not raise a test's timeout/,
    ],
    [
      "a describe timeout option",
      'describe("loader", { timeout: 60_000 }, () => {});',
      /Do not raise a test's timeout/,
    ],
    ["a vi.setConfig testTimeout", "vi.setConfig({ testTimeout: 45_000 });", /Do not raise a test's timeout/],
    ["a vi.setConfig hookTimeout", "vi.setConfig({ hookTimeout: 45_000 });", /Do not raise a test's timeout/],
  ]

  for (const [name, source, message] of flagged) {
    test(`reports ${name}`, () => {
      const found = findings(source, flakeCode)
      expect(found.length).toBe(1)
      expect(found[0]?.message).toMatch(message)
    })
  }

  const allowed: readonly (readonly [string, string])[] = [
    ["a plain test", 'test("loads", async () => {});'],
    ["an unrelated option", 'test("loads", { tags: ["slow"] }, async () => {});'],
    ["a concurrent option", 'test("loads", { concurrent: true }, function load() {});'],
    ["a beforeAll timeout", "beforeAll(async () => { await server.listen(); }, 60_000);"],
    ["an afterAll timeout", "afterAll(() => server.close(), 30_000);"],
    ["an expect.poll timeout", "await expect.poll(() => count(), { timeout: 5_000 }).toBe(1);"],
    ["a vi.waitFor timeout", "await vi.waitFor(() => expect(count()).toBe(1), { timeout: 5_000 });"],
    ["a non-test retry option", "const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });"],
    ["a queue retry call", "queue.retry({ delaySeconds: 30 });"],
    ["a policy retry object", "const policy = { retry: { maxAttempts: 1 } };"],
    [
      "a defineConfig default timeout",
      "export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 60_000 } });",
    ],
    ["a vi.setConfig fakeTimers", "vi.setConfig({ fakeTimers: { now: 0 } });"],
  ]

  for (const [name, source] of allowed) {
    test(`allows ${name}`, () => {
      expect(findings(source, flakeCode)).toEqual([])
    })
  }
})
