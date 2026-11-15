// Builds facade-manifest.json from the TSDoc of src/facade.ts. Each tagged interface method becomes one entry:
// `Interface.method`, its parameters and return type as written, and its `@tier`, `@policy` and `@wire` tags.
// The parser accepts only the shapes facade.ts uses (interface bodies of doc comments, properties and method
// signatures) and throws on anything else, so an unsupported edit fails generation instead of dropping a method.
import { ENGINE_METHODS, ENGINE_NOTIFICATIONS } from "@oh-my-opencode/senpi-desktop-protocol"

const FACADE_SOURCE = "packages/senpi-desktop-sdk/src/facade.ts"

export type FacadeTier = "read" | "exec"
export type FacadePolicy = "none" | "semantic" | "background" | "foreground"

export interface FacadeParam {
  readonly name: string
  readonly type: string
  readonly optional: boolean
}

export interface FacadeMethodEntry {
  readonly method: string
  readonly params: readonly FacadeParam[]
  readonly returns: string
  readonly tier: FacadeTier
  readonly policy: FacadePolicy
  readonly wire: readonly string[]
  readonly summary: string
}

export interface FacadeManifest {
  readonly generatedFrom: string
  readonly methods: readonly FacadeMethodEntry[]
}

const TIERS: ReadonlySet<string> = new Set(["read", "exec"])
const POLICIES: ReadonlySet<string> = new Set(["none", "semantic", "background", "foreground"])
const WIRE_NAMES: ReadonlySet<string> = new Set([...ENGINE_METHODS, ...ENGINE_NOTIFICATIONS])

const OPEN = new Set(["(", "[", "{", "<"])
const CLOSE = new Set([")", "]", "}", ">"])

/** Splits `text` at `separator` characters outside brackets; the `>` of `=>` is not a bracket. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ""
    if (char === ">" && text[index - 1] === "=") continue
    if (OPEN.has(char)) depth += 1
    else if (CLOSE.has(char)) depth -= 1
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim()).filter((part) => part.length > 0)
}

/** The index just past the bracket that closes the one at `open`. */
function closingIndex(text: string, open: number): number {
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    const char = text[index] ?? ""
    if (char === ">" && text[index - 1] === "=") continue
    if (OPEN.has(char)) depth += 1
    else if (CLOSE.has(char)) {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  throw new Error(`unbalanced brackets from offset ${open}`)
}

interface DocTags {
  readonly summary: string
  readonly tags: ReadonlyMap<string, string>
}

function parseDoc(comment: string): DocTags {
  const lines = comment
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
  const summary: string[] = []
  const tags = new Map<string, string>()
  for (const line of lines) {
    const tag = /^@(\w+)\s*(.*)$/.exec(line)
    if (tag !== null) tags.set(tag[1] ?? "", (tag[2] ?? "").trim())
    else if (tags.size === 0 && line.length > 0) summary.push(line)
  }
  return { summary: summary.join(" "), tags }
}

function parseParam(text: string, where: string): FacadeParam {
  const match = /^(\w+)(\??)\s*:\s*([\s\S]+)$/.exec(text)
  if (match === null) throw new Error(`${where}: unsupported parameter ${JSON.stringify(text)}`)
  return { name: match[1] ?? "", optional: match[2] === "?", type: (match[3] ?? "").replace(/\s+/g, " ") }
}

function methodEntry(owner: string, member: string, doc: DocTags): FacadeMethodEntry {
  const head = /^(\w+)\s*\(/.exec(member)
  if (head === null) throw new Error(`${owner}: tagged member is not a method signature: ${member}`)
  const name = head[1] ?? ""
  const where = `${owner}.${name}`
  const paramsEnd = closingIndex(member, head[0].length - 1)
  const returns = /^\s*:\s*([\s\S]+)$/.exec(member.slice(paramsEnd))
  if (returns === null) throw new Error(`${where}: missing return type`)
  const tier = doc.tags.get("tier") ?? ""
  const policy = doc.tags.get("policy") ?? ""
  const wireTag = doc.tags.get("wire")
  if (!TIERS.has(tier)) throw new Error(`${where}: @tier must be read or exec, got ${JSON.stringify(tier)}`)
  if (!POLICIES.has(policy)) throw new Error(`${where}: @policy must be one of ${[...POLICIES].join(", ")}`)
  if (wireTag === undefined) throw new Error(`${where}: missing @wire (leave it empty for no engine call)`)
  const wire = splitTopLevel(wireTag, ",")
  for (const method of wire) {
    if (!WIRE_NAMES.has(method)) throw new Error(`${where}: @wire names unknown engine method ${method}`)
  }
  return {
    method: where,
    params: splitTopLevel(member.slice(head[0].length, paramsEnd - 1), ",").map((param) => parseParam(param, where)),
    returns: (returns[1] ?? "").replace(/\s+/g, " ").trim(),
    tier: tier as FacadeTier,
    policy: policy as FacadePolicy,
    wire,
    summary: doc.summary,
  }
}

/** The members of one interface body, each with the doc comment right before it. */
function members(body: string, owner: string): { readonly text: string; readonly doc: DocTags | undefined }[] {
  const found: { text: string; doc: DocTags | undefined }[] = []
  let rest = body
  let doc: DocTags | undefined
  for (;;) {
    rest = rest.trimStart()
    if (rest.length === 0) return found
    if (rest.startsWith("/**")) {
      const end = rest.indexOf("*/")
      if (end < 0) throw new Error(`${owner}: unterminated doc comment`)
      doc = parseDoc(rest.slice(0, end + 2))
      rest = rest.slice(end + 2)
      continue
    }
    if (rest.startsWith("//") || rest.startsWith("/*")) throw new Error(`${owner}: only doc comments are supported`)
    const [text] = splitTopLevel(rest, ";")
    if (text === undefined) throw new Error(`${owner}: unterminated member`)
    const end = rest.indexOf(text) + text.length
    if (rest[end] !== ";") throw new Error(`${owner}: member ${JSON.stringify(text)} must end with ';'`)
    found.push({ text: text.replace(/\s+/g, " "), doc })
    doc = undefined
    rest = rest.slice(end + 1)
  }
}

/** Every tagged method of every exported interface in `source`, in source order. */
export function buildFacadeManifest(source: string): FacadeManifest {
  const methods: FacadeMethodEntry[] = []
  const header = /export interface (\w+)(?:<[^>]*>)?(?:\s+extends\s+[\w<>, ]+)?\s*\{/g
  for (let match = header.exec(source); match !== null; match = header.exec(source)) {
    const owner = match[1] ?? ""
    const open = match.index + match[0].length - 1
    const close = closingIndex(source, open)
    header.lastIndex = close
    for (const member of members(source.slice(open + 1, close - 1), owner)) {
      const isMethod = /^\w+\s*\(/.test(member.text)
      if (isMethod) {
        if (member.doc === undefined) throw new Error(`${owner}: method without a doc comment: ${member.text}`)
        methods.push(methodEntry(owner, member.text, member.doc))
      } else if (member.doc?.tags.has("tier")) {
        throw new Error(`${owner}: @tier on a property: ${member.text}`)
      }
    }
  }
  if (methods.length === 0) throw new Error("no facade methods found")
  return { generatedFrom: FACADE_SOURCE, methods }
}

export function renderFacadeManifest(source: string): string {
  return `${JSON.stringify(buildFacadeManifest(source), null, "\t")}\n`
}
