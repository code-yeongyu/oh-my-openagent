import { findTomlSection, removeSetting, replaceOrInsertSetting } from "./toml-section-editor"

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

function replaceOrInsertRootSetting(config: string, key: string, value: string): string {
  const sectionStart = findFirstTableStart(config)
  const root = config.slice(0, sectionStart)
  const suffix = config.slice(sectionStart)
  const linePattern = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, "m")
  const replacement = linePattern.test(root)
    ? root.replace(linePattern, `${key} = ${value}`)
    : `${root.trimEnd()}${root.trimEnd().length > 0 ? "\n" : ""}${key} = ${value}\n`
  if (suffix.length === 0) return replacement
  return `${replacement.trimEnd()}\n\n${suffix.trimStart()}`
}

function findFirstTableStart(config: string): number {
  const match = config.match(/^[[].*$/m)
  return match?.index ?? config.length
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
