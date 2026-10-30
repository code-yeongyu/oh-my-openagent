import { redactSecretLikeMaterial } from "../sync/redact"
import { generatedIds, type NamedFile } from "./external-projection-names"

const MEMORY_DIR = "$MEMORY_DIR"
const MIN_SIBLINGS = 3

/** One listed line: a directory, or sibling directories that list as one. */
export interface DirectoryGroup {
  readonly label: string
  /** Where the hidden names of this line can be listed. */
  readonly pointer: string
  readonly files: readonly NamedFile[]
  /** Several sibling directories list as this one line. */
  readonly grouped: boolean
}

/**
 * Groups files by directory. Leaf sibling directories named by generated ids list as one `<parent>/<id>/ (N dirs)`
 * line; other leaf siblings holding exactly the same file names list as one `<parent>/{a, b, c}/` line. Lines keep
 * name order, the repository root first.
 */
export function groupDirectories(paths: readonly string[], times: ReadonlyMap<string, number> | undefined): DirectoryGroup[] {
  const byDirectory = new Map<string, NamedFile[]>()
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean)
    const name = parts.pop()
    if (name === undefined) continue
    const directory = parts.length > 0 ? `${parts.join("/")}/` : ""
    const file = { name, time: times?.get(path) ?? Number.NEGATIVE_INFINITY, files: 1 }
    const files = byDirectory.get(directory)
    if (files) files.push(file)
    else byDirectory.set(directory, [file])
  }
  const leaves = leafDirectories([...byDirectory.keys()])
  const groups = [...idFamilies(byDirectory, leaves), ...uniformSiblings(byDirectory, leaves)]
  const grouped = new Set(groups.flatMap((group) => group.members))
  const lines: DirectoryGroup[] = [...byDirectory]
    .filter(([directory]) => !grouped.has(directory))
    .map(([directory, files]) => ({ ...labelled(directory), files, grouped: false }))
  for (const group of groups) lines.push(group.line)
  const root = lines.filter((line) => line.label === `${MEMORY_DIR}/`)
  return [...root, ...lines.filter((line) => line.label !== `${MEMORY_DIR}/`).sort((a, b) => a.label.localeCompare(b.label))]
}

interface SiblingGroup {
  readonly members: readonly string[]
  readonly line: DirectoryGroup
}

function labelled(directory: string): Pick<DirectoryGroup, "label" | "pointer"> {
  if (directory === "") return { label: `${MEMORY_DIR}/`, pointer: `${MEMORY_DIR}/` }
  const parts = directory.split("/").filter(Boolean)
  const readable = parts.slice(0, firstRedacted(parts))
  return {
    label: `${parts.map(redactSecretLikeMaterial).join("/")}/`,
    pointer: `${MEMORY_DIR}/${readable.length === 0 ? "" : `${readable.join("/")}/`}`,
  }
}

function firstRedacted(parts: readonly string[]): number {
  const index = parts.findIndex((part) => redactSecretLikeMaterial(part) !== part)
  return index === -1 ? parts.length : index
}

/** Directories with no directory below them, keyed by parent: only those can share a line. */
function leafDirectories(directories: readonly string[]): Map<string, string[]> {
  const leaves = new Map<string, string[]>()
  for (const directory of directories) {
    if (directory === "" || directories.some((other) => other !== directory && other.startsWith(directory))) continue
    const parent = directory.slice(0, directory.slice(0, -1).lastIndexOf("/") + 1)
    if (redactSecretLikeMaterial(segment(directory, parent)) !== segment(directory, parent)) continue
    const siblings = leaves.get(parent)
    if (siblings) siblings.push(directory)
    else leaves.set(parent, [directory])
  }
  return leaves
}

const segment = (directory: string, parent: string): string => directory.slice(parent.length, -1)

function idFamilies(byDirectory: ReadonlyMap<string, readonly NamedFile[]>, leaves: ReadonlyMap<string, readonly string[]>): SiblingGroup[] {
  const groups: SiblingGroup[] = []
  for (const [parent, siblings] of leaves) {
    const ids = generatedIds(siblings.map((directory) => segment(directory, parent)))
    const members = siblings.filter((directory) => ids.has(segment(directory, parent)))
    if (members.length < MIN_SIBLINGS) continue
    const { label, pointer } = labelled(parent)
    groups.push({
      members,
      line: { label: `${parent === "" ? "" : label}<id>/ (${members.length} dirs)`, pointer, files: members.flatMap((directory) => byDirectory.get(directory) ?? []), grouped: true },
    })
  }
  return groups
}

function uniformSiblings(byDirectory: ReadonlyMap<string, readonly NamedFile[]>, leaves: ReadonlyMap<string, readonly string[]>): SiblingGroup[] {
  const groups: SiblingGroup[] = []
  for (const [parent, siblings] of leaves) {
    const ids = generatedIds(siblings.map((directory) => segment(directory, parent)))
    const byNames = new Map<string, string[]>()
    for (const directory of siblings) {
      if (ids.has(segment(directory, parent))) continue
      const key = (byDirectory.get(directory) ?? []).map((file) => file.name).sort().join("\0")
      const same = byNames.get(key)
      if (same) same.push(directory)
      else byNames.set(key, [directory])
    }
    for (const members of byNames.values()) {
      if (members.length < MIN_SIBLINGS || members.some((directory) => /[{}]|, /.test(segment(directory, parent)))) continue
      const { label, pointer } = labelled(parent)
      const names = members.map((directory) => segment(directory, parent)).sort((a, b) => a.localeCompare(b))
      groups.push({
        members,
        line: { label: `${parent === "" ? "" : label}{${names.join(", ")}}/`, pointer, files: members.flatMap((directory) => byDirectory.get(directory) ?? []), grouped: true },
      })
    }
  }
  return groups
}
