import { describe, expect, test } from "bun:test"

import { panelActionUrl, parsePanelActionUrl, withActionLink, type PanelAction } from "./links"

const stripLinks = (text: string): string => text.replace(/\u001b\]8;;[^\u0007]*\u0007/g, "")

describe("panel action urls", () => {
  test("#given a file action #when encoded and parsed back #then the path survives verbatim", () => {
    // given
    const action: PanelAction = { kind: "file", path: "packages/omo-senpi/src/a b#c.ts" }

    // when / then
    expect(parsePanelActionUrl(panelActionUrl(action))).toEqual(action)
  })

  test("#given an agent action #when encoded and parsed back #then the id survives verbatim", () => {
    // given
    const action: PanelAction = { kind: "agent", id: "st_01ABC/def" }

    // when / then
    expect(parsePanelActionUrl(panelActionUrl(action))).toEqual(action)
  })

  test("#given a value carrying escape bytes #when encoded #then the sequence cannot be ended early", () => {
    // given a raw BEL or ESC would terminate the hyperlink and spill the rest over the row
    const path = "a\u0007b\u001bc"

    // when
    const url = panelActionUrl({ kind: "file", path })

    // then
    expect(url.includes("\u0007")).toBe(false)
    expect(url.includes("\u001b")).toBe(false)
    expect(parsePanelActionUrl(url)).toEqual({ kind: "file", path })
  })

  test("#given a url the host owns #when parsed #then the panel does not claim it", () => {
    // given / when / then
    expect(parsePanelActionUrl("https://example.com/x")).toBeUndefined()
  })

  test("#given an unknown action kind #when parsed #then nothing is claimed", () => {
    // given a future scheme member must not be guessed at
    expect(parsePanelActionUrl("omo-panel:memory/x")).toBeUndefined()
  })

  test("#given a truncated url #when parsed #then nothing is claimed", () => {
    // given / when / then
    expect(parsePanelActionUrl("omo-panel:file/")).toBeUndefined()
    expect(parsePanelActionUrl("omo-panel:file")).toBeUndefined()
    expect(parsePanelActionUrl("omo-panel:/x")).toBeUndefined()
  })

  test("#given a malformed percent escape #when parsed #then nothing is claimed", () => {
    // given / when / then
    expect(parsePanelActionUrl("omo-panel:file/%zz")).toBeUndefined()
  })

  test("#given painted text #when linked #then the visible text is untouched", () => {
    // when
    const linked = withActionLink("M file.ts", { kind: "file", path: "file.ts" })

    // then
    expect(stripLinks(linked)).toBe("M file.ts")
    expect(linked.startsWith("\u001b]8;;omo-panel:file/file.ts\u0007")).toBe(true)
    expect(linked.endsWith("\u001b]8;;\u0007")).toBe(true)
  })
})
