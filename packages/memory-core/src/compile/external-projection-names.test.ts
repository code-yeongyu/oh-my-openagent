import { describe, expect, it } from "bun:test"
import { directoryItems, generatedIds, type NamedFile } from "./external-projection-names"

const AWS_KEY_SHAPED = ["AKIA", "ABCDEFGHIJKLMNOP"].join("")
const files = (...names: readonly string[]): NamedFile[] => names.map((name) => ({ name, time: 0, files: 1 }))
const texts = (names: readonly string[]): string[] => directoryItems(files(...names)).map((item) => item.text)
const range = (count: number, name: (index: number) => string): string[] => Array.from({ length: count }, (_, index) => name(index))

describe("directoryItems name classes", () => {
  const cases: ReadonlyArray<{ readonly name: string; readonly names: readonly string[]; readonly expected: readonly string[] }> = [
    { name: "a hinted markdown name drops only .md", names: ["release-checklist-notes.md"], expected: ["release-checklist-notes"] },
    { name: "a dotted markdown name drops only the last .md", names: ["1password.com.md"], expected: ["1password.com"] },
    { name: "a non-markdown name stays exact and quoted", names: [".dream-state.json"], expected: ["\".dream-state.json\""] },
    { name: "a lone dated name keeps its date", names: ["quarterly-review-20261012.md"], expected: ["quarterly-review-20261012"] },
    {
      name: "hinted names sharing a date are grouped under it",
      names: ["alpha-20261012.md", "beta-20261012.md", "gamma-20261013.md"],
      expected: ["{alpha, beta}-20261012", "gamma-20261013"],
    },
    {
      name: "month chunks fold into one range",
      names: range(12, (index) => `2026-${String(6 + (index % 5)).padStart(2, "0")}-p${index + 1}.md`),
      expected: ["2026-06-p1 … 2026-10-p10 (12 files)"],
    },
    {
      name: "same-prefix timestamped names fold into one range",
      names: range(5, (index) => `standup-notes-2026102${index}-0${index}00-0${index}30z.md`),
      expected: ["standup-notes-20261020-0000-0030z … standup-notes-20261024-0400-0430z (5 files)"],
    },
    {
      name: "generated-id names fold into one id entry",
      names: ["0b6e3c1a-2d4f-4e8a-9b1c-3d5e7f9a1b2c.md", "1c7f4d2b-3e5a-4f9b-8c2d-4e6f8a0b2c3d.md", "2d8a5e3c-4f6b-4a0c-9d3e-5f7a9b1c3d4e.md"],
      expected: ["<id> (3 files)"],
    },
    {
      name: "two hint-free names of a run stay listed",
      names: ["reflection-20261017.md", "reflection-20261018.md"],
      expected: ["reflection-20261017", "reflection-20261018"],
    },
    {
      name: "a short run whose pattern is not shorter stays listed",
      names: ["2026-06.md", "2026-07.md", "2026-08.md"],
      expected: ["2026-06", "2026-07", "2026-08"],
    },
    {
      name: "a word after the date is a hint and never folds",
      names: ["standup-notes-20261020-afternoon.md", "standup-notes-20261021-evening.md", "standup-notes-20261022-late.md"],
      expected: ["standup-notes-20261020-afternoon", "standup-notes-20261021-evening", "standup-notes-20261022-late"],
    },
    {
      name: "names that end in digits are hints, not ids",
      names: ["project2024.md", "gpt6.md", "GitHubActions2024.md", "iPhone15Pro.md"],
      expected: ["GitHubActions2024", "gpt6", "iPhone15Pro", "project2024"],
    },
    {
      name: "a leading date with a topic is a hint",
      names: ["20261016-duty-corrections.md", "20261017-duty-handoff.md", "20261018-duty-ledger.md"],
      expected: ["20261016-duty-corrections", "20261017-duty-handoff", "20261018-duty-ledger"],
    },
    {
      name: "secret-like names are masked before they are listed or grouped",
      names: [`${AWS_KEY_SHAPED}-20261012.md`, "plain-20261012.md"],
      expected: ["{***, plain}-20261012"],
    },
  ]

  for (const testCase of cases) {
    it(`#given ${testCase.name} #when listed #then the items are exact`, () => {
      // given
      const names = testCase.names

      // when
      const listed = texts(names)

      // then
      expect([...listed].sort()).toEqual([...testCase.expected].sort())
    })
  }

  it("#given folded and grouped items #when counted #then every file is accounted for", () => {
    // given
    const names = [...range(4, (index) => `2026-0${index + 1}-p1.md`), "a-20261012.md", "b-20261012.md", "note.md"]

    // when
    const items = directoryItems(files(...names))

    // then
    expect(items.reduce((sum, item) => sum + item.files, 0)).toBe(names.length)
  })

  it("#given commit times #when listed #then items are newest first and a group takes its newest member's time", () => {
    // given
    const listed: NamedFile[] = [
      { name: "old.md", time: 1, files: 1 },
      { name: "a-20261012.md", time: 2, files: 1 },
      { name: "b-20261012.md", time: 9, files: 1 },
      { name: "mid.md", time: 5, files: 1 },
    ]

    // when
    const items = directoryItems(listed).map((item) => item.text)

    // then
    expect(items).toEqual(["{b, a}-20261012", "mid", "old"])
  })
})

describe("generatedIds", () => {
  const cases: ReadonlyArray<{ readonly name: string; readonly names: readonly string[]; readonly ids: readonly string[] }> = [
    { name: "a UUID", names: ["0b6e3c1a-2d4f-4e8a-9b1c-3d5e7f9a1b2c"], ids: ["0b6e3c1a-2d4f-4e8a-9b1c-3d5e7f9a1b2c"] },
    { name: "a hex digest of 16 or more characters", names: ["4bea7ccd8f2e19a0", "4bea7ccd", "deadbeefcafe2026"], ids: ["4bea7ccd8f2e19a0"] },
    {
      name: "same-length random tokens, each judged on its own so a word-like one is never pulled in",
      names: ["Y2Gw9vTZ9pnH2K5a", "87U3F2ZseCw7bLMz", "wcjyAab9yeccko3U", "design-notes"],
      ids: ["Y2Gw9vTZ9pnH2K5a", "87U3F2ZseCw7bLMz"],
    },
    { name: "two word-like random tokens are not a family", names: ["wcjyAab9yeccko3U", "XpTHKRroIBYxc5em"], ids: [] },
    { name: "words ending in digits", names: ["project2024", "iPhone15Pro", "OAuth2Client", "1password"], ids: [] },
    { name: "same-length lowercase words", names: ["agentportal", "chatgptpros", "dependencies"], ids: [] },
  ]

  for (const testCase of cases) {
    it(`#given ${testCase.name} #when classified #then the ids are exact`, () => {
      // given
      const names = testCase.names

      // when
      const ids = generatedIds(names)

      // then
      expect([...ids].sort()).toEqual([...testCase.ids].sort())
    })
  }
})
