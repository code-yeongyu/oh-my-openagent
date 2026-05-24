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

  test("XML-escapes agent names with quotes and angle brackets in attributes", () => {
    const text = renderHandoffMarker({
      prior: 'Sisyphus "The Boulder" <Pusher>',
      current: 'Hephaestus & Forge',
    })

    expect(text).toContain('prior="Sisyphus &quot;The Boulder&quot; &lt;Pusher&gt;"')
    expect(text).toContain('current="Hephaestus &amp; Forge"')
    expect(text).toContain("<identity-handoff ")
    expect(text).toContain("</identity-handoff>")
    expect(text).toContain('You are now Hephaestus & Forge.')
    expect(text).toContain('authored by Sisyphus "The Boulder" <Pusher>')
  })
})
