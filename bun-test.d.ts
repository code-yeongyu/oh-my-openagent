declare module "bun:test" {
  type AnyFunction = (...args: any[]) => any

  interface MockMetadata<TArgs extends unknown[]> {
    calls: TArgs[]
  }

  interface MockFunction<TFunction extends AnyFunction = AnyFunction> {
    (...args: Parameters<TFunction>): ReturnType<TFunction>
    mock: MockMetadata<Parameters<TFunction>>
    mockClear(): void
    mockReset(): void
    mockRestore(): void
    mockReturnValue(value: ReturnType<TFunction>): void
    mockResolvedValue(value: Awaited<ReturnType<TFunction>>): void
    mockImplementation(fn: TFunction): MockFunction<TFunction>
  }

  export function describe(name: string, fn: () => void): void
  export function test(name: string, fn: () => void | Promise<void>): void
  export function it(name: string, fn: () => void | Promise<void>): void
  export function beforeEach(fn: () => void | Promise<void>): void
  export function afterEach(fn: () => void | Promise<void>): void
  export function beforeAll(fn: () => void | Promise<void>): void
  export function afterAll(fn: () => void | Promise<void>): void
  export function mock<TFunction extends AnyFunction>(fn: TFunction): MockFunction<TFunction>

  export function spyOn<TObject extends object>(
    object: TObject,
    key: keyof TObject,
  ): MockFunction<AnyFunction>

  export namespace mock {
    function module(modulePath: string, factory: () => Record<string, unknown>): void
    function restore(): void
  }

  interface Matchers {
    toBe(expected: unknown): void
    toBeDefined(): void
    toBeUndefined(): void
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
