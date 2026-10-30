import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { contrastRatio, readRootTokens, resolveColor } from "./design-tokens"

const WEB_ROOT = join(import.meta.dir, "..")
const INKS = ["--ink-0", "--ink-1", "--ink-2", "--ink-3"] as const
// A variant is read structurally: drop a `/name` or `/[name]` group suffix, drop any chain of compound
// prefixes (`group-`, `peer-`, `in-`, `has-`), then the rest must name a focus state in one of three shapes.
const VARIANT_NAME_SUFFIX = /\/(?:[\w-]+|\[[^\]]*\])$/
const COMPOUND_PREFIX = /^(?:group|peer|in|has)-/
const FOCUS_STATE = /^focus(?:-visible|-within)?$/
// data-focus, data-[focus], data-[focus=true], data-[focus~=x], data-[focus_=_true], ...
const FOCUS_DATA_ATTRIBUTE =
  /^data-(?:focus(?:-visible|-within)?|\[_*focus(?:-visible|-within)?_*(?:[~|^$*]?=[^\]]*)?\])$/
// Inside an arbitrary selector: a :focus pseudo-class (`_` is Tailwind's space) or a [data-focus...] attribute.
const FOCUS_IN_ARBITRARY_SELECTOR =
  /:focus(?:-visible|-within)?(?![a-zA-Z0-9-])|\[data-focus(?:-visible|-within)?(?![a-zA-Z0-9-])/
const OUTLINE_UTILITY = /^-?outline(?:-|$)|^-?\[outline(?:-[a-z]+)?:/

const CLOSER: Record<string, string> = { "[": "]", "(": ")" }

/**
 * Splits on `separator` only outside the given brackets. Variant chains also guard `(...)` (Tailwind v4's
 * `outline-(length:--w)` shorthand); whole lines guard only `[...]` so a call like `cn(...)` still splits.
 */
function splitOutsideBrackets(text: string, separator: RegExp, openers: string): readonly string[] {
  const closers = Array.from(openers, (opener) => CLOSER[opener])
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? ""
    if (openers.includes(char)) depth++
    else if (closers.includes(char) && depth > 0) depth--
    else if (depth === 0 && separator.test(char)) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts.filter((part) => part !== "")
}

function isFocusVariant(variant: string): boolean {
  let core = variant.replace(VARIANT_NAME_SUFFIX, "")
  while (COMPOUND_PREFIX.test(core)) core = core.replace(COMPOUND_PREFIX, "")
  return (
    FOCUS_STATE.test(core) ||
    FOCUS_DATA_ATTRIBUTE.test(core) ||
    (core.startsWith("[") && FOCUS_IN_ARBITRARY_SELECTOR.test(core))
  )
}

/** A class token that puts an outline utility behind any focus-state variant, in any position or form. */
function isHandRolledFocusOutline(token: string): boolean {
  const parts = splitOutsideBrackets(token, /:/, "[(")
  if (parts.length < 2) return false
  const utility = (parts.at(-1) ?? "").replace(/^!|!$/g, "")
  return OUTLINE_UTILITY.test(utility) && parts.slice(0, -1).some(isFocusVariant)
}

function hasHandRolledFocusOutline(line: string): boolean {
  return splitOutsideBrackets(line, /[\s"'`,{}]/, "[").some(isHandRolledFocusOutline)
}

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
}

function offendingLines(matches: (line: string) => boolean): readonly string[] {
  return ["app", "components"]
    .flatMap((directory) => sourceFiles(join(WEB_ROOT, directory)))
    .flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          matches(line) ? [`${relative(WEB_ROOT, file)}:${index + 1}`] : [],
        ),
    )
}

describe("focus ring token", () => {
  test.each(INKS)(
    "#given the --ring token #when drawn on %s #then it meets the 3:1 non-text contrast of WCAG 1.4.11",
    (ink) => {
      const tokens = readRootTokens()

      const ratio = contrastRatio(resolveColor(tokens, "--ring"), resolveColor(tokens, ink))

      expect(ratio).toBeGreaterThanOrEqual(3)
    },
  )
})

describe("focus ring recipe, the DESIGN.md §8 one-recipe architecture contract", () => {
  test("#given the components #when scanned #then no focus or selection indicator is drawn in --accent-32", () => {
    const indicator =
      /(?:focus(?:-visible|-within)?|data-\[active=true\]):[^\s"'`]*accent-32|outline-accent-32|outline-\[var\(--accent-32\)\]/

    expect(offendingLines((line) => indicator.test(line))).toEqual([])
  })

  // Every Tailwind form that puts an outline utility behind a focus-state variant (FIX THE CLASS, #11523).
  test.each([
    ["focus:outline-2"],
    ["focus-visible:outline-2"],
    ["focus-within:outline-2"],
    ["focus:outline"],
    ["focus-visible:outline-none"],
    ["focus-visible:outline-hidden"],
    ["focus:-outline-offset-2"],
    ["focus-visible:outline-offset-2"],
    ["group-focus:outline-2"],
    ["group-focus-visible:outline-2"],
    ["group-focus-within:outline-2"],
    ["peer-focus:outline-2"],
    ["peer-focus-visible:outline-2"],
    ["peer-focus-within:outline-2"],
    ["group-focus/card:outline-2"],
    ["peer-focus-visible/field:outline-2"],
    ["md:focus:outline-2"],
    ["dark:md:focus-visible:outline-none"],
    ["hover:focus-visible:outline-2"],
    ["focus-visible:hover:outline-2"],
    ["group-hover:focus:outline-2"],
    ["[&:focus]:outline-2"],
    ["[&:focus-visible]:outline-ring"],
    ["[&:focus-within]:outline-2"],
    ["[&_a:focus-visible]:outline-2"],
    ["[&:is(:focus)]:outline-2"],
    ["md:[&:focus]:outline-2"],
    ["has-[:focus-visible]:outline-2"],
    ["group-[:focus]:outline-2"],
    ["focus:!outline-2"],
    ["focus:outline-2!"],
    ["focus-visible:outline-[var(--ring)]"],
    ['className="px-2 focus-visible:outline-2"'],
    ['cn("px-2", isOpen && "md:focus:outline")'],
    ["`${base} peer-focus:outline-2`"],
    ["[:focus-visible_&]:outline-2"],
    ["[&:focus_svg]:outline-2"],
    ["in-focus:outline-2"],
    ["has-focus:outline-2"],
    ["has-focus-visible:outline-2"],
    ["group-has-focus:outline-2"],
    ["peer-has-focus-visible:outline-2"],
    ["data-focus:outline-2"],
    ["data-focus-visible:outline-2"],
    ["group-data-focus:outline-2"],
    ["focus-visible:[outline:2px_solid_red]"],
    ["focus:[outline-width:2px]"],
    ["[&:focus-visible]:[outline:none]"],
    ["[&[data-x='y']:focus]:outline-2"],
    [`className="px-2 [&[data-state='open']:focus-visible]:outline-2"`],
    ["focus:outline-(length:--w)"],
    ["focus-visible:outline-(color:--c)"],
    ["focus:outline-(--c)"],
    ["data-[focus]:outline-2"],
    ["data-[focus=true]:outline-2"],
    ["group-data-[focus-visible]:outline-2"],
    ["focus:-[outline-offset:2px]"],
    ["in-data-[focus]:outline-2"],
    ["has-data-[focus]:outline-2"],
    ["peer-has-data-[focus-visible]:outline-2"],
    ["data-[focus~=x]:outline-2"],
    ["data-[focus^=t]:outline-2"],
    ["data-[focus*=a]:outline-2"],
    ["data-[focus_=_true]:outline-2"],
    ["in-[[data-focus]]:outline-2"],
    ["group-[[data-focus-visible]]:outline-2"],
    ["group-focus-visible/[item]:outline-2"],
    ["peer-data-[focus]/[field]:outline-2"],
  ])(
    "#given the hand-rolled focus outline %s #when scanned #then the guard catches it",
    (source) => {
      expect(hasHandRolledFocusOutline(source)).toBe(true)
    },
  )

  test.each([
    ["focus-ring"],
    ["focus-ring-inset"],
    ["outline-none"],
    ["md:outline-offset-2"],
    ["hover:outline-2"],
    ["group-hover:outline-2"],
    ["[&:hover]:outline-2"],
    ["focus:bg-ink-3"],
    ["focus-visible:ring-2"],
    ["focus-visible:underline"],
    ["// the focus outline comes from the recipe"],
    ["[outline:none]"],
    ["focus:[color:red]"],
    ["has-checked:outline-2"],
    ["data-active:outline-2"],
    ["[&:focusable]:outline-2"],
    ["data-[state=open]:outline-2"],
    ["data-[focused-item]:outline-2"],
    ["in-data-[state=open]:outline-2"],
    ["group-[[data-state=open]]:outline-2"],
    ["group-hover/[item]:outline-2"],
  ])("#given the non-violation %s #when scanned #then the guard leaves it alone", (source) => {
    expect(hasHandRolledFocusOutline(source)).toBe(false)
  })

  test("#given the components #when scanned #then every focus outline comes from the focus-ring utilities", () => {
    expect(offendingLines(hasHandRolledFocusOutline)).toEqual([])
  })
})
