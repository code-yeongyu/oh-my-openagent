import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isOwnEndpoint } from "./own-endpoint"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function spellings(): { readonly real: string; readonly alias: string } {
  const root = mkdtempSync(join(tmpdir(), "dh-t7-own-"))
  dirs.push(root)
  const real = join(root, "real")
  mkdirSync(real)
  const alias = join(root, "alias")
  symlinkSync(real, alias)
  return { real, alias }
}

describe("isOwnEndpoint", () => {
  test("#given the own socket and a record naming it through a symlinked directory #when compared #then it is the own endpoint", () => {
    const { real, alias } = spellings()
    expect(isOwnEndpoint(join(alias, "p-a.sock"), join(real, "p-a.sock"))).toBe(true)
  })

  test("#given a shard directory that does not exist yet #when its socket is spelled through a symlinked ancestor #then it is still the own endpoint", () => {
    const { real, alias } = spellings()
    expect(isOwnEndpoint(join(alias, "rpc", "shards", "p-a.sock"), join(real, "rpc", "shards", "p-a.sock"))).toBe(true)
  })

  test("#given a missing directory spelled with a dot-dot segment #when compared #then the lexical spellings agree", () => {
    const { real } = spellings()
    expect(isOwnEndpoint(`${real}/gone/../shards/p-a.sock`, join(real, "shards", "p-a.sock"))).toBe(true)
  })

  test("#given a different socket in the same directory #when compared #then it is not the own endpoint", () => {
    const { real, alias } = spellings()
    expect(isOwnEndpoint(join(alias, "shards", "p-b.sock"), join(real, "shards", "p-a.sock"))).toBe(false)
  })

  test("#given a session that lives behind no host #when compared #then nothing is its own endpoint", () => {
    const { real } = spellings()
    expect(isOwnEndpoint(join(real, "p-a.sock"), undefined)).toBe(false)
  })
})
