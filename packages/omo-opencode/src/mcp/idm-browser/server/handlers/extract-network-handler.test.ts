import { describe, expect, test } from "bun:test"
import { handleExtractNetwork } from "./extract-network-handler"

describe("handleExtractNetwork", () => {
  test("#given include_bodies true #when extracting network #then tap body capture is enabled before reading", async () => {
    let enabled = false
    const pool = {
      acquire: async () => ({
        id: "session-1",
        tap: {
          setBodyCapture: (value: boolean) => { enabled = value },
          getAll: () => [{ url: "https://example.com", method: "POST", resourceType: "fetch", timestamp: 1 }],
          getByType: () => [],
          clear: () => undefined,
        },
      }),
    }

    await handleExtractNetwork(pool, { include_bodies: true })

    expect(enabled).toBe(true)
  })
})
