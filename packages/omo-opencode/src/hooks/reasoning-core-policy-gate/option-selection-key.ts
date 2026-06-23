function toSlug(value: string, index: number): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return slug.length > 0 ? slug : `option_${index}`
}

export function getOptionSelectionKeys(option: string, index: number): string[] {
  const slugKey = `select_${toSlug(option, index)}`
  const letter = option.match(/^option\s+([a-z])\b/i)?.[1]?.toLowerCase()
  if (letter) {
    return [`select(option_${letter})`, slugKey]
  }
  return [slugKey]
}
