import { hostname } from "node:os"
import { SignInError, type Platform } from "./protocol"

export function deviceName(host: string = hostname()): string {
  const clean = `omo CLI on ${host}`.replace(/[\p{Cc}\p{Zl}\p{Zp}\p{Cf}\u3164\u115F\u1160\uFFA0]/gu, "").trim()
  return [...clean].slice(0, 64).join("").trim()
}

export function devicePlatform(): Platform {
  switch (process.platform) {
    case "darwin": return "macos"
    case "linux": return "linux"
    case "win32": return "windows"
    default: throw new SignInError("This platform is not supported for OmO sign-in.")
  }
}
