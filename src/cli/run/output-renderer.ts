import pc from "picocolors"

export function renderAgentHeader(
  agent: string | null,
  model: string | null,
  variant: string | null,
  agentColorsByName: Record<string, string>,
): void {
  if (!agent && !model) return

  const agentLabel = agent
    ? pc.bold(colorizeWithProfileColor(agent, agentColorsByName[agent]))
    : ""
  const modelBase = model ?? ""
  const variantSuffix = variant ? ` (${variant})` : ""
  const modelLabel = model ? pc.dim(`${modelBase}${variantSuffix}`) : ""

  process.stdout.write("\n")

  if (modelLabel) {
    process.stdout.write(`  ${modelLabel}  \n`)
  }

  if (agentLabel) {
    process.stdout.write(`  ${pc.dim("└─")} ${agentLabel}  \n`)
  }

  process.stdout.write("\n")
}

export function openThinkBlock(): void {
  process.stdout.write(`\n  ${pc.dim("┃  Thinking:")} `)
}

export function closeThinkBlock(): void {
  process.stdout.write("  \n\n")
}

export function writePaddedText(
  text: string,
  atLineStart: boolean,
): { output: string; atLineStart: boolean } {
  const isGitHubActions = process.env.GITHUB_ACTIONS === "true"
  if (isGitHubActions) {
    return { output: text, atLineStart: text.endsWith("\n") }
  }

  let output = ""
  let lineStart = atLineStart

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (lineStart) {
      output += "  "
      lineStart = false
    }

    if (ch === "\n") {
      output += "  \n"
      lineStart = true
      continue
    }

    output += ch
  }

  return { output, atLineStart: lineStart }
}

function colorizeWithProfileColor(text: string, hexColor?: string): string {
  if (!hexColor) return pc.magenta(text)

  const rgb = parseHexColor(hexColor)
  if (!rgb) return pc.magenta(text)

  const [r, g, b] = rgb
  return `\u001b[38;2;${r};${g};${b}m${text}\u001b[39m`
}

function parseHexColor(hexColor: string): [number, number, number] | null {
  const cleaned = hexColor.trim()
  const match = cleaned.match(/^#?([A-Fa-f0-9]{6})$/)
  if (!match) return null

  const hex = match[1]
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return [r, g, b]
}
