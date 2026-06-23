const DELIBERATIONS_PATTERN = /^\.sisyphus\/deliberations\/[^/]+\.md$/

export function isPathInThemisScope(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "")
  return DELIBERATIONS_PATTERN.test(normalized)
}
