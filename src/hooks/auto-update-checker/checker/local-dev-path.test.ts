import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { getLocalDevPath } from "./local-dev-path"

describe("getLocalDevPath", () => {
  let temporaryDirectory: string
  let configPath: string

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "omo-local-dev-path-test-"))
    const opencodeDirectory = path.join(temporaryDirectory, ".opencode")
    fs.mkdirSync(opencodeDirectory, { recursive: true })
    configPath = path.join(opencodeDirectory, "opencode.json")
  })

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  test("returns repo paths for local-dev file entries", () => {
    const localDevEntry = pathToFileURL(path.join(temporaryDirectory, "oh-my-opencode", "dist", "index.js")).toString()
    fs.writeFileSync(configPath, JSON.stringify({ plugin: [localDevEntry] }))

    expect(getLocalDevPath(temporaryDirectory)).toBe(path.join(temporaryDirectory, "oh-my-opencode", "dist", "index.js"))
  })

  test("ignores installer-managed node_modules entries", () => {
    const managedEntry = pathToFileURL(path.join(temporaryDirectory, ".opencode", "node_modules", "oh-my-opencode", "dist", "index.js")).toString()
    fs.writeFileSync(configPath, JSON.stringify({ plugin: [managedEntry] }))

    expect(getLocalDevPath(temporaryDirectory)).toBeNull()
  })
})
