import color from "picocolors"
import type { VersionInfo } from "./types"
import { getChannelLabel } from "../../shared/version"

const SYMBOLS = {
  check: color.green("✓"),
  cross: color.red("✗"),
  arrow: color.cyan("→"),
  info: color.blue("ℹ"),
  warn: color.yellow("⚠"),
  pin: color.magenta("📌"),
  dev: color.cyan("🔧"),
  channel: color.yellow("⚡"),
}

function formatChannel(channel: string | undefined): string {
  if (!channel || channel === "stable") return ""
  return color.yellow(` (${getChannelLabel(channel as any)})`)
}

export function formatVersionOutput(info: VersionInfo): string {
  const lines: string[] = []

  lines.push("")
  lines.push(color.bold(color.white("oh-my-opencode Version Information")))
  lines.push(color.dim("─".repeat(50)))
  lines.push("")

  if (info.currentVersion) {
    const channelBadge = formatChannel(info.currentChannel)
    lines.push(`  Current Version: ${color.cyan(info.currentVersion)}${channelBadge}`)
  } else {
    lines.push(`  Current Version: ${color.dim("unknown")}`)
  }

  // Show latest for channel if different from current
  if (!info.isLocalDev && info.latestForChannel) {
    lines.push(`  Latest${info.currentChannel !== "stable" ? ` (${info.currentChannel})` : ""}:  ${color.cyan(info.latestForChannel)}`)
  } else if (!info.isLocalDev && info.latestVersion) {
    lines.push(`  Latest Stable:   ${color.cyan(info.latestVersion)}`)
  }

  // Show available channels if we have them
  if (info.availableChannels) {
    const channels = Object.entries(info.availableChannels)
      .filter(([tag, version]) => version && tag !== "latest")
      .map(([tag, version]) => `${tag}@${version}`)
    
    if (channels.length > 0) {
      lines.push(`  Other Channels:  ${color.dim(channels.join(", "))}`)
    }
  }

  lines.push("")

  switch (info.status) {
    case "up-to-date":
      lines.push(`  ${SYMBOLS.check} ${color.green("You're up to date!")}`)
      break
    case "outdated":
      const updateLabel = info.updateType && info.updateType !== "none" 
        ? `${info.updateType} update` 
        : "Update"
      lines.push(`  ${SYMBOLS.warn} ${color.yellow(`${updateLabel} available`)}`)
      if (info.currentChannel === "stable") {
        lines.push(`  ${color.dim("Run:")} ${color.cyan("cd ~/.config/opencode && bun update oh-my-opencode")}`)
      } else {
        lines.push(`  ${color.dim("Run:")} ${color.cyan(`cd ~/.config/opencode && bun update oh-my-opencode@${info.currentChannel}`)}`)
      }
      break
    case "local-dev":
      lines.push(`  ${SYMBOLS.dev} ${color.cyan("Running in local development mode")}`)
      lines.push(`  ${color.dim("Using file:// protocol from config")}`)
      break
    case "pinned":
      lines.push(`  ${SYMBOLS.pin} ${color.magenta(`Version pinned to ${info.pinnedVersion}`)}`)
      lines.push(`  ${color.dim("Update check skipped for pinned versions")}`)
      break
    case "error":
      lines.push(`  ${SYMBOLS.cross} ${color.red("Unable to check for updates")}`)
      lines.push(`  ${color.dim("Network error or npm registry unavailable")}`)
      break
    case "unknown":
      lines.push(`  ${SYMBOLS.info} ${color.yellow("Version information unavailable")}`)
      break
  }

  lines.push("")

  return lines.join("\n")
}

export function formatJsonOutput(info: VersionInfo): string {
  return JSON.stringify(info, null, 2)
}
