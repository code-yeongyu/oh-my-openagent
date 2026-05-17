/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import {
  detectLanguageSpecificMistake,
  detectRegexMisuse,
  getPatternHint,
} from "./pattern-hints"

describe("detectRegexMisuse", () => {
  describe("#given pure regex alternation", () => {
    it("#when pattern is lowercase alternation #then returns alternation hint", () => {
      // given
      const pattern = "watch|WatchMode|--watch"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).not.toBeNull()
      expect(hint).toContain("|")
      expect(hint).toContain("alternation")
      expect(hint).toContain("grep")
    })

    it("#when pattern is camelCase alternation #then returns alternation hint", () => {
      // given
      const pattern = "noEmit|NoEmit"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).toContain("alternation")
    })

    it("#when pattern mixes wildcard and alternation #then returns a hint", () => {
      // given
      const pattern = "func.*build|BuildMode|projectReferences"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).not.toBeNull()
    })
  })

  describe("#given valid AST patterns using |", () => {
    it("#when pattern uses meta-vars around pipe (bitwise OR) #then returns null", () => {
      // given
      const pattern = "$A | $B"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).toBeNull()
    })

    it("#when pattern is a Rust closure #then returns null", () => {
      // given
      const pattern = "|x| x + 1"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).toBeNull()
    })
  })

  describe("#given regex escape sequences", () => {
    it("#when pattern contains \\w #then returns regex-escape hint", () => {
      // given
      const pattern = "\\w+Mode"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).toContain("regex escape")
      expect(hint).toContain("grep")
    })

    it("#when pattern contains \\d #then returns regex-escape hint", () => {
      // given
      const pattern = "id\\d+"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).toContain("regex escape")
    })
  })

  describe("#given character class ranges", () => {
    it("#when pattern contains [a-z] #then returns character-class hint", () => {
      // given
      const pattern = "[a-z]+Mode"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).toContain("character classes")
      expect(hint).toContain("grep")
    })

    it("#when pattern contains [0-9] #then returns character-class hint", () => {
      // given
      const pattern = "v[0-9]+"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).toContain("character classes")
    })
  })

  describe("#given regex wildcards embedded in identifiers", () => {
    it("#when pattern uses foo.*bar without meta-vars #then returns wildcard hint", () => {
      // given
      const pattern = "func.*build"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).toContain("regex wildcards")
      expect(hint).toContain("$$$")
    })

    it("#when pattern uses $$$ (proper AST) #then returns null", () => {
      // given
      const pattern = "func $NAME($$$) { $$$ }"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).toBeNull()
    })
  })

  describe("#given legitimate AST patterns", () => {
    it("#when pattern is a JS function #then returns null", () => {
      // given
      const pattern = "function $NAME($$$) { $$$ }"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).toBeNull()
    })

    it("#when pattern is console.log call #then returns null", () => {
      // given
      const pattern = "console.log($$$)"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).toBeNull()
    })

    it("#when pattern is a Python def #then returns null", () => {
      // given
      const pattern = "def $FUNC($$$)"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).toBeNull()
    })

    it("#when pattern is array access a[0] #then returns null (not character class)", () => {
      // given
      const pattern = "$A[0]"

      // when
      const hint = detectRegexMisuse(pattern)

      // then
      expect(hint).toBeNull()
    })
  })
})

describe("detectLanguageSpecificMistake", () => {
  describe("#given a Python def with trailing colon", () => {
    it("#when lang is python #then suggests removing the colon", () => {
      // given
      const pattern = "def $FUNC($$$):"

      // when
      const hint = detectLanguageSpecificMistake(pattern, "python")

      // then
      expect(hint).toContain("Remove trailing colon")
      expect(hint).toContain("def $FUNC($$$)")
    })
  })

  describe("#given a Python class with trailing colon", () => {
    it("#when lang is python #then suggests removing the colon", () => {
      // given
      const pattern = "class $C:"

      // when
      const hint = detectLanguageSpecificMistake(pattern, "python")

      // then
      expect(hint).toContain("Remove trailing colon")
    })
  })

  describe("#given a TypeScript function with no body", () => {
    it("#when lang is typescript #then suggests adding params and body", () => {
      // given
      const pattern = "function $NAME"

      // when
      const hint = detectLanguageSpecificMistake(pattern, "typescript")

      // then
      expect(hint).toContain("params and body")
      expect(hint).toContain("function $NAME($$$) { $$$ }")
    })
  })

  describe("#given a Go function with no body", () => {
    it("#when lang is go #then suggests Go function template", () => {
      // given
      const pattern = "func $NAME"

      // when
      const hint = detectLanguageSpecificMistake(pattern, "go")

      // then
      expect(hint).not.toBeNull()
      expect(hint).toContain("func $NAME($$$) { $$$ }")
    })
  })

  describe("#given a Rust fn with no body", () => {
    it("#when lang is rust #then suggests Rust fn template", () => {
      // given
      const pattern = "fn $NAME"

      // when
      const hint = detectLanguageSpecificMistake(pattern, "rust")

      // then
      expect(hint).not.toBeNull()
      expect(hint).toContain("fn $NAME($$$) { $$$ }")
    })
  })
})

describe("getPatternHint", () => {
  it("#given regex alternation #when composing #then regex hint wins over language check", () => {
    // given
    const pattern = "foo|bar"

    // when
    const hint = getPatternHint(pattern, "typescript")

    // then
    expect(hint).toContain("alternation")
  })

  it("#given a clean AST pattern #when composing #then returns null", () => {
    // given
    const pattern = "function $NAME($$$) { $$$ }"

    // when
    const hint = getPatternHint(pattern, "typescript")

    // then
    expect(hint).toBeNull()
  })

  it("#given a Python def with trailing colon #when composing #then returns the colon hint", () => {
    // given
    const pattern = "def $FUNC($$$):"

    // when
    const hint = getPatternHint(pattern, "python")

    // then
    expect(hint).toContain("Remove trailing colon")
  })
})
