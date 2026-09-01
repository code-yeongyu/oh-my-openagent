export function shellEscapeForDoubleQuotedCommand(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/"/g, "\\\"")
    .replace(/;/g, "\\;")
    .replace(/\|/g, "\\|")
    .replace(/&/g, "\\&")
    .replace(/#/g, "\\#")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
}
