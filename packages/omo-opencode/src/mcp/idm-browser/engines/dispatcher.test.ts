import { describe, test, expect } from "bun:test"
import { dispatchEngine } from "./dispatcher"

describe("dispatchEngine", () => {
  test("#given patchright engine #when dispatched #then throws not implemented", async () => {
    await expect(dispatchEngine({ engine: "patchright" })).rejects.toThrow("not yet implemented")
  })

  test("#given lightpanda engine #when dispatched #then throws not implemented", async () => {
    await expect(dispatchEngine({ engine: "lightpanda" })).rejects.toThrow("not yet implemented")
  })
})
