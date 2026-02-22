declare module "bun:test" {
  export function describe(name: string, fn: () => void): void
  export function it(name: string, fn: () => void | Promise<void>): void
  export function beforeEach(fn: () => void | Promise<void>): void
  export function afterEach(fn: () => void | Promise<void>): void
  export function beforeAll(fn: () => void | Promise<void>): void
  export function afterAll(fn: () => void | Promise<void>): void
  export function mock<T extends (...args: never[]) => unknown>(fn: T): T

  interface Matchers {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toContain(expected: unknown): void
    toMatch(expected: RegExp | string): void
    toHaveLength(expected: number): void
    toBeGreaterThan(expected: number): void
    toThrow(expected?: RegExp | string): void
    toStartWith(expected: string): void
    not: Matchers
  }

  export function expect(received: unknown): Matchers
}
