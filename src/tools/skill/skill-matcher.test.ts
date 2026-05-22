/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { matchSkillByName } from "./skill-matcher"

// `matchSkillByName` is the shared matcher that every skill-resolving entry
// point in this codebase delegates to (sync `resolveSkillContent` /
// `resolveMultipleSkills`, async equivalents, `getSkillByName`, and the
// auto-slash-command `findCommand`). Its contract drives all of them, so this
// file pins the contract directly — independent of which caller is exercising
// it. Issue #4183 + cubic-dev-ai review on #4269.

type NameOnly = { readonly name: string }

const skills = <T extends NameOnly>(arr: readonly T[]): T[] => [...arr]

describe("matchSkillByName — contract for every skill resolver in the codebase", () => {
  describe("exact match (case-insensitive)", () => {
    test("matches identical name", () => {
      const fixture = skills([{ name: "frontend-ui-ux" }, { name: "playwright" }])
      expect(matchSkillByName(fixture, "playwright")).toEqual({ name: "playwright" })
    })

    test("matches case-insensitively against the stored name", () => {
      const fixture = skills([{ name: "frontend-ui-ux" }])
      expect(matchSkillByName(fixture, "Frontend-UI-UX")?.name).toBe("frontend-ui-ux")
      expect(matchSkillByName(fixture, "FRONTEND-UI-UX")?.name).toBe("frontend-ui-ux")
    })

    test("matches case-insensitively when stored name has mixed case", () => {
      const fixture = skills([{ name: "Frontend-UI-UX" }])
      expect(matchSkillByName(fixture, "frontend-ui-ux")?.name).toBe("Frontend-UI-UX")
    })
  })

  describe("short-name fallback for namespaced skills", () => {
    test("matches a namespaced skill via its basename", () => {
      const fixture = skills([{ name: "superpowers/systematic-debugging" }])
      expect(matchSkillByName(fixture, "systematic-debugging")?.name).toBe("superpowers/systematic-debugging")
    })

    test("short-name match is case-insensitive on the basename", () => {
      const fixture = skills([{ name: "superpowers/case-test" }])
      expect(matchSkillByName(fixture, "Case-Test")?.name).toBe("superpowers/case-test")
    })

    test("does NOT short-name-match a non-namespaced skill (no `/` in stored name)", () => {
      // a `playwright` builtin must not steal the short-name fallback —
      // there's nothing to fall back from in the first place.
      const fixture = skills([{ name: "playwright" }, { name: "ns/other" }])
      // request `other` short-name → matches the namespaced one
      expect(matchSkillByName(fixture, "other")?.name).toBe("ns/other")
      // request `playwright` → exact match wins (no fallback considered)
      expect(matchSkillByName(fixture, "playwright")?.name).toBe("playwright")
    })
  })

  describe("ambiguity protection", () => {
    test("returns undefined when two namespaced skills share a basename", () => {
      const fixture = skills([
        { name: "superpowers/debug" },
        { name: "utils/debug" },
      ])
      expect(matchSkillByName(fixture, "debug")).toBeUndefined()
    })

    test("three-way ambiguity is also rejected", () => {
      const fixture = skills([
        { name: "ns-a/x" },
        { name: "ns-b/x" },
        { name: "ns-c/x" },
      ])
      expect(matchSkillByName(fixture, "x")).toBeUndefined()
    })
  })

  describe("exact-match precedence", () => {
    test("an exact match wins over an ambiguous short-name set", () => {
      const fixture = skills([
        { name: "debug" }, // exact match
        { name: "superpowers/debug" },
        { name: "utils/debug" },
      ])
      // exact `debug` resolves, even though `debug` would otherwise be ambiguous
      // across `superpowers/debug` + `utils/debug`.
      expect(matchSkillByName(fixture, "debug")?.name).toBe("debug")
    })

    test("an exact match wins over a unique short-name match", () => {
      const fixture = skills([
        { name: "debug" },
        { name: "superpowers/debug" },
      ])
      expect(matchSkillByName(fixture, "debug")?.name).toBe("debug")
    })

    test("exact match wins case-insensitively too", () => {
      const fixture = skills([
        { name: "DEBUG" },
        { name: "superpowers/debug" },
      ])
      expect(matchSkillByName(fixture, "debug")?.name).toBe("DEBUG")
    })
  })

  describe("edge cases", () => {
    test("empty fixture returns undefined", () => {
      expect(matchSkillByName([], "anything")).toBeUndefined()
    })

    test("no exact and no short-name match returns undefined", () => {
      const fixture = skills([{ name: "frontend-ui-ux" }, { name: "ns/foo" }])
      expect(matchSkillByName(fixture, "nonexistent")).toBeUndefined()
    })

    test("works with richer shapes than just `{name}` — accepts any `{name: string}`", () => {
      type Skill = { name: string; description: string; template: string }
      const fixture: Skill[] = [
        { name: "ns/short", description: "d", template: "body" },
      ]
      const matched = matchSkillByName(fixture, "short")
      // type carries through, so the caller still sees the full Skill shape
      expect(matched?.template).toBe("body")
    })

    test("handles names with multiple slashes by taking only the last segment as basename", () => {
      // e.g. nested skill packs `vendor/pack/name`
      const fixture = skills([{ name: "vendor/pack/name" }])
      expect(matchSkillByName(fixture, "name")?.name).toBe("vendor/pack/name")
      // mid segments are not basename — must not match
      expect(matchSkillByName(fixture, "pack")).toBeUndefined()
    })
  })
})
