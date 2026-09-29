import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadOrCreateToken, offeredToken, tokenMatches, tokenPathFor } from "./token"

const temp = (): string => mkdtempSync(join(tmpdir(), "huddle-token-"))

test("the token file is created readable by its owner alone and reused afterwards", () => {
  const dir = temp()
  try {
    const path = tokenPathFor(dir)
    const token = loadOrCreateToken(path)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(loadOrCreateToken(path)).toBe(token)
    expect(readFileSync(path, "utf8").trim()).toBe(token)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a token file other local users could read is tightened, not trusted as it is", () => {
  const dir = temp()
  try {
    const path = tokenPathFor(dir)
    const first = loadOrCreateToken(path)
    chmodSync(path, 0o644)
    expect(statSync(path).mode & 0o077).not.toBe(0)
    expect(loadOrCreateToken(path)).toBe(first)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("an empty token file is replaced rather than accepted", () => {
  const dir = temp()
  try {
    const path = tokenPathFor(dir)
    loadOrCreateToken(path)
    writeFileSync(path, "   \n", { mode: 0o600 })
    expect(loadOrCreateToken(path)).toMatch(/^[0-9a-f]{64}$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("only an exactly matching token is accepted", () => {
  expect(tokenMatches("abcdef", "abcdef")).toBe(true)
  expect(tokenMatches("abcdef", "abcdeg")).toBe(false)
  expect(tokenMatches("abcdef", "abcde")).toBe(false)
  expect(tokenMatches("abcdef", "")).toBe(false)
  expect(tokenMatches("abcdef", null)).toBe(false)
})

test("a token may travel as a bearer header or a websocket subprotocol, never as a query parameter", () => {
  expect(offeredToken(new Headers({ authorization: "Bearer s3cret" }))).toBe("s3cret")
  expect(offeredToken(new Headers({ authorization: "bearer s3cret" }))).toBe("s3cret")
  expect(offeredToken(new Headers({ "sec-websocket-protocol": "omo-huddle.s3cret" }))).toBe("s3cret")
  expect(offeredToken(new Headers({ "sec-websocket-protocol": "chat, omo-huddle.s3cret" }))).toBe("s3cret")
  expect(offeredToken(new Headers({ authorization: "Basic s3cret" }))).toBeNull()
  expect(offeredToken(new Headers())).toBeNull()
})
