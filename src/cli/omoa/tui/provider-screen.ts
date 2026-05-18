import * as p from "@clack/prompts"
import color from "picocolors"
import { readOmoaState, writeOmoaState, setProviderEnabled, isProviderEnabled } from "../state/state-manager"
import { getAllProviders } from "../models/model-cache"
import { loadRuntimeConfig, countProviderUsage } from "./shared"

export async function showProviderScreen(): Promise<void> {
  while (true) {
    const state = readOmoaState()
    const config = loadRuntimeConfig()
    const allProviders = getAllProviders()
    const knownProviders = new Set([...Object.keys(state.providers), ...allProviders])
    const usageCounts = config ? countProviderUsage(config) : new Map<string, { primary: number; fallback: number }>()

    console.log()
    console.log(color.bgYellow(color.black(color.bold(" Providers "))))
    console.log()

    const options = [...knownProviders].sort().map((provider) => {
      const enabled = isProviderEnabled(state, provider)
      const usage = usageCounts.get(provider)
      const usageHint = usage ? `primary:${usage.primary} fallback:${usage.fallback}` : "not in config"
      const freeOnly = state.providers[provider]?.free_only ? color.dim(" [free-only]") : ""
      return {
        value: provider,
        label: `${enabled ? color.green("[x]") : color.red("[ ]")} ${provider}${freeOnly}`,
        hint: usageHint,
      }
    })

    options.push({ value: "__back__", label: color.dim("Back to main menu"), hint: "" })

    const selected = await p.select({
      message: "Select provider to toggle (or back):",
      options,
    })

    if (p.isCancel(selected) || selected === "__back__") return

    const provider = selected as string
    const currentEnabled = isProviderEnabled(state, provider)
    const usage = usageCounts.get(provider)

    const action = await p.select({
      message: `Provider "${provider}" is currently ${currentEnabled ? color.green("enabled") : color.red("disabled")}.`,
      options: [
        { value: "toggle", label: currentEnabled ? "Disable" : "Enable", hint: currentEnabled ? "Remove from active assignments on next build" : "Restore on next build" },
        { value: "free-only", label: `Free-only: ${state.providers[provider]?.free_only ? "on" : "off"}`, hint: "Only allow *-free models for this provider" },
        { value: "back", label: "Cancel" },
      ],
    })

    if (p.isCancel(action) || action === "back") continue

    if (action === "toggle") {
      const newState = setProviderEnabled(state, provider, !currentEnabled)
      writeOmoaState(newState)
      p.log.success(`${provider} ${!currentEnabled ? "enabled" : "disabled"}. Run "Build" to apply.`)
    }

    if (action === "free-only") {
      const current = state.providers[provider] ?? { enabled: true, free_only: false, avoid_fallback_from: [] }
      const newState = {
        ...state,
        providers: {
          ...state.providers,
          [provider]: { ...current, free_only: !current.free_only },
        },
      }
      writeOmoaState(newState)
      p.log.success(`${provider} free-only ${!current.free_only ? "enabled" : "disabled"}.`)
    }
  }
}
