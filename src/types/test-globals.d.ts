declare global {
  const describe: (name: string, fn: () => void) => void
  const test: (name: string, fn: () => void | Promise<void>) => void
  const beforeEach: (fn: () => void | Promise<void>) => void
  const afterEach: (fn: () => void | Promise<void>) => void
  const expect: (value: unknown) => {
    toBe: (expected: unknown) => void
    toContain: (expected: unknown) => void
    not: {
      toBe: (expected: unknown) => void
      toContain: (expected: unknown) => void
    }
  }
  const spyOn: <T extends object, K extends keyof T>(
    target: T,
    key: K
  ) => {
    mockReturnValue: (value: T[K]) => void
    mockImplementation: (impl: T[K]) => void
    mockRestore: () => void
  }
}

export {}
