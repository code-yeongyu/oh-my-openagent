import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

export type ResolveAntiCaptchaKeyOptions = {
  env?: Record<string, string | undefined>
  configDir?: string
}

export function resolveAntiCaptchaKey(opts: ResolveAntiCaptchaKeyOptions = {}): string | undefined {
  const env = opts.env ?? process.env
  const configDir = opts.configDir ?? join(homedir(), ".config", "idm")

  const primary = env.ANTI_CAPTCHA_API_KEY?.trim()
  if (primary) return primary

  const secondary = env.ANTICAPTCHA_KEY?.trim()
  if (secondary) return secondary

  return readKeyFile(join(configDir, "anti-captcha.key"))
}

function readKeyFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  try {
    const value = readFileSync(path, "utf8").trim()
    return value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}
