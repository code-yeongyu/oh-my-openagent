/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { routeMemoryTypeToMoc } from "./types"

describe("routeMemoryTypeToMoc", () => {
  test("#given decision #when routed #then MOC - Decisions", () => {
    expect(routeMemoryTypeToMoc("decision")).toBe("MOC - Decisions")
  })

  test("#given discovery #when routed #then MOC - Discoveries", () => {
    expect(routeMemoryTypeToMoc("discovery")).toBe("MOC - Discoveries")
  })

  test("#given benchmark #when routed #then MOC - Discoveries", () => {
    expect(routeMemoryTypeToMoc("benchmark")).toBe("MOC - Discoveries")
  })

  test("#given bugfix #when routed #then MOC - Engineering", () => {
    expect(routeMemoryTypeToMoc("bugfix")).toBe("MOC - Engineering")
  })

  test("#given feature #when routed #then MOC - Engineering", () => {
    expect(routeMemoryTypeToMoc("feature")).toBe("MOC - Engineering")
  })

  test("#given change #when routed #then MOC - Engineering", () => {
    expect(routeMemoryTypeToMoc("change")).toBe("MOC - Engineering")
  })

  test("#given rule #when routed #then MOC - Conventions", () => {
    expect(routeMemoryTypeToMoc("rule")).toBe("MOC - Conventions")
  })

  test("#given convention #when routed #then MOC - Conventions", () => {
    expect(routeMemoryTypeToMoc("convention")).toBe("MOC - Conventions")
  })
})
