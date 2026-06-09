import { appendBlock, escapeRegExp, findTomlSection, replaceOrInsertSetting } from "./toml-section-editor"

export function ensureFeatureEnabled(config: string, featureName: string): string {
  const section = findTomlSection(config, "features")
  if (!section) return appendBlock(config, `[features]\n${featureName} = true\n`)
  return replaceOrInsertSetting(config, section, featureName, "true")
}

export function ensureFeatureDefault(config: string, featureName: string, enabled: boolean): string {
  const section = findTomlSection(config, "features")
  const value = enabled ? "true" : "false"
  if (!section) return appendBlock(config, `[features]\n${featureName} = ${value}\n`)
  const linePattern = new RegExp(`^\\s*${escapeRegExp(featureName)}\\s*=`, "m")
  if (linePattern.test(section.text)) return config
  return replaceOrInsertSetting(config, section, featureName, value)
}
