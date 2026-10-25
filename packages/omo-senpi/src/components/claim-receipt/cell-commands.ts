import { type InvokedKind, invokedKinds } from "./invocations"

export type CellCheckKind = Exclude<InvokedKind, "lookup">

const STRING_LITERAL = /"""[\s\S]*?"""|'''[\s\S]*?'''|`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g
const LIST_OF_STRINGS = /\[\s*(?:"""|'''|[`'"])[^\[\]]*\]/g
const QUOTES = /^(?:"""|'''|[`'"])|(?:"""|'''|[`'"])$/g
const LITERAL_PREFIX = /^(?:f|r|rf|fr|b)?$/i
const INTERPOLATION = /\$\{[^}]*\}|\{[A-Za-z_][\w.]*\}/g
const CONTEXT_WINDOW = 80
// Positions that carry a command line, the only places a literal counts as one: the first argument of a runner call
// (sh/run/exec/spawn/system/Popen/check_output, and the named helpers s, q, rd, sh2, shr, sh_*, run_*, *_run), a runner
// template tag ($`...`, sh`...`), a command-like field or variable (command:, cmds =, script:, job =, s = f"""...),
// a [name, command] pair nested in a command list, and the list of a for loop (`for c in ["bun test x", ...]`).
// Known misses: tuple loops, lists bound to other names and looped later, and argv passed as a later argument
// (`execa("bun", ["test"])`). Everything else is text, so an unknown position fails toward "not a command".
const RUNNER = String.raw`(?:sh|sh\d+|shr|shm|sh_\w+|run|run_\w+|\w+_run|exec|execa|execSync|exec_\w+|\w+_exec|spawn|spawnSync|system|popen|Popen|check_output|check_call|call|shell|bash|zsh|ssh|rsh|rd|q|s|\$)`
const COMMAND_CONTEXT = new RegExp(
  [
    String.raw`(?:^|[^\w$])${RUNNER}\s*\(\s*(?:\[\s*)?[A-Za-z]{0,2}$`,
    String.raw`(?:^|[^\w])(?:\$|sh|run|exec)\s*$`,
    String.raw`\b(?:commands?|cmds?|scripts?|shell|jobs?|steps?|s)\s*[:=]\s*(?:\[\s*)?[A-Za-z]{0,2}$`,
    String.raw`\bfor\s*\(?\s*(?:const|let|var)?\s*\w+\s+(?:in|of)\s*$`,
  ].join("|"),
)

// A [name, command] pair nested in a command list: the inner list right after the outer `[` or a previous `],`.
const NESTED_PAIR = /(?:\[|\],)\s*$/
const before = (code: string, at: number): string => code.slice(Math.max(0, at - CONTEXT_WINDOW), at)
const isCommand = (code: string, at: number): boolean => COMMAND_CONTEXT.test(before(code, at))
const isCommandList = (code: string, at: number): boolean => isCommand(code, at) || NESTED_PAIR.test(before(code, at))
const unquote = (literal: string): string => literal.replace(QUOTES, "").replace(INTERPOLATION, "X")
const shellQuote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`
const checkKinds = (line: string): CellCheckKind[] => invokedKinds(line).filter((kind): kind is CellCheckKind => kind !== "lookup")

// A list such as ["gh", "pr", "checks", n] is one argv (subprocess.run, a Bun spawn call): non-literal elements stand in as X.
function listWords(list: string): string[] {
  const words: string[] = []
  for (const element of list.slice(1, -1).split(",")) {
    const trimmed = element.trim()
    if (trimmed === "") continue
    const literal = trimmed.match(STRING_LITERAL)?.[0]
    const isLiteral = literal !== undefined && trimmed.endsWith(literal) && LITERAL_PREFIX.test(trimmed.slice(0, -literal.length))
    words.push(isLiteral ? unquote(literal) : "X")
  }
  return words
}

// A list is read as one argv, since a real argv starts with a bare executable. When its first element is itself a
// command line (`for c in ["bun test x", "tsgo"]: sh(c)`) every element is a command line, and a [name, command] pair
// (`["typecheck", "bun run typecheck"]`) contributes its command; a message argument inside an argv is never read.
function listKinds(list: string): CellCheckKind[] {
  const words = listWords(list)
  const [first = "", second = ""] = words
  if (/\s/.test(first)) return words.flatMap(checkKinds)
  const argv = checkKinds(words.map(shellQuote).join(" "))
  return words.length === 2 && /^[\w:.-]+$/.test(first) && /\s/.test(second) ? [...argv, ...checkKinds(second)] : argv
}

/**
 * Check kinds run by shell strings inside eval cell code, with the offset of the first such string. Only string
 * literals in command positions (see COMMAND_CONTEXT) are parsed as command lines, so prints, file contents, asserts,
 * labels and any unknown position never count; lookups are dropped because cells grep and cat for many reasons besides proving existence.
 */
export function cellInvokedKinds(code: string): { kinds: CellCheckKind[]; offset: number } {
  const kinds: CellCheckKind[] = []
  let offset = -1
  const found = (at: number, more: readonly CellCheckKind[]) => {
    if (more.length === 0) return
    if (offset === -1 || at < offset) offset = at
    for (const kind of more) if (!kinds.includes(kind)) kinds.push(kind)
  }
  const inLists: Array<readonly [number, number]> = []
  for (const match of code.matchAll(LIST_OF_STRINGS)) {
    inLists.push([match.index, match.index + match[0].length])
    if (isCommandList(code, match.index)) found(match.index, listKinds(match[0]))
  }
  for (const match of code.matchAll(STRING_LITERAL)) {
    if (inLists.some(([start, end]) => match.index >= start && match.index < end)) continue
    if (isCommand(code, match.index)) found(match.index, checkKinds(unquote(match[0])))
  }
  return { kinds, offset }
}
