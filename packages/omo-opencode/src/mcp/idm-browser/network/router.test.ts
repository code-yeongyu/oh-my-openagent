import { describe, test, expect } from "bun:test"
import { routeRequest } from "./router"

describe("network router", () => {
  test("#given quillbot URL #when routed #then lane is browser", () => {
    const decision = routeRequest("https://quillbot.com/ai-content-detector", "GET")
    expect(decision.lane).toBe("browser")
  })

  test("#given API endpoint #when routed #then lane is impit", () => {
    const decision = routeRequest("https://api.example.com/v1/check", "POST")
    expect(decision.lane).toBe("impit")
  })

  test("#given simple page #when routed #then lane is direct", () => {
    const decision = routeRequest("https://example.com/about", "GET")
    expect(decision.lane).toBe("direct")
  })
})
