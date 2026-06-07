import { appendBlock, findTomlSection, replaceOrInsertSetting } from "./toml-section-editor"

export function ensureFeatureEnabled(config: string, featureName: string): string {
  const section = findTomlSection(config, "features")
  if (!section) return appendBlock(config, `[features]\n${featureName} = true\n`)
  return replaceOrInsertSetting(config, section, featureName, "true")
}
