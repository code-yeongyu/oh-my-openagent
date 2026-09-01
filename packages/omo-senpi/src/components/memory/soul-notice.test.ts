import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"

import { renderSoulUpdatedEntry } from "./soul-notice"

const SOUL_COMMIT = {
  sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  subject: "rewrite my persona",
  affectedPaths: ["system/persona.md"],
}
const SOUL_SHA7 = SOUL_COMMIT.sha.slice(0, 7)

const BOLD = "\u001b[1m"
const BOLD_OFF = "\u001b[22m"
function bold(text: string): string {
  return `${BOLD}${text}${BOLD_OFF}`
}

const PLAIN_THEME = {
  fg: (_color: ThemeColor, text: string) => text,
  bg: (_color: "customMessageBg", text: string) => text,
}

function recordingTheme(): {
  readonly theme: { fg: (color: ThemeColor, text: string) => string; bg: (color: "customMessageBg", text: string) => string }
  readonly colors: ThemeColor[]
} {
  const colors: ThemeColor[] = []
  return {
    theme: {
      fg: (color: ThemeColor, text: string) => {
        colors.push(color)
        return text
      },
      bg: (_color: "customMessageBg", text: string) => text,
    },
    colors,
  }
}

function renderSoul(
  data: typeof SOUL_COMMIT | undefined,
  options: { readonly expanded?: boolean; readonly theme?: unknown } = {},
): string[] {
  const component = renderSoulUpdatedEntry(
    { data } as never,
    { expanded: options.expanded ?? false },
    (options.theme ?? PLAIN_THEME) as never,
  )
  expect(component).toBeDefined()
  return component!.render(120).slice(1, -1).map((line) => line.slice(1).trimEnd())
}

describe("renderSoulUpdatedEntry house notice contract", () => {
  test("#given a persona soul commit #when it renders collapsed #then the title carries the glyph and sha7 and the why names the file", () => {
    // when
    const lines = renderSoul(SOUL_COMMIT)

    // then
    expect(lines[0]).toBe(bold(`● Memory soul updated · ${SOUL_SHA7}`))
    expect(lines[0]).toContain("●")
    expect(lines[0]).toContain(SOUL_SHA7)
    expect(lines[1]).toContain("system/persona.md")
    expect(lines.join("\n")).not.toContain(SOUL_COMMIT.sha)
  })

  test("#when it renders collapsed #then each affected path is a visible extra line and the detail is omitted", () => {
    // when
    const lines = renderSoul(SOUL_COMMIT)

    // then
    expect(lines).toEqual([
      bold(`● Memory soul updated · ${SOUL_SHA7}`),
      "The soul file system/persona.md changed.",
      "system/persona.md",
    ])
    expect(lines.join("\n")).not.toContain(SOUL_COMMIT.sha)
    expect(lines.join("\n")).not.toContain(SOUL_COMMIT.subject)
  })

  test("#when it renders expanded #then the detail row carries the full sha and subject", () => {
    // when
    const lines = renderSoul(SOUL_COMMIT, { expanded: true })

    // then
    expect(lines.at(-1)).toBe(`${SOUL_COMMIT.sha} · ${SOUL_COMMIT.subject}`)
    expect(lines.join("\n")).toContain(SOUL_COMMIT.sha)
  })

  test("#given persona and identity #when it renders #then the why names both soul files", () => {
    // when
    const lines = renderSoul({
      ...SOUL_COMMIT,
      affectedPaths: ["system/identity.md", "system/persona.md"],
    })

    // then
    expect(lines[1]).toContain("system/persona.md")
    expect(lines[1]).toContain("system/identity.md")
    expect(lines.slice(2)).toEqual(["system/identity.md", "system/persona.md"])
  })

  test("#given identity plus a non-soul path #when it renders #then the why names only the soul file", () => {
    // when
    const lines = renderSoul({
      ...SOUL_COMMIT,
      affectedPaths: ["system/identity.md", "reference/old-persona.md"],
    })

    // then
    expect(lines[1]).toContain("system/identity.md")
    expect(lines[1]).not.toContain("reference/old-persona.md")
    expect(lines.slice(2)).toEqual(["system/identity.md", "reference/old-persona.md"])
  })

  test("#when coloured #then the title is accent and the secondary rows are dim", () => {
    // given
    const recorder = recordingTheme()

    // when
    renderSoul(SOUL_COMMIT, { expanded: true, theme: recorder.theme })

    // then
    expect(recorder.colors).toEqual(["accent", "dim", "dim", "dim"])
  })

  test("#when rendered with a background theme #then every padded line carries customMessageBg", () => {
    const component = renderSoulUpdatedEntry({ data: SOUL_COMMIT } as never, { expanded: false }, {
      fg: (_color: ThemeColor, text: string) => text,
      bg: (_color: "customMessageBg", text: string) => `<notice-bg>${text}</notice-bg>`,
    } as never)
    for (const line of component!.render(120)) expect(line).toMatch(/^<notice-bg>.*<\/notice-bg>$/u)
  })

  test("#given no record #when it renders #then it returns undefined", () => {
    expect(
      renderSoulUpdatedEntry({} as never, { expanded: false }, PLAIN_THEME as never),
    ).toBeUndefined()
  })
})
