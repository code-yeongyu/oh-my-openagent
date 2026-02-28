import { describe, expect, test } from "bun:test"
import { extractDirectoryPrefix } from "./extract-directory-prefix"

describe("extractDirectoryPrefix", () => {
  describe("#given a pattern with directory prefix before glob metacharacters", () => {
    test("#then extracts the prefix and returns the remaining glob", () => {
      expect(extractDirectoryPrefix("apps/backend/**/*.ts")).toEqual({
        prefix: "apps/backend",
        glob: "**/*.ts",
      })
    })

    test("#then handles brace expansion after prefix", () => {
      expect(extractDirectoryPrefix("apps/backend/**/*.{ts,js,json}")).toEqual({
        prefix: "apps/backend",
        glob: "**/*.{ts,js,json}",
      })
    })

    test("#then handles single directory prefix", () => {
      expect(extractDirectoryPrefix("src/**/*.tsx")).toEqual({
        prefix: "src",
        glob: "**/*.tsx",
      })
    })

    test("#then handles deep prefix", () => {
      expect(extractDirectoryPrefix("packages/core/src/**/*.ts")).toEqual({
        prefix: "packages/core/src",
        glob: "**/*.ts",
      })
    })

    test("#then handles brace expansion in the first glob segment", () => {
      expect(extractDirectoryPrefix("src/{hooks,components}/**/*.tsx")).toEqual({
        prefix: "src",
        glob: "{hooks,components}/**/*.tsx",
      })
    })

    test("#then handles question mark metacharacter", () => {
      expect(extractDirectoryPrefix("src/component?/**/*.ts")).toEqual({
        prefix: "src",
        glob: "component?/**/*.ts",
      })
    })

    test("#then handles bracket metacharacter", () => {
      expect(extractDirectoryPrefix("src/[a-z]omponents/**/*.ts")).toEqual({
        prefix: "src",
        glob: "[a-z]omponents/**/*.ts",
      })
    })
  })

  describe("#given a pattern without directory prefix", () => {
    test("#then returns empty prefix for **/ patterns", () => {
      expect(extractDirectoryPrefix("**/*.ts")).toEqual({
        prefix: "",
        glob: "**/*.ts",
      })
    })

    test("#then returns empty prefix for simple wildcard", () => {
      expect(extractDirectoryPrefix("*.ts")).toEqual({
        prefix: "",
        glob: "*.ts",
      })
    })

    test("#then returns empty prefix for brace-only pattern", () => {
      expect(extractDirectoryPrefix("*.{ts,js}")).toEqual({
        prefix: "",
        glob: "*.{ts,js}",
      })
    })
  })

  describe("#given a fully literal pattern (no metacharacters)", () => {
    test("#then returns the pattern as-is with empty prefix", () => {
      expect(extractDirectoryPrefix("src/components/Button.tsx")).toEqual({
        prefix: "",
        glob: "src/components/Button.tsx",
      })
    })

    test("#then handles single filename", () => {
      expect(extractDirectoryPrefix("package.json")).toEqual({
        prefix: "",
        glob: "package.json",
      })
    })
  })
})
