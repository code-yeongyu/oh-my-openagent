/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { prependResolvedOpencodeBinToPath } from "./opencode-bin-path"

describe("prependResolvedOpencodeBinToPath", () => {
  it("prepends resolved opencode-ai bin path to PATH", () => {
    //#given
    const env: Record<string, string | undefined> = {
      PATH: "/Users/yeongyu/node_modules/.bin:/usr/bin",
    }
    const resolver = () => "/tmp/bunx-123/node_modules/opencode-ai/bin/opencode"

    //#when
    prependResolvedOpencodeBinToPath(env, resolver)

    //#then
    expect(env.PATH).toBe(
      "/tmp/bunx-123/node_modules/opencode-ai/bin:/Users/yeongyu/node_modules/.bin:/usr/bin",
    )
  })

  it("does not duplicate an existing opencode-ai bin path", () => {
    //#given
    const env: Record<string, string | undefined> = {
      PATH: "/tmp/bunx-123/node_modules/opencode-ai/bin:/usr/bin",
    }
    const resolver = () => "/tmp/bunx-123/node_modules/opencode-ai/bin/opencode"

    //#when
    prependResolvedOpencodeBinToPath(env, resolver)

    //#then
    expect(env.PATH).toBe("/tmp/bunx-123/node_modules/opencode-ai/bin:/usr/bin")
  })

  it("keeps PATH unchanged when opencode-ai cannot be resolved", () => {
    //#given
    const env: Record<string, string | undefined> = {
      PATH: "/Users/yeongyu/node_modules/.bin:/usr/bin",
    }
    const resolver = () => {
      throw new Error("module not found")
    }

    //#when
    prependResolvedOpencodeBinToPath(env, resolver)

    //#then
    expect(env.PATH).toBe("/Users/yeongyu/node_modules/.bin:/usr/bin")
  })
})
