declare module "bun:test" {
  export interface Expectation {
    not: Expectation
    rejects: {
      toThrow(message?: string | RegExp): Promise<void>
    }

    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toContain(expected: string): void
    toMatch(expected: RegExp): void
    toBeInstanceOf(expected: unknown): void
    toBeDefined(): void
    toBeUndefined(): void
    toBeGreaterThan(expected: number): void
    toBeGreaterThanOrEqual(expected: number): void
    toBeLessThan(expected: number): void
    toBeLessThanOrEqual(expected: number): void
  }

  export function expect(value: unknown): Expectation

  export function describe(name: string, fn: () => void): void
  export function it(name: string, fn: () => void | Promise<void>): void
  export function test(name: string, fn: () => void | Promise<void>): void
  export function beforeEach(fn: () => void | Promise<void>): void
  export function afterEach(fn: () => void | Promise<void>): void

  export interface Spy {
    mockResolvedValue(value: unknown): Spy
    mockReturnValue(value: unknown): Spy
    mockImplementation(fn: (...args: unknown[]) => unknown): Spy
  }

  export function spyOn<TObject extends object, TKey extends keyof TObject>(
    object: TObject,
    key: TKey
  ): Spy

  export const mock: {
    module: (moduleName: string, factory: () => Record<string, unknown>) => void
  }
}
