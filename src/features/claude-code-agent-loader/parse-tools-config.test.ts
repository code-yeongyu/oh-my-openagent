/// <reference types="bun-types" />

import { describe, it, expect } from "bun:test"
import { parseToolsConfig } from "./loader"

describe("parseToolsConfig (agent-loader)", () => {
  describe("#given undefined or empty input", () => {
    it("#when called with undefined #then returns undefined", () => {
      expect(parseToolsConfig(undefined)).toBeUndefined()
    })

    it("#when called with empty string #then returns undefined", () => {
      expect(parseToolsConfig("")).toBeUndefined()
    })
  })

  describe("#given CSV string input", () => {
    it("#when called with comma-separated tools #then returns boolean map", () => {
      expect(parseToolsConfig("Read, Bash, Glob")).toEqual({
        read: true,
        bash: true,
        glob: true,
      })
    })

    it("#when called with single tool #then returns single-entry map", () => {
      expect(parseToolsConfig("Read")).toEqual({ read: true })
    })

    it("#when called with extra whitespace #then trims values", () => {
      expect(parseToolsConfig("  Read ,  Bash  ")).toEqual({
        read: true,
        bash: true,
      })
    })

    it("#when called with trailing comma #then ignores empty entries", () => {
      expect(parseToolsConfig("Read,Bash,")).toEqual({
        read: true,
        bash: true,
      })
    })
  })

  describe("#given YAML array input", () => {
    it("#when called with string array #then returns boolean map", () => {
      expect(parseToolsConfig(["Read", "Bash", "Glob"])).toEqual({
        read: true,
        bash: true,
        glob: true,
      })
    })

    it("#when called with single-element array #then returns single-entry map", () => {
      expect(parseToolsConfig(["Read"])).toEqual({ read: true })
    })

    it("#when called with empty array #then returns undefined", () => {
      expect(parseToolsConfig([])).toBeUndefined()
    })

    it("#when called with whitespace-padded entries #then trims values", () => {
      expect(parseToolsConfig(["  Read ", " Bash  "])).toEqual({
        read: true,
        bash: true,
      })
    })
  })

  describe("#given mixed-case input", () => {
    it("#when string has uppercase #then lowercases keys", () => {
      expect(parseToolsConfig("READ, BASH")).toEqual({
        read: true,
        bash: true,
      })
    })

    it("#when array has mixed case #then lowercases keys", () => {
      expect(parseToolsConfig(["Read", "BASH", "glob"])).toEqual({
        read: true,
        bash: true,
        glob: true,
      })
    })
  })
})
