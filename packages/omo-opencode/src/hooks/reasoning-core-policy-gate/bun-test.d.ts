declare module "bun:test" {
  interface MockMetadata<TArgs extends unknown[]> {
    calls: TArgs[]
  }

  interface MockFunction<TArgs extends unknown[] = unknown[], TReturn = unknown> {
    (...args: TArgs): TReturn
    mock: MockMetadata<TArgs>
    mockClear(): void
    mockReset(): MockFunction<TArgs, TReturn>
    mockReturnValue(value: TReturn): MockFunction<TArgs, TReturn>
    mockResolvedValue(value: Awaited<TReturn>): MockFunction<TArgs, TReturn>
  }

  export function describe(name: string, fn: () => void): void
  export function expect(received: unknown): {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toMatchObject(expected: unknown): void
    toBeUndefined(): void
    toHaveBeenCalledTimes(expected: number): void
    not: {
      toHaveBeenCalled(): void
    }
  }
  export namespace expect {
    function arrayContaining(expected: unknown[]): unknown
  }
  export function it(name: string, fn: () => void | Promise<void>): void
  export function mock<TArgs extends unknown[], TReturn>(fn: (...args: TArgs) => TReturn): MockFunction<TArgs, TReturn>
}
