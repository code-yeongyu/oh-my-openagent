declare module "bun:test" {
  interface MockMetadata<TArgs extends unknown[]> {
    calls: TArgs[]
  }

  interface MockFunction<TArgs extends unknown[] = unknown[], TReturn = unknown> {
    (...args: TArgs): TReturn
    mock: MockMetadata<TArgs>
    mockReset(): void
    mockReturnValue(value: TReturn): void
    mockResolvedValue(value: Awaited<TReturn>): void
  }

  export function describe(name: string, fn: () => void): void
  export function it(name: string, fn: () => void | Promise<void>): void
  export function beforeEach(fn: () => void | Promise<void>): void
  export function afterEach(fn: () => void | Promise<void>): void
  export function beforeAll(fn: () => void | Promise<void>): void
  export function afterAll(fn: () => void | Promise<void>): void
  export function mock<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn,
  ): MockFunction<TArgs, TReturn>

  export namespace mock {
    function module(modulePath: string, factory: () => Record<string, unknown>): void
    function restore(): void
  }

  interface Matchers {
    toBe(expected: unknown): void
    toBeNull(): void
    toEqual(expected: unknown): void
    toContain(expected: unknown): void
    toMatch(expected: RegExp | string): void
    toHaveLength(expected: number): void
    toHaveBeenCalled(): void
    toHaveBeenCalledTimes(expected: number): void
    toHaveBeenCalledWith(...expected: unknown[]): void
    toBeGreaterThan(expected: number): void
    toThrow(expected?: RegExp | string): void
    toStartWith(expected: string): void
    not: Matchers
  }

  export function expect(received: unknown): Matchers
}
