import type { MemoryToolParams } from "./memory"

/**
 * The memory tool's free-text arguments. A model sometimes closes one of them with its own name
 * (`</description>`) instead of `</parameter>`; the provider then reads on to the next
 * `</parameter>`, so the argument that followed arrives inside it as
 * `<value></description>\n<parameter name="file_text"><its value>`.
 */
const TEXT_ARGUMENTS = [
  "file_path",
  "old_path",
  "new_path",
  "old_string",
  "new_string",
  "insert_text",
  "description",
  "file_text",
  "input",
  "reason",
] as const

type TextArgument = (typeof TEXT_ARGUMENTS)[number]

export interface LeakedArgumentRepair {
  readonly from: TextArgument
  readonly to: TextArgument
}

export interface RepairedMemoryToolParams {
  readonly params: MemoryToolParams
  readonly repairs: readonly LeakedArgumentRepair[]
}

/**
 * Split arguments that leaked into a sibling back apart. Only the unambiguous shape is repaired:
 * the closing tag names the argument that holds it, and the leaked argument is a known text
 * argument the call did not supply. Anything else stays as sent, so the description validator
 * refuses it as tool-call scaffolding.
 */
export function repairLeakedArguments(params: MemoryToolParams): RepairedMemoryToolParams {
  const text: Partial<Record<TextArgument, string>> = {}
  for (const name of TEXT_ARGUMENTS) {
    const value = params[name]
    if (typeof value === "string") text[name] = value
  }
  const repairs: LeakedArgumentRepair[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const from of TEXT_ARGUMENTS) {
      const value = text[from]
      if (value === undefined) continue
      const leak = new RegExp(`</${from}>\\s*<parameter name="([a-z_]+)">`).exec(value)
      const to = leak?.[1]
      if (leak === null || !isTextArgument(to) || to === from || text[to] !== undefined) continue
      text[from] = value.slice(0, leak.index)
      text[to] = value.slice(leak.index + leak[0].length)
      repairs.push({ from, to })
      changed = true
    }
  }
  return { params: repairs.length === 0 ? params : { ...params, ...text }, repairs }
}

/** Tells the model its call was repaired, so the next call closes every argument with `</parameter>`. */
export function describeRepairs(repairs: readonly LeakedArgumentRepair[]): string {
  return repairs
    .map(({ from, to }) => `\nNote: '${to}' arrived inside '${from}' because '${from}' was closed with </${from}> instead of </parameter>; it was split back out before writing.`)
    .join("")
}

function isTextArgument(name: string | undefined): name is TextArgument {
  return TEXT_ARGUMENTS.some((argument) => argument === name)
}
