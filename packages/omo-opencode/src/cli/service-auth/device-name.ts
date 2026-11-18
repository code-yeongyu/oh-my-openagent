import { execFileSync } from "node:child_process"
import { hostname } from "node:os"
import { SignInError, type Platform } from "./protocol"

// A device is registered under its machine name, the same name the account's machine list and a session address
// (`<machine>/<code>`) use: no "omo CLI on" prefix (#14044). macOS's mDNS suffix is not part of the name.
const UNNAMED = "unnamed-machine"

// macOS's kernel hostname can be a reverse-DNS name (a tailnet FQDN); LocalHostName is the machine's own name, the one the
// desktop registers under too (omo-desktop-app#7942), so one Mac running both names one device.
function machineHost(): string {
  if (process.platform !== "darwin") return hostname()
  try {
    const local = execFileSync("/usr/sbin/scutil", ["--get", "LocalHostName"], {
      encoding: "utf8",
      timeout: 2_000,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim()
    return local === "" ? hostname() : local
  } catch {
    return hostname()
  }
}

export function deviceName(host: string = machineHost()): string {
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
