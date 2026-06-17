import { describe, expect, it } from "bun:test"
import { normalizeDiffPatch, normalizeLine } from "./normalize"

describe("silent fallback guard normalization", () => {
  it("masks string literals before operator detection input is produced", () => {
    const line = normalizeLine(' const msg = "a || b"', "typescript")

    expect(line.code).toBe("const msg = <string>")
    expect(line.normalized.includes("||")).toBe(false)
  })

  it("treats comment-only JS lines as non-executable code", () => {
    const line = normalizeLine(" // foo || bar", "typescript")

    expect(line.code).toBe("")
    expect(line.normalized).toBe("")
    expect(line.comment).toBe("// foo || bar")
  })

  it("keeps executable fallback operators while preserving raw and inline comment context", () => {
    const patch = [
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -10,0 +10,1 @@",
      '+ const x = foo || "bar" // fallback',
    ].join("\n")

    const lines = normalizeDiffPatch(patch, { language: "typescript" })

    expect(lines.length).toBe(1)
    expect(lines[0].file).toBe("src/example.ts")
    expect(lines[0].lineNumber).toBe(10)
    expect(lines[0].raw).toBe(' const x = foo || "bar" // fallback')
    expect(lines[0].code).toBe("const x = foo || <string>")
    expect(lines[0].normalized).toBe("const x = foo || <string>")
    expect(lines[0].comment).toBe("// fallback")
  })

  it("normalizes tabbed and spaced variants to the same detector input", () => {
    const tabbed = normalizeLine("\tconst\tx\t=\tfoo\t||\t\"bar\"", "typescript")
    const spaced = normalizeLine('   const x = foo   ||   "bar"', "typescript")

    expect(tabbed.normalized).toBe("const x = foo || <string>")
    expect(spaced.normalized).toBe("const x = foo || <string>")
    expect(tabbed.normalized).toBe(spaced.normalized)
  })

  it("provides bounded hunk context for adjacent catch return fallbacks", () => {
    const patch = [
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -20,0 +20,4 @@",
      "+try {",
      "+  risky();",
      "+} catch (error) {",
      "+  return [];",
    ].join("\n")

    const lines = normalizeDiffPatch(patch, { language: "typescript" })
    const returnLine = lines.find((line) => line.normalized === "return [];")

    expect(returnLine).toBeDefined()
    expect(returnLine?.lineNumber).toBe(23)
    expect(returnLine?.hunkContext.some((line) => line.normalized === "} catch (error) {")).toBe(true)
  })

  it("splits Python comments without treating hashes inside strings as comments", () => {
    const commentOnly = normalizeLine(" # foo or bar", "python")
    const inline = normalizeLine(' value = row.get("field#id") or "unknown" # fallback', "python")

    expect(commentOnly.code).toBe("")
    expect(commentOnly.comment).toBe("# foo or bar")
    expect(inline.code).toBe("value = row.get(<string>) or <string>")
    expect(inline.comment).toBe("# fallback")
  })

  it("infers Python comment syntax from diff file paths", () => {
    const patch = [
      "diff --git a/src/example.py b/src/example.py",
      "--- a/src/example.py",
      "+++ b/src/example.py",
      "@@ -4,0 +4,1 @@",
      '+ value = row.get("field") or "unknown" # fallback',
    ].join("\n")

    const lines = normalizeDiffPatch(patch)

    expect(lines[0].file).toBe("src/example.py")
    expect(lines[0].code).toBe("value = row.get(<string>) or <string>")
    expect(lines[0].comment).toBe("# fallback")
  })
})
