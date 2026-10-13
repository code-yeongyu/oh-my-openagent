/** Splits the argument text into quoted phrases or bare words, quotes removed. */
function splitArguments(text: string): string[] {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) =>
    (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")) ? token.slice(1, -1) : token,
  )
}

/**
 * Renders a 1.x command template the way OpenCode 1.x did before sending it as a prompt:
 * `$1`..`$N` take the quoted-aware arguments (the highest-numbered placeholder takes all that
 * remain), `$ARGUMENTS` takes the raw argument text, and a template that uses neither gets the
 * arguments appended after a blank line.
 */
export function renderCommandTemplate(template: string, argumentText: string): string {
  const args = splitArguments(argumentText)
  const positions = [...template.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]))
  const last = positions.length === 0 ? 0 : Math.max(...positions)
  const withPositions = template.replace(/\$(\d+)/g, (_match, index: string) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ""
    return position === last ? args.slice(argIndex).join(" ") : (args[argIndex] ?? "")
  })
  const usesArguments = withPositions.includes("$ARGUMENTS")
  const rendered = withPositions.replaceAll("$ARGUMENTS", argumentText)
  if (positions.length === 0 && !usesArguments && argumentText.trim().length > 0) return `${rendered}\n\n${argumentText}`
  return rendered
}
