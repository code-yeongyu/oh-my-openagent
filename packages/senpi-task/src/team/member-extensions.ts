export function assembleMemberExtensions(
  entryPath: string,
  inheritedExtensions: readonly string[] = [],
): readonly string[] {
  return [...new Set([entryPath, ...inheritedExtensions])]
}
