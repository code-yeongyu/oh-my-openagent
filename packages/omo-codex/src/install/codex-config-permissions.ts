import { appendBlock, findTomlSection, removeSetting, replaceOrInsertRootSetting, replaceOrInsertSetting } from "./toml-section-editor"
import { ensureFeatureEnabled } from "./codex-config-features"

const AUTONOMOUS_FEATURES = ["multi_agent", "unified_exec", "goals"] as const

export function ensureAutonomousPermissions(config: string): string {
  let next = replaceOrInsertRootSetting(config, "approval_policy", JSON.stringify("never"))
  next = replaceOrInsertRootSetting(next, "sandbox_mode", JSON.stringify("danger-full-access"))
  next = replaceOrInsertRootSetting(next, "network_access", JSON.stringify("enabled"))
  for (const featureName of AUTONOMOUS_FEATURES) {
    next = ensureFeatureEnabled(next, featureName)
  }
  next = removeWindowsSandboxSetting(next)
  next = ensureNoticeEnabled(next, "hide_full_access_warning")
  return ensureNoticeEnabled(next, "hide_world_writable_warning")
}

function removeWindowsSandboxSetting(config: string): string {
  const section = findTomlSection(config, "windows")
  if (section === null) return config
  return removeSetting(config, section, "sandbox")
}

function ensureNoticeEnabled(config: string, key: string): string {
  const section = findTomlSection(config, "notice")
  if (section === null) return appendNoticeBlock(config, key)
  return replaceOrInsertSetting(config, section, key, "true")
}

function appendNoticeBlock(config: string, key: string): string {
  return appendBlock(config, `[notice]\n${key} = true\n`)
}
