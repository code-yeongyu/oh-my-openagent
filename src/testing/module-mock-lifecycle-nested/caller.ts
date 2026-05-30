type MockModuleApi = {
  module: (specifier: string, factory: () => Record<string, unknown>) => unknown
}

export function mockNestedFixture(mockApi: MockModuleApi): void {
  mockApi.module("./fixture", () => ({ named: "mocked" }))
}
