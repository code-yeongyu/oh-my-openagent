import { hostname } from "node:os"
import { SignInError, type Platform } from "./protocol"

// A device is registered under its machine name, the same name the account's machine list and a session address
// (`<machine>/<code>`) use: no "omo CLI on" prefix (#14044). macOS's mDNS suffix is not part of the name.
const UNNAMED = "unnamed-machine"

export function deviceName(host: string = hostname()): string {
  const clean = host
    .replace(/[\p{Cc}\p{Zl}\p{Zp}\p{Cf}\u3164\u115F\u1160\uFFA0]/gu, "")
    .trim()
    .replace(/\.local$/i, "")
  const bounded = [...clean].slice(0, 64).join("").trim()
  return bounded === "" ? UNNAMED : bounded
}

export function devicePlatform(): Platform {
  switch (process.platform) {
    case "darwin":
      return "macos"
    case "linux":
      return "linux"
    case "win32":
      return "windows"
    default:
      throw new SignInError("This platform is not supported for OmO sign-in.")
  }
}
