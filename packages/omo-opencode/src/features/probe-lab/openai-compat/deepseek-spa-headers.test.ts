import { describe, expect, test } from "bun:test"
import {
  DEEPSEEK_SPA_BASE_HEADERS,
  mergeSpaBaseHeaders,
} from "./deepseek-spa-headers"

describe("DEEPSEEK_SPA_BASE_HEADERS", () => {
  describe("#given the constant is read", () => {
    test("#when inspecting keys #then contains the 5 SPA client identity headers (incl. x-app-version)", () => {
      const keys = Object.keys(DEEPSEEK_SPA_BASE_HEADERS).sort()
      expect(keys).toEqual([
        "x-app-version",
        "x-client-locale",
        "x-client-platform",
        "x-client-timezone-offset",
        "x-client-version",
      ])
    })

    test("#when reading values #then matches chat.deepseek.com web bundle (captured from main.876fbaccb8.js, commit 1300ef9f7)", () => {
      expect(DEEPSEEK_SPA_BASE_HEADERS["x-app-version"]).toBe("2.0.0")
      expect(DEEPSEEK_SPA_BASE_HEADERS["x-client-platform"]).toBe("web")
      expect(DEEPSEEK_SPA_BASE_HEADERS["x-client-version"]).toBe("2.0.0")
      expect(DEEPSEEK_SPA_BASE_HEADERS["x-client-locale"]).toBe("en_US")
      expect(DEEPSEEK_SPA_BASE_HEADERS["x-client-timezone-offset"]).toBe("0")
    })
  })

  describe("#given the constant is exported", () => {
    test("#when attempting mutation #then is frozen and immutable", () => {
      expect(Object.isFrozen(DEEPSEEK_SPA_BASE_HEADERS)).toBe(true)
      expect(() => {
        ;(DEEPSEEK_SPA_BASE_HEADERS as Record<string, string>)[
          "x-client-platform"
        ] = "ios"
      }).toThrow()
    })
  })
})

describe("mergeSpaBaseHeaders", () => {
  describe("#given empty extras", () => {
    test("#when merged #then returns all 5 base headers", () => {
      const merged = mergeSpaBaseHeaders({})
      expect(Object.keys(merged).length).toBe(5)
      expect(merged["x-client-platform"]).toBe("web")
      expect(merged["x-app-version"]).toBe("2.0.0")
    })

    test("#when merged #then returns a fresh mutable object (not the frozen base)", () => {
      const merged = mergeSpaBaseHeaders({})
      expect(Object.isFrozen(merged)).toBe(false)
      merged.Foo = "bar"
      expect(merged.Foo).toBe("bar")
      expect(
        (DEEPSEEK_SPA_BASE_HEADERS as Record<string, string>).Foo,
      ).toBeUndefined()
    })
  })

  describe("#given an Authorization extra", () => {
    test("#when merged #then returns 6 entries with Authorization preserved", () => {
      const merged = mergeSpaBaseHeaders({ Authorization: "Bearer X" })
      expect(Object.keys(merged).length).toBe(6)
      expect(merged.Authorization).toBe("Bearer X")
      expect(merged["x-client-version"]).toBe("2.0.0")
      expect(merged["x-app-version"]).toBe("2.0.0")
    })
  })

  describe("#given an extra that conflicts with a base header", () => {
    test("#when merged #then caller's value wins (extras override base)", () => {
      const merged = mergeSpaBaseHeaders({ "x-client-platform": "ios" })
      expect(merged["x-client-platform"]).toBe("ios")
      expect(Object.keys(merged).length).toBe(5)
    })
  })

  describe("#given multiple extras including conflicts and additions", () => {
    test("#when merged #then conflicts override and additions append", () => {
      const merged = mergeSpaBaseHeaders({
        Cookie: "aws-waf-token=abc",
        "Content-Type": "application/json",
      })
      expect(merged.Cookie).toBe("aws-waf-token=abc")
      expect(merged["Content-Type"]).toBe("application/json")
      expect(merged["x-client-platform"]).toBe("web")
      expect(Object.keys(merged).length).toBe(7)
    })
  })
})
