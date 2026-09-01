const MEMORY_DIR = "$MEMORY_DIR"

export interface CompiledSystemFile {
  relativePath: string
  body: string
  description: string
}

interface SystemTreeNode {
  children: Map<string, SystemTreeNode>
  file?: CompiledSystemFile
}

interface ProjectionTreeNode {
  children: Map<string, ProjectionTreeNode>
  leaf: boolean
}

export function renderSystemTree(files: readonly CompiledSystemFile[]): string {
  const root: SystemTreeNode = { children: new Map() }
  for (const file of files) {
    const parts = file.relativePath.replace(/^system\//, "").replace(/\.md$/, "").split("/").filter(Boolean)
    let node = root
    for (const part of parts) {
      let child = node.children.get(part)
      if (!child) {
        child = { children: new Map() }
        node.children.set(part, child)
      }
      node = child
    }
    node.file = file
  }

  const lines: string[] = []
  renderSystemNode(root, lines, 0, [])
  return lines.join("\n")
}

function renderSystemNode(
  node: SystemTreeNode,
  lines: string[],
  indent: number,
  pathParts: readonly string[],
): void {
  const pad = "  ".repeat(indent)
  const entries = [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [label, child] of entries) {
    const childParts = [...pathParts, label]
    lines.push(`${pad}<${label}>`)
    if (child.file) {
      lines.push(`${pad}  <projection>${MEMORY_DIR}/system/${childParts.join("/")}.md</projection>`)
      if (child.file.description.trim()) {
        lines.push(`${pad}  <description>${child.file.description.trim()}</description>`)
      }
      const body = child.file.body.trimEnd()
      if (body) lines.push(`${pad}  ${body}`)
    }
    renderSystemNode(child, lines, indent + 1, childParts)
    lines.push(`${pad}</${label}>`)
  }
}

export function renderExternalProjection(paths: readonly string[]): string {
  const root: ProjectionTreeNode = { children: new Map(), leaf: false }
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean)
    let node = root
    for (const [index, part] of parts.entries()) {
      let child = node.children.get(part)
      if (!child) {
        child = { children: new Map(), leaf: false }
        node.children.set(part, child)
      }
      if (index === parts.length - 1) child.leaf = true
      node = child
    }
  }

  const lines = ["<external_projection>", `${MEMORY_DIR}/`]
  renderProjectionNode(root, lines)
  lines.push("</external_projection>")
  return lines.join("\n")
}

function renderProjectionNode(node: ProjectionTreeNode, lines: string[], prefix = ""): void {
  const entries = [...node.children.entries()].sort(([aName, a], [bName, b]) => {
    const aDirectory = a.children.size > 0
    const bDirectory = b.children.size > 0
    if (aDirectory !== bDirectory) return aDirectory ? -1 : 1
    return aName.localeCompare(bName)
  })
  for (const [index, [name, child]] of entries.entries()) {
    const last = index === entries.length - 1
    const directory = child.children.size > 0
    lines.push(`${prefix}${last ? "└── " : "├── "}${name}${directory ? "/" : ""}`)
    if (directory) renderProjectionNode(child, lines, `${prefix}${last ? "    " : "│   "}`)
  }
}

export function markMemoryBlock(identity: string, block: string): string {
  return `<!-- senpi-memory:${identity}:begin -->\n${block}\n<!-- senpi-memory:${identity}:end -->`
}

export function replaceMemoryBlock(prompt: string, sentinelBlock: string): string {
  const identity = sentinelIdentity(sentinelBlock)
  const pattern = sentinelPattern(escapeRegExp(identity))
  if (pattern.test(prompt)) return prompt.replace(pattern, () => sentinelBlock)
  return `${prompt.trimEnd()}\n\n${sentinelBlock}`
}

export function stripMemoryBlock(prompt: string): string {
  return prompt.replace(sentinelPattern("[^:\\r\\n]+"), "").trim()
}

function sentinelIdentity(block: string): string {
  const match = block.match(/^<!-- senpi-memory:([^:\r\n]+):begin -->/)
  if (!match?.[1]) throw new Error("Memory block is missing a valid begin sentinel")
  return match[1]
}

function sentinelPattern(identity: string): RegExp {
  return new RegExp(`<!-- senpi-memory:${identity}:begin -->[\\s\\S]*?<!-- senpi-memory:${identity}:end -->`, "g")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
