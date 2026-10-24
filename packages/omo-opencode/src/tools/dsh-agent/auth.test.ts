/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveDshAuth } from "./auth"

function writeFakeAuth(dir: string): string {
  const authPath = join(dir, "auth.json")
  writeFileSync(
    authPath,
    JSON.stringify({ "opencode-go": { type: "api", key: "sk-fake-opencode-go-key" } }),
  )
  return authPath
}

describe("resolveDshAuth", () => {
  test("#given explicit DEEPSEEK env vars #when resolved #then they win over the auth store", () => {
    // given / when
    const auth = resolveDshAuth({
      DEEPSEEK_API_KEY: "sk-explicit",
      DEEPSEEK_BASE_URL: "https://custom/v1",
      DSH_MODEL: "deepseek-v4-pro",
    } as NodeJS.ProcessEnv)

    // then
    expect(auth.apiKey).toBe("sk-explicit")
    expect(auth.baseUrl).toBe("https://custom/v1")
    expect(auth.model).toBe("deepseek-v4-pro")
  })

  test("#given an opencode-go key in the auth store #when resolved #then the opencode-go endpoint defaults are used", () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), "dsh-auth-"))
    const authPath = writeFakeAuth(dir)

    // when
    const auth = resolveDshAuth({ OPENCODE_AUTH_PATH: authPath } as NodeJS.ProcessEnv)

    // then
    expect(auth.apiKey).toBe("sk-fake-opencode-go-key")
    expect(auth.baseUrl).toBe("https://opencode.ai/zen/go/v1")
    expect(auth.model).toBe("deepseek-v4-flash")
  })

  test("#given no explicit key and a missing auth store #when resolved #then returns empty", () => {
    // given / when
    const auth = resolveDshAuth({ OPENCODE_AUTH_PATH: "/nonexistent/auth.json" } as NodeJS.ProcessEnv)

    // then
    expect(auth.apiKey).toBeUndefined()
    expect(auth.baseUrl).toBeUndefined()
  })
})
