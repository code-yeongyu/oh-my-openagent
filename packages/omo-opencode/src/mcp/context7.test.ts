/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"

let originalContext7ApiKey: string | undefined

async function importFreshContext7Module(): Promise<typeof import("./context7")> {
  return import(`./context7?test=${Date.now()}-${Math.random()}`)
}

async function loadContext7WithApiKey(value: string | undefined): Promise<typeof import("./context7")["context7"]> {
  originalContext7ApiKey = process.env.CONTEXT7_API_KEY
  if (value === undefined) {
    delete process.env.CONTEXT7_API_KEY
  } else {
    process.env.CONTEXT7_API_KEY = value
  }
  return (await importFreshContext7Module()).context7
}

afterEach(() => {
  if (originalContext7ApiKey === undefined) {
    delete process.env.CONTEXT7_API_KEY
    return
  }
  process.env.CONTEXT7_API_KEY = originalContext7ApiKey
})

describe("context7 MCP config", () => {
  test('#given placeholder CONTEXT7_API_KEY #when config is loaded #then auth headers are omitted', async () => {
    // given / when
    const config = await loadContext7WithApiKey("your api key")

    // then
    expect(config).toEqual({
      type: "remote",
      url: "https://mcp.context7.com/mcp",
      enabled: true,
      oauth: false,
    })
  })

  test("#given real CONTEXT7_API_KEY #when config is loaded #then bearer auth header is used", async () => {
    // given / when
    const config = await loadContext7WithApiKey("ctx7sk_test_real_value")

    // then
    expect(config.headers).toEqual({ Authorization: "Bearer ctx7sk_test_real_value" })
    expect(config.url).not.toContain("ctx7sk_test_real_value")
  })
})
