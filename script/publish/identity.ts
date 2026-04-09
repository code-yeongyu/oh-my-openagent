export const CANONICAL_PACKAGE_NAME = "oh-my-opencode"
export const ALIAS_PACKAGE_NAME = "oh-my-openagent"

export const CANONICAL_BINARY_NAME = "oh-my-opencode"
export const ALIAS_BINARY_NAME = "oh-my-openagent"

export const CANONICAL_SCHEMA_FILE = `${CANONICAL_PACKAGE_NAME}.schema.json`
export const ALIAS_SCHEMA_FILE = `${ALIAS_PACKAGE_NAME}.schema.json`

export function getCanonicalPlatformPackageName(platform: string): string {
  return `${CANONICAL_PACKAGE_NAME}-${platform}`
}

export function getAliasPlatformPackageName(platform: string): string {
  return `${ALIAS_PACKAGE_NAME}-${platform}`
}

export function renameOptionalDependencyKeys(
  optionalDependencies: Record<string, string> | undefined,
  fromPrefix: string,
  toPrefix: string
): Record<string, string> | undefined {
  if (!optionalDependencies) return undefined

  return Object.fromEntries(
    Object.entries(optionalDependencies).map(([name, version]) => {
      if (!name.startsWith(`${fromPrefix}-`)) return [name, version]
      return [name.replace(fromPrefix, toPrefix), version]
    })
  )
}
