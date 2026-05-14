/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { renderHandoffMarker } from "./marker"

describe("renderHandoffMarker", () => {
  test("wraps the marker in an identity-handoff element with both names", () => {
    const text = renderHandoffMarker({ prior: "sisyphus", current: "hephaestus" })

    expect(text).toContain('<identity-handoff prior="sisyphus" current="hephaestus">')
    expect(text).toContain("</identity-handoff>")
  })

  test("names the current agent in the imperative line", () => {
    const text = renderHandoffMarker({ prior: "sisyphus", current: "hephaestus" })

    expect(text).toContain("You are now hephaestus.")
  })

  test("names the prior agent in the history-reframing line", () => {
    const text = renderHandoffMarker({ prior: "sisyphus", current: "hephaestus" })

    expect(text).toContain("authored by sisyphus")
  })

  test("handles display-style agent names verbatim", () => {
    const text = renderHandoffMarker({
      prior: "Sisyphus - Ultraworker",
      current: "Hephaestus - Deep Agent",
    })

    expect(text).toContain('prior="Sisyphus - Ultraworker"')
    expect(text).toContain('current="Hephaestus - Deep Agent"')
    expect(text).toContain("You are now Hephaestus - Deep Agent")
  })
})
