import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { describe, expect, test } from "bun:test"
import { resolveSolveCaptchaRegistryOptions } from "./solve-captcha-handler"

describe("resolveSolveCaptchaRegistryOptions", () => {
  test("#given DS2API key file #when registry options are resolved #then vision-llm receives apiKey", () => {
    const configDir = mkdtempSync(join(tmpdir(), "idm-ds2api-handler-"))
    writeFileSync(join(configDir, "ds2api.key"), "file-proxy-key\n")

    const options = resolveSolveCaptchaRegistryOptions({ env: {}, configDir })

    expect(options.visionLlm).toMatchObject({ baseUrl: "http://127.0.0.1:5001", apiKey: "file-proxy-key", model: "deepseek-v4-vision" })
    rmSync(configDir, { recursive: true, force: true })
  })

  test("#given anti-captcha key file + OXYLABS_AUTH #when registry options resolved #then anti-captcha apiKey + proxyUrl populated", () => {
    const ds2Dir = mkdtempSync(join(tmpdir(), "idm-ds2api-handler-"))
    const acDir = mkdtempSync(join(tmpdir(), "idm-anti-captcha-handler-"))
    writeFileSync(join(acDir, "anti-captcha.key"), "ac-test-key\n")

    const options = resolveSolveCaptchaRegistryOptions({
      env: { OXYLABS_AUTH: "user:pass" },
      configDir: ds2Dir,
      antiCaptcha: { env: { OXYLABS_AUTH: "user:pass" }, configDir: acDir },
    })

    expect(options.antiCaptcha.apiKey).toBe("ac-test-key")
    expect(options.antiCaptcha.proxyUrl).toBe("http://user:pass@pr.oxylabs.io:7777")
    rmSync(ds2Dir, { recursive: true, force: true })
    rmSync(acDir, { recursive: true, force: true })
  })

  test("#given no anti-captcha key #when registry options resolved #then antiCaptcha.apiKey undefined", () => {
    const ds2Dir = mkdtempSync(join(tmpdir(), "idm-ds2api-handler-"))
    const acDir = mkdtempSync(join(tmpdir(), "idm-anti-captcha-handler-"))

    const options = resolveSolveCaptchaRegistryOptions({
      env: {},
      configDir: ds2Dir,
      antiCaptcha: { env: {}, configDir: acDir },
    })

    expect(options.antiCaptcha.apiKey).toBeUndefined()
    expect(options.antiCaptcha.proxyUrl).toBeUndefined()
    rmSync(ds2Dir, { recursive: true, force: true })
    rmSync(acDir, { recursive: true, force: true })
  })
})
