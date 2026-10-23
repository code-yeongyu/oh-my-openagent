const HEREDOC = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/
const QUOTED = /(?<!<<-?\s*)(?:'[^']*'|"(?:\\.|[^"\\])*")/g
const SEPARATORS = new Set(["\n", ";", "|", "&", "(", ")", "`"])

// A `#` that starts a word outside quotes begins a comment that runs to the end of the line.
function withoutComment(line: string): string {
  let quote: string | null = null
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] as string
    if (quote !== null) {
      if (char === quote) quote = null
    } else if (char === "'" || char === '"') quote = char
    else if (char === "#" && (index === 0 || /\s/.test(line[index - 1] as string))) return line.slice(0, index)
  }
  return line
}

// A heredoc body is file content, not commands: keep the redirect line, drop every line up to the terminator.
function stripHeredocBodies(input: string): string {
  const kept: string[] = []
  let terminator: string | null = null
  for (const line of input.split("\n")) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null
      continue
    }
    kept.push(withoutComment(line))
    terminator = HEREDOC.exec(withoutComment(line).replace(QUOTED, ""))?.[2] ?? null
  }
  return kept.join("\n")
}

/**
 * Splits a shell command line into argv segments at `&&`, `||`, `;`, `|`, `&`, newlines, the parentheses of
 * subshells and `$(...)` substitutions, and backticks, honouring single and double quotes so a quoted `&&` or a quoted check name
 * stays inside its argument. Heredoc bodies are dropped.
 */
export function shellSegments(input: string): string[][] {
  const line = stripHeredocBodies(input)
  const segments: string[][] = []
  let argv: string[] = []
  let word = ""
  let inWord = false
  let quote: "'" | '"' | null = null
  const endWord = () => {
    if (inWord) argv.push(word)
    word = ""
    inWord = false
  }
  const endSegment = () => {
    endWord()
    if (argv.length > 0) segments.push(argv)
    argv = []
  }
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] as string
    if (quote !== null) {
      if (char === quote) quote = null
      else word += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      inWord = true
      continue
    }
    if (char === "\\" && index + 1 < line.length) {
      word += line[index + 1]
      inWord = true
      index += 1
      continue
    }
    if (char === "$" && line[index + 1] === "(") continue
    if (SEPARATORS.has(char)) {
      endSegment()
      continue
    }
    if (char === " " || char === "\t") {
      endWord()
      continue
    }
    word += char
    inWord = true
  }
  endSegment()
  return segments
}
