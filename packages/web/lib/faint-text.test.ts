import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import ts from "typescript"

import { contrastRatio, readRootTokens, resolveColor } from "./design-tokens"

const WEB_ROOT = join(import.meta.dir, "..")
const INKS = ["--ink-0", "--ink-1", "--ink-2", "--ink-3"] as const
const FAINT = "text-text-faint"

function sourceFiles(root: string): readonly string[] {
  return ["app", "components"].flatMap((directory) =>
    readdirSync(join(root, directory), { withFileTypes: true, recursive: true })
      .filter(
        (entry) =>
          entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name),
      )
      .map((entry) => join(entry.parentPath, entry.name)),
  )
}

function isAriaHidden(element: ts.JsxOpeningLikeElement): boolean {
  return element.attributes.properties.some((attribute) => {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== "aria-hidden") return false
    const value = attribute.initializer
    if (value === undefined) return true
    if (ts.isStringLiteral(value)) return value.text === "true"
    return ts.isJsxExpression(value) && value.expression?.kind === ts.SyntaxKind.TrueKeyword
  })
}

/** A faint class counts as decoration only inside the className of an element that is itself aria-hidden. */
function isDecoration(literal: ts.Node): boolean {
  for (let node: ts.Node = literal; !ts.isSourceFile(node); node = node.parent) {
    if (ts.isJsxAttribute(node)) {
      return node.name.getText() === "className" && isAriaHidden(node.parent.parent)
    }
  }
  return false
}

function exposedFaintLines(source: string, fileName: string): readonly number[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      if (node.text.includes(FAINT) && !isDecoration(node)) {
        lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return lines
}

function scanTree(root: string): readonly string[] {
  return sourceFiles(root).flatMap((file) =>
    exposedFaintLines(readFileSync(file, "utf8"), file).map(
      (line) => `${relative(root, file)}:${line}`,
    ),
  )
}

describe("receded text role", () => {
  test.each(INKS)(
    "#given --text-lo, the colour receded and dimmed text uses #when drawn on %s #then it meets the 4.5:1 text contrast of WCAG 1.4.3",
    (ink) => {
      const tokens = readRootTokens()

      const ratio = contrastRatio(resolveColor(tokens, "--text-lo"), resolveColor(tokens, ink))

      expect(ratio).toBeGreaterThanOrEqual(4.5)
    },
  )
})

describe("--text-faint, the DESIGN.md \u00a72 decoration-only token contract", () => {
  test.each([
    [
      "a constant outside JSX after an aria-hidden tag",
      "row.tsx",
      `const dot = <span aria-hidden="true" />\nconst label = "${FAINT}"\nexport const b = <p className={label}>y</p>`,
    ],
    ["an element that is not hidden", "row.tsx", `export const b = <p className="${FAINT}">y</p>`],
    [
      "a hidden attribute on a different element",
      "row.tsx",
      `export const b = <div aria-hidden="true"><p className="${FAINT}">y</p></div>`,
    ],
  ])(
    "#given %s #when classified #then the faint class is reported as exposed",
    (_case, fileName, source) => {
      expect(exposedFaintLines(source, fileName)).not.toEqual([])
    },
  )

  test.each([
    [
      'aria-hidden="true"',
      `export const b = <span aria-hidden="true" className="${FAINT}">x</span>`,
    ],
    [
      "aria-hidden={true}",
      `export const b = <span aria-hidden={true} className={cn("a", "${FAINT}")}>x</span>`,
    ],
    [
      "a bare aria-hidden",
      `export const b = <span className={\`a ${FAINT}\`} aria-hidden>x</span>`,
    ],
  ])(
    "#given %s on the same element #when classified #then the faint class counts as decoration",
    (_case, source) => {
      expect(exposedFaintLines(source, "row.tsx")).toEqual([])
    },
  )

  test("#given a faint class in a .ts class table #when the tree is scanned #then it is reported", () => {
    const root = mkdtempSync(join(tmpdir(), "faint-scan-"))
    try {
      mkdirSync(join(root, "app"))
      mkdirSync(join(root, "components"))
      writeFileSync(
        join(root, "components", "status.ts"),
        `export const pending = { textClass: "${FAINT}" }\n`,
      )

      expect(scanTree(root)).toEqual(["components/status.ts:1"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given app and components (.ts and .tsx) #when scanned #then every text-text-faint is decoration hidden from assistive technology", () => {
    expect(scanTree(WEB_ROOT)).toEqual([])
  })
})
