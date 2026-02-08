import { createWebsearchConfig } from "./websearch"

declare const describe: (name: string, callback: () => void) => void
declare const test: (name: string, callback: () => void) => void
declare const expect: (value: unknown) => {
  toContain: (expected: string) => void
  toBeUndefined: () => void
}
declare const process: { env: Record<string, string | undefined> }

describe("createWebsearchConfig (Exa)", () => {
  test("appends exaApiKey query param when EXA_API_KEY is set", () => {
    //#given
    const apiKey = "test-exa-key-12345"
    const originalExaApiKey = process.env.EXA_API_KEY
    process.env.EXA_API_KEY = apiKey

    //#when
    const result = createWebsearchConfig()

    //#then
    expect(result.url).toContain(`exaApiKey=${encodeURIComponent(apiKey)}`)

    process.env.EXA_API_KEY = originalExaApiKey
  })

  test("does not set x-api-key header when EXA_API_KEY is set", () => {
    //#given
    const apiKey = "test-exa-key-12345"
    const originalExaApiKey = process.env.EXA_API_KEY
    process.env.EXA_API_KEY = apiKey

    //#when
    const result = createWebsearchConfig()

    //#then
    expect(result.headers).toBeUndefined()
    if (result.headers) {
      expect(result.headers["x-api-key"]).toBeUndefined()
    }

    process.env.EXA_API_KEY = originalExaApiKey
  })
})
