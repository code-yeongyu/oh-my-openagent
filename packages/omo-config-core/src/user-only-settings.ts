import { isPlainRecord } from "@oh-my-opencode/utils/record-type-guard"

import type { PrunedConfigPath } from "./loader/prune-invalid-leaves"
import type { OmoConfigSourceScope } from "./loader/types"

// Source trust is enforced before layers are stored or merged, for every harness.
const USER_ONLY_SETTINGS = [
  ["mcp_env_allowlist"],
  ["computer", "env"],
] as const

export const COMPUTER_ENV_ALLOWLIST = ["DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"] as const

export function applyUserOnlySettings(
  data: unknown,
  scope: OmoConfigSourceScope,
): { readonly value: unknown; readonly dropped: readonly PrunedConfigPath[] } {
  const dropped: PrunedConfigPath[] = []
  const allowedEnvKeys: ReadonlySet<string> = new Set(COMPUTER_ENV_ALLOWLIST)

  function settings(value: unknown, prefix: readonly string[]): unknown {
    if (!isPlainRecord(value)) return value
    const config = { ...value }
    if (scope === "project") {
      for (const [section, field] of USER_ONLY_SETTINGS) {
        if (field === undefined) {
          delete config[section]
        } else if (isPlainRecord(config[section]) && Object.hasOwn(config[section], field)) {
          const block = { ...config[section] }
          delete block[field]
          config[section] = block
          if (section === "computer") {
            const path = [...prefix, section, field]
            dropped.push({ path, key: path.join("."), message: "Only user configuration may set computer.env" })
          }
        }
      }
    } else if (isPlainRecord(config.computer) && isPlainRecord(config.computer.env)) {
      const env = Object.fromEntries(Object.entries(config.computer.env).filter(([key]) => {
        if (allowedEnvKeys.has(key)) return true
        const path = [...prefix, "computer", "env", key]
        dropped.push({ path, key: path.join("."), message: `Allowed environment keys: ${COMPUTER_ENV_ALLOWLIST.join(", ")}` })
        return false
      }))
      config.computer = { ...config.computer, env }
    }
    return config
  }

  function container(value: unknown, prefix: readonly string[]): unknown {
    const config = settings(value, prefix)
    if (!isPlainRecord(config)) return config
    for (const harness of ["[opencode]", "[native]", "[senpi]", "[codex]"]) {
      if (Object.hasOwn(config, harness)) config[harness] = settings(config[harness], [...prefix, harness])
    }
    return config
  }

  const value = container(data, [])
  if (isPlainRecord(value) && isPlainRecord(value.profiles)) {
    value.profiles = Object.fromEntries(Object.entries(value.profiles).map(([name, profile]) => [
      name, container(profile, ["profiles", name]),
    ]))
  }
  return { value, dropped }
}
