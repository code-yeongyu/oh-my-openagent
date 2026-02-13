import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { resolvePromptAppend } from "./resolve-file-uri"

describe("resolvePromptAppend", () => {
  const fixtureRoot = join(tmpdir(), `resolve-file-uri-${Date.now()}`)
  const configDir = join(fixtureRoot, "config")
  const homeFixtureDir = join(homedir(), `.resolve-file-uri-home-${Date.now()}`)

  const absoluteFilePath = join(fixtureRoot, "absolute.txt")
  const relativeFilePath = join(configDir, "relative.txt")
  const spacedFilePath = join(fixtureRoot, "with space.txt")
  const homeFilePath = join(homeFixtureDir, "home.txt")

  beforeAll(() => {
    mkdirSync(fixtureRoot, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    mkdirSync(homeFixtureDir, { recursive: true })

    writeFileSync(absoluteFilePath, "absolute-content", "utf8")
    writeFileSync(relativeFilePath, "relative-content", "utf8")
    writeFileSync(spacedFilePath, "encoded-content", "utf8")
    writeFileSync(homeFilePath, "home-content", "utf8")
  })

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true })
    rmSync(homeFixtureDir, { recursive: true, force: true })
  })

  test("returns non-file URI strings unchanged", () => {
    //#given
    const input = "append this text"

    //#when
    const resolved = resolvePromptAppend(input)

    //#then
    expect(resolved).toBe(input)
  })

  test("resolves absolute file URI to file contents", () => {
    //#given
    const input = `file://${absoluteFilePath}`

    //#when
    const resolved = resolvePromptAppend(input)

    //#then
    expect(resolved).toBe("absolute-content")
  })

  test("resolves relative file URI using configDir", () => {
    //#given
    const input = "file://./relative.txt"

    //#when
    const resolved = resolvePromptAppend(input, configDir)

    //#then
    expect(resolved).toBe("relative-content")
  })

  test("resolves home directory URI path", () => {
    //#given
    const input = `file://~/${homeFixtureDir.split("/").pop()}/home.txt`

    //#when
    const resolved = resolvePromptAppend(input)

    //#then
    expect(resolved).toBe("home-content")
  })

  test("resolves percent-encoded URI path", () => {
    //#given
    const input = `file://${encodeURIComponent(spacedFilePath)}`

    //#when
    const resolved = resolvePromptAppend(input)

    //#then
    expect(resolved).toBe("encoded-content")
  })

  test("returns warning for malformed percent-encoding", () => {
    //#given
    const input = "file://%E0%A4%A"

    //#when
    const resolved = resolvePromptAppend(input)

    //#then
    expect(resolved).toContain("[WARNING: Malformed file URI")
  })

  test("returns warning when file does not exist", () => {
    //#given
    const input = "file:///path/does/not/exist.txt"

    //#when
    const resolved = resolvePromptAppend(input)

    //#then
    expect(resolved).toContain("[WARNING: Could not resolve file URI")
  })
})
