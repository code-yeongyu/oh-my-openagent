export function stripJsonComments(json: string): string {
  return json
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (match, group) =>
      group ? "" : match
    )
    .replace(/,(\s*[}\]])/g, "$1")
}
