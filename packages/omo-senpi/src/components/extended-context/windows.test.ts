import { describe, expect, it } from "bun:test"
import { computeWidenedWindows, matchReportedSlug, parseReportedWindows } from "./windows"

const reported = parseReportedWindows({
  models: [
    { slug: "gpt-6.1-sol", context_window: 500_000, max_context_window: 872_000 },
    { slug: "gpt-6-luna", context_window: 922_000, max_context_window: 872_000 },
    { slug: "gpt-5.3-codex", context_window: 272_000, max_context_window: 872_000 },
    { slug: "", context_window: 1, max_context_window: 1 },
    { slug: "broken" },
  ],
})

describe("parseReportedWindows", () => {
  it("#given a payload with unusable rows #when parsed #then only rows with a slug and a maximum survive", () => {
    expect(reported.map((window) => window.slug)).toEqual(["gpt-6.1-sol", "gpt-6-luna", "gpt-5.3-codex"])
  })

  it("#given a non-object payload #when parsed #then it yields no windows", () => {
    expect(parseReportedWindows("nope")).toEqual([])
    expect(parseReportedWindows(undefined)).toEqual([])
  })
})

describe("matchReportedSlug", () => {
  const slugs = ["gpt-6.1-sol", "gpt-5.3-codex"]

  it("#given a clone id #when matched #then the catalog variant suffix maps to its base", () => {
    expect(matchReportedSlug("gpt-6.1-sol-ultrafast", ["gpt-6.1-sol-ultrafast", ...slugs])).toBe("gpt-6.1-sol-ultrafast")
    expect(matchReportedSlug("gpt-6.1-sol-fast", slugs)).toBe("gpt-6.1-sol")
  })

  it("#given a sibling that only shares a prefix #when matched #then it is not given the parent's window", () => {
    expect(matchReportedSlug("gpt-5.3-codex-spark", slugs)).toBeUndefined()
  })

  it("#given an unrelated id #when matched #then nothing matches", () => {
    expect(matchReportedSlug("gpt-5.6-terra", slugs)).toBeUndefined()
  })
})

describe("computeWidenedWindows", () => {
  it("#given a reported maximum above the catalog window #when computed #then the output reserve is subtracted", () => {
    const widened = computeWidenedWindows(
      [{ id: "gpt-6.1-sol", contextWindow: 500_000, maxTokens: 128_000 }],
      reported,
    )
    expect(widened).toEqual([{ id: "gpt-6.1-sol", slug: "gpt-6.1-sol", from: 500_000, to: 744_000 }])
  })

  it("#given a catalog window above the reported maximum #when computed #then it is never lowered", () => {
    expect(
      computeWidenedWindows([{ id: "gpt-6-luna", contextWindow: 922_000, maxTokens: 128_000 }], reported),
    ).toEqual([])
  })

  it("#given a model the subscription does not report #when computed #then it is left alone", () => {
    expect(
      computeWidenedWindows([{ id: "gpt-5.6-terra", contextWindow: 272_000, maxTokens: 128_000 }], reported),
    ).toEqual([])
  })
})
