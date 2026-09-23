import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { BUNDLED_THEME_NAMES, resolveBundledThemesDir } from "./index"

/**
 * The engine rejects a theme that omits any required color token, so the shipped themes are pinned
 * against the documented contract here instead of relying on the live driver to catch a typo.
 * Source: `@code-yeongyu/senpi` `docs/themes.md`.
 */
const REQUIRED_TOKENS = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "selectedBg",
  "userMessageBg",
  "userMessageText",
  "customMessageBg",
  "customMessageText",
  "customMessageLabel",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "bashMode",
] as const

const HEX = /^#[0-9a-fA-F]{6}$/

function isColorValue(value: unknown, vars: Record<string, unknown>): boolean {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= 255
  if (typeof value !== "string") return false
  if (value === "") return true
  if (HEX.test(value)) return true
  return Object.prototype.hasOwnProperty.call(vars, value)
}

function readTheme(name: string): { name: unknown; vars: Record<string, unknown>; colors: Record<string, unknown> } {
  const dir = resolveBundledThemesDir()
  if (dir === undefined) throw new Error("packaged themes directory not found")
  const raw = readFileSync(join(dir, `${name}.json`), "utf8")
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== "object") throw new Error(`${name}.json is not an object`)
  const record = parsed as Record<string, unknown>
  const vars = (record.vars ?? {}) as Record<string, unknown>
  const colors = (record.colors ?? {}) as Record<string, unknown>
  return { name: record.name, vars, colors }
}

describe("shipped TUI themes", () => {
  for (const themeName of BUNDLED_THEME_NAMES) {
    describe(`#given ${themeName}.json`, () => {
      test("#then its declared name matches the file and contains no slash", () => {
        // when
        const { name } = readTheme(themeName)

        // then
        expect(name).toBe(themeName)
        expect(String(name).includes("/")).toBe(false)
      })

      test("#then every required color token is defined", () => {
        // when
        const { colors } = readTheme(themeName)
        const missing = REQUIRED_TOKENS.filter((token) => !Object.prototype.hasOwnProperty.call(colors, token))

        // then
        expect(missing).toEqual([])
      })

      test("#then every color value is a hex, a 256-color index, an empty default, or a declared var", () => {
        // given
        const { vars, colors } = readTheme(themeName)

        // when
        const invalid = Object.entries(colors).filter(([, value]) => !isColorValue(value, vars))

        // then
        expect(invalid).toEqual([])
      })
    })
  }

  test("#given the shipped set #when compared #then theme names stay unique", () => {
    // when
    const names = BUNDLED_THEME_NAMES.map((themeName) => readTheme(themeName).name)

    // then
    expect(new Set(names).size).toBe(names.length)
  })
})
