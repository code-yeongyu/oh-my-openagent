/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { parseNpmPackPaths } from "./npm-pack-paths.mjs"

const npm11Output = JSON.stringify([{ id: "oh-my-opencode@5.0.0", files: [{ path: "package.json" }, { path: "bin/omo.js" }] }])
const npm12Output = JSON.stringify({
  "oh-my-opencode": { id: "oh-my-opencode@5.0.0", files: [{ path: "package.json" }, { path: "bin/omo.js" }] },
})

describe("npm pack path reader", () => {
  test("#given npm 11 array output #when packed paths are read #then every packed path is returned", () => {
    // given / when
    const paths = parseNpmPackPaths(npm11Output)

    // then
    expect(paths).toEqual(["package.json", "bin/omo.js"])
  })

  test("#given npm 12 object output keyed by package name #when packed paths are read #then the same paths are returned", () => {
    // given / when
    const paths = parseNpmPackPaths(npm12Output)

    // then
    expect(paths).toEqual(parseNpmPackPaths(npm11Output))
  })

  test("#given output of neither shape #when packed paths are read #then it fails naming npm pack instead of throwing on undefined", () => {
    // given
    const malformed = ["[]", "{}", "null", '{"pkg":{"id":"x"}}']

    // when / then
    for (const raw of malformed) {
      expect(() => parseNpmPackPaths(raw)).toThrow("npm pack --json returned no packed file list")
    }
  })

  test("#given output that is not JSON at all #when packed paths are read #then it fails naming npm pack rather than raising a bare SyntaxError", () => {
    // given
    const notJson = ["", "npm warn config production Use --omit=dev instead."]

    // when / then
    for (const raw of notJson) {
      expect(() => parseNpmPackPaths(raw)).toThrow("npm pack --json did not return JSON")
    }
  })

  test("#given a packed entry without a string path #when packed paths are read #then it fails naming the entry", () => {
    // given
    const rawEntry = JSON.stringify([{ id: "x", files: [{ path: "package.json" }, { size: 12 }] }])

    // when / then
    expect(() => parseNpmPackPaths(rawEntry)).toThrow("packed entry without a string path")
  })
})
