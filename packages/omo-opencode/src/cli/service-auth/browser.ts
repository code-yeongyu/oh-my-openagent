import { execFile } from "node:child_process"

type BrowserExec = (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<boolean>
const execute: BrowserExec = (file, args, env) => new Promise(resolve => {
  execFile(file, [...args], { env, timeout: 10_000, windowsHide: true }, error => resolve(error === null))
})

export async function openSignInBrowser(
  url: string,
  executeBrowser: BrowserExec = execute,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ["PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) {
    const value = environment[key]
    if (value !== undefined) env[key] = value
  }
  if (platform === "darwin") return executeBrowser("/usr/bin/open", [url], env)
  if (platform === "win32") return executeBrowser("rundll32.exe", ["url.dll,FileProtocolHandler", url], env)
  if (platform === "linux" && (env.DISPLAY || env.WAYLAND_DISPLAY)) return executeBrowser("xdg-open", [url], env)
  return false
}
