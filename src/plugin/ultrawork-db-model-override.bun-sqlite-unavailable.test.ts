import { describe, expect, test } from "bun:test"

describe("scheduleDeferredModelOverride bun:sqlite unavailable", () => {
  test("#given source code #when inspected #then bun:sqlite is loaded dynamically with an unavailable-runtime fallback", async () => {
    //#given
    const source = await Bun.file(new URL("./ultrawork-db-model-override.ts", import.meta.url)).text()

    //#when
    const hasStaticBunSqliteImport = source.includes('from "bun:sqlite"')
      || source.includes("from 'bun:sqlite'")
      || source.includes('import "bun:sqlite"')
      || source.includes("import 'bun:sqlite'")

    //#then
    expect(hasStaticBunSqliteImport).toBe(false)
    expect(source).toContain('await import("bun:sqlite").catch(() => null)')
    expect(source).toContain("bun:sqlite unavailable")
    expect(source).toContain("return")
  })
})
