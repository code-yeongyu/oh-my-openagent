import { findTomlSection, removeSetting, replaceOrInsertRootSetting, replaceOrInsertSetting } from "./toml-section-editor"

export function ensureAutonomousPermissions(config: string): string {
  let next = replaceOrInsertRootSetting(config, "approval_policy", JSON.stringify("never"))
  next = replaceOrInsertRootSetting(next, "sandbox_mode", JSON.stringify("danger-full-access"))
  next = replaceOrInsertRootSetting(next, "network_access", JSON.stringify("enabled"))
  next = removeWindowsSandboxSetting(next)
  next = ensureNoticeEnabled(next, "hide_full_access_warning")
  return ensureNoticeEnabled(next, "hide_world_writable_warning")
}

function removeWindowsSandboxSetting(config: string): string {
  const section = findTomlSection(config, "windows")
  if (!section) return config
  return removeSetting(config, section, "sandbox")
}

function ensureNoticeEnabled(config: string, key: string): string {
  const section = findTomlSection(config, "notice")
  if (!section) return appendNoticeBlock(config, key)
  return replaceOrInsertSetting(config, section, key, "true")
}

function appendNoticeBlock(config: string, key: string): string {
  return `${config.trimEnd()}${config.trimEnd().length > 0 ? "\n\n" : ""}[notice]\n${key} = true\n`
}
