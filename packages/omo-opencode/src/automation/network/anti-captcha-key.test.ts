import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { describe, expect, test } from "bun:test"
import { resolveAntiCaptchaKey } from "./anti-captcha-key"

describe("resolveAntiCaptchaKey", () => {
  test("#given ANTI_CAPTCHA_API_KEY env var #when resolving #then returns env value (highest precedence)", () => {
    const configDir = createConfigDir({ key: "file-key" })

    const key = resolveAntiCaptchaKey({
      env: { ANTI_CAPTCHA_API_KEY: "env-primary" },
      configDir,
    })

    expect(key).toBe("env-primary")
    rmSync(configDir, { recursive: true, force: true })
  })

  test("#given ANTICAPTCHA_KEY env var without ANTI_CAPTCHA_API_KEY #when resolving #then returns ANTICAPTCHA_KEY", () => {
    const configDir = createConfigDir({ key: "file-key" })

    const key = resolveAntiCaptchaKey({
      env: { ANTICAPTCHA_KEY: "env-secondary" },
      configDir,
    })

    expect(key).toBe("env-secondary")
    rmSync(configDir, { recursive: true, force: true })
  })

  test("#given dotfile only #when resolving #then reads anti-captcha.key file", () => {
    const configDir = createConfigDir({ key: "file-key-content\n" })

    const key = resolveAntiCaptchaKey({ env: {}, configDir })

    expect(key).toBe("file-key-content")
    rmSync(configDir, { recursive: true, force: true })
  })

  test("#given no env vars and no dotfile #when resolving #then returns undefined", () => {
    const configDir = createConfigDir({})

    const key = resolveAntiCaptchaKey({ env: {}, configDir })

    expect(key).toBeUndefined()
    rmSync(configDir, { recursive: true, force: true })
  })

  test("#given empty file content #when resolving #then returns undefined", () => {
    const configDir = createConfigDir({ key: "   \n  " })

    const key = resolveAntiCaptchaKey({ env: {}, configDir })

    expect(key).toBeUndefined()
    rmSync(configDir, { recursive: true, force: true })
  })

  test("#given env trims whitespace #when resolving #then returns trimmed value", () => {
    const configDir = createConfigDir({})

    const key = resolveAntiCaptchaKey({
      env: { ANTI_CAPTCHA_API_KEY: "  spaced-key  " },
      configDir,
    })

    expect(key).toBe("spaced-key")
    rmSync(configDir, { recursive: true, force: true })
  })
})

function createConfigDir(opts: { key?: string }): string {
  const configDir = mkdtempSync(join(tmpdir(), "idm-anti-captcha-"))
  if (opts.key) writeFileSync(join(configDir, "anti-captcha.key"), opts.key)
  return configDir
}
