import { appendBlock, findTomlSection, replaceOrInsertRootDottedSetting, replaceOrInsertSetting } from "./toml-section-editor"
import { hasTomlRootDottedKeyPrefix } from "./toml-setting-reader"

export function ensureFeatureEnabled(config: string, featureName: string): string {
  const section = findTomlSection(config, "features")
  if (!section) {
    if (hasTomlRootDottedKeyPrefix(config, "features")) {
      return replaceOrInsertRootDottedSetting(config, `features.${featureName}`, "true")
    }
    return appendBlock(config, `[features]\n${featureName} = true\n`)
  }
  return replaceOrInsertSetting(config, section, featureName, "true")
}
