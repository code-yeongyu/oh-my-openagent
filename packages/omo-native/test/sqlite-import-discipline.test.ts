import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const TEST_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)))
const GATEWAY_DIR = resolve(TEST_DIR, "../../omo-senpi/src/components/thread/gateway")
const STATIC_SQLITE_IMPORT = /^\s*import\s[^\n]*from\s+["']node:sqlite["']/m
const THREAD_CLI = resolve(TEST_DIR, "../bin/lib/thread.js")

describe("node:sqlite import discipline", () => {
  describe("#given the packaged test suite", () => {
    describe("#when each test module is scanned", () => {
      test("#then no suite imports node:sqlite statically", () => {
        const offenders = readdirSync(TEST_DIR)
          .filter((name) => name.endsWith(".test.ts"))
          .filter((name) => STATIC_SQLITE_IMPORT.test(readFileSync(join(TEST_DIR, name), "utf8")))
        expect(offenders).toEqual([])
      })
    })
  })

  describe("#given the omo thread CLI", () => {
    describe("#when its module is scanned", () => {
      test("#then it reaches node:sqlite only through a lazy import", () => {
        const source = readFileSync(THREAD_CLI, "utf8")
        expect({ static: STATIC_SQLITE_IMPORT.test(source), lazy: source.includes('import("node:sqlite")') }).toEqual({ static: false, lazy: true })
      })
    })
  })

  describe("#given the thread gateway store", () => {
    describe("#when every gateway module is scanned", () => {
      test("#then only the store worker reaches node:sqlite, through a lazy import", () => {
        const modules = readdirSync(GATEWAY_DIR, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".ts"))
        const offenders = modules.filter((name) => STATIC_SQLITE_IMPORT.test(readFileSync(join(GATEWAY_DIR, name), "utf8")))
        const lazy = modules.filter((name) => readFileSync(join(GATEWAY_DIR, name), "utf8").includes('import("node:sqlite")'))
        expect({ offenders, lazy }).toEqual({ offenders: [], lazy: ["store-worker.ts"] })
      })
    })
  })
})
