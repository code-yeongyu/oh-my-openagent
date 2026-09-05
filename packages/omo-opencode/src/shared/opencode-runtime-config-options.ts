import type { OpenCodeConfigDirOptions } from "./opencode-config-dir-types"

export function getOpenCodeRuntimeConfigOptions(
  environment: NodeJS.ProcessEnv = process.env,
): OpenCodeConfigDirOptions {
  const binary = environment["OPENCODE_CLIENT"] === "desktop"
    ? "opencode-desktop"
    : "opencode"
  const stateDirectory = environment["XDG_STATE_HOME"]?.replaceAll("\\", "/")
  const desktopIdentifier = /(?:^|\/)(ai\.opencode\.desktop(?:\.dev)?)\/?$/
    .exec(stateDirectory ?? "")?.[1]
  const desktopDev = desktopIdentifier === "ai.opencode.desktop.dev" ||
    (desktopIdentifier === undefined && environment["OPENCODE_CHANNEL"] === "dev")
  return {
    binary,
    version: binary === "opencode-desktop" && desktopDev ? "desktop-dev" : null,
  }
}
