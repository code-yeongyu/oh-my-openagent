import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseOpenCodeConfigFileWithError } from "./parse-opencode-config-file"

describe("parseOpenCodeConfigFileWithError", () => {
  const tempDirectories: string[] = []

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("#given a valid object config #when parsing the file #then it returns the parsed config", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "omo-parse-config-"))
    tempDirectories.push(directory)
    const filePath = join(directory, "opencode.json")
    writeFileSync(filePath, '{"plugin": ["oh-my-openagent"]}\n', "utf-8")

    // when
    const result = parseOpenCodeConfigFileWithError(filePath)

    // then
    expect(result).toEqual({
      config: { plugin: ["oh-my-openagent"] },
    })
  })

  test("#given a null config payload #when parsing the file #then it returns a null parse error", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "omo-parse-config-"))
    tempDirectories.push(directory)
    const filePath = join(directory, "opencode.json")
    writeFileSync(filePath, "null\n", "utf-8")

    // when
    const result = parseOpenCodeConfigFileWithError(filePath)

    // then
    expect(result).toEqual({
      config: null,
      error: `Config file parsed to null/undefined: ${filePath}. Ensure it contains valid JSON.`,
    })
  })
})
