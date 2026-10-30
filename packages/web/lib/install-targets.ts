export const INSTALL_TARGETS = ["unix", "powershell", "cmd"] as const
export type InstallTarget = (typeof INSTALL_TARGETS)[number]

export const INSTALL_COMMANDS: Readonly<Record<InstallTarget, string>> = {
  unix: "curl -fsSL https://get.omo.dev/install.sh | bash",
  powershell: "irm https://get.omo.dev/install.ps1 | iex",
  cmd: 'powershell -ExecutionPolicy Bypass -c "irm https://get.omo.dev/install.ps1 | iex"',
}

export const INSTALL_PROMPTS: Readonly<Record<InstallTarget, string>> = {
  unix: "$",
  powershell: "PS>",
  cmd: ">",
}

export type InstallOs = "windows" | "macos" | "linux" | "chromeos" | "ios" | "android" | "unknown"

export interface InstallClient {
  readonly userAgent: string
  readonly uaPlatform?: string
  readonly platform?: string
  readonly mobile?: boolean
  readonly maxTouchPoints?: number
}

export interface InstallDetection {
  readonly os: InstallOs
  readonly target: InstallTarget
  readonly onComputer: boolean
}

/**
 * Serialized into `installDetectScript`, so the body must stay self-contained: no references to
 * anything outside the function. `uaPlatform` (`navigator.userAgentData.platform`) wins when the
 * browser has it; otherwise the UA string decides, and an iPad asking for the desktop site shows up
 * as a Mac UA with touch points.
 */
export function detectInstall(client: InstallClient): InstallDetection {
  const ua = client.userAgent || ""
  const platform = client.platform || ""
  const hinted: Record<string, InstallOs> = {
    windows: "windows",
    macos: "macos",
    linux: "linux",
    "chrome os": "chromeos",
    chromeos: "chromeos",
    android: "android",
    ios: "ios",
  }
  const fromHint = hinted[(client.uaPlatform || "").toLowerCase()]
  let os: InstallOs = "unknown"
  if (fromHint) os = fromHint
  else if (/Android/i.test(ua)) os = "android"
  else if (/iPhone|iPad|iPod/.test(ua) || /^(iOS|iPhone|iPad|iPod)/i.test(platform)) os = "ios"
  else if (/Macintosh|Mac OS X/.test(ua) || /^Mac/i.test(platform))
    os = (client.maxTouchPoints || 0) > 1 ? "ios" : "macos"
  else if (/Windows/.test(ua) || /^Win/i.test(platform)) os = "windows"
  else if (/CrOS/.test(ua) || /^Chrome ?OS/i.test(platform)) os = "chromeos"
  else if (/Linux|X11|FreeBSD|OpenBSD/.test(ua) || /Linux/i.test(platform)) os = "linux"
  const onComputer = os === "ios" || os === "android" || os === "unknown" || client.mobile === true
  return { os, target: os === "windows" ? "powershell" : "unix", onComputer }
}

/**
 * Runs from <head> before the body is parsed, so the first paint already shows the detected
 * command: it marks <html> with `data-install` and `data-install-hint`, which the InstallTabs CSS
 * reads until the visitor picks a tab.
 */
export const installDetectScript = `(function(){var el=document.documentElement,n=navigator,d=n.userAgentData;var r=(${detectInstall.toString()})({userAgent:n.userAgent,uaPlatform:d?d.platform:undefined,platform:n.platform,mobile:d?d.mobile:undefined,maxTouchPoints:n.maxTouchPoints});el.setAttribute("data-install",r.target);if(r.onComputer)el.setAttribute("data-install-hint","computer")})()`

function readUserAgentData(nav: Navigator): { platform?: string; mobile?: boolean } {
  const data: unknown = Reflect.get(nav, "userAgentData")
  if (typeof data !== "object" || data === null) return {}
  const platform: unknown = Reflect.get(data, "platform")
  const mobile: unknown = Reflect.get(data, "mobile")
  return {
    ...(typeof platform === "string" ? { platform } : {}),
    ...(typeof mobile === "boolean" ? { mobile } : {}),
  }
}

export function detectInstallFromNavigator(nav: Navigator): InstallDetection {
  const data = readUserAgentData(nav)
  return detectInstall({
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    ...(data.platform === undefined ? {} : { uaPlatform: data.platform }),
    ...(data.mobile === undefined ? {} : { mobile: data.mobile }),
  })
}
