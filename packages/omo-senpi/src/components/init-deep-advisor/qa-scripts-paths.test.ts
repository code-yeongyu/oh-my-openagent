/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const COMPONENT_DIR = import.meta.dir
const ABSOLUTE_LOCAL_PATH = /(?:^|[\s"'`=(:])\/(?:Volumes|Users)\/[^\s"'`]+/gm

function qaScripts(): string[] {
  return readdirSync(COMPONENT_DIR)
    .filter((name) => name.startsWith("qa-") && !name.endsWith(".test.ts"))
    .sort()
}

describe("init-deep advisor QA scripts", () => {
  test("#given the component QA scripts #when scanned #then none pins an absolute local machine path", () => {
    const scripts = qaScripts()
    expect(scripts).toContain("qa-rpc-driver.mjs")
    expect(scripts).toContain("qa-sandbox.sh")

    const findings = scripts.flatMap((name) => {
      const source = readFileSync(join(COMPONENT_DIR, name), "utf8")
      return [...source.matchAll(ABSOLUTE_LOCAL_PATH)].map((match) => `${name}: ${match[0].trim()}`)
    })

    expect(findings).toEqual([])
  })
})
