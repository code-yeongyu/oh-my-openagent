import { execFileSync } from "node:child_process"
import { basename, dirname, relative, sep } from "node:path"

import { createResolver, type Resolver, type ResolverFiles } from "./remote-import-guard-resolve"
import { ADAPTER_RULES } from "./remote-import-guard-rules"
import { type FileFacts, scanRepository } from "./remote-import-guard-scan"

// The two sides of the moved-file check, read from git at their exact revisions (a sha for the merge base, `HEAD` for the
// head), never from a working tree or a branch name. Each revision is listed once (`git ls-tree -r`) and its blobs are
// read in batches through one `git cat-file --batch` per call. A revision whose tree cannot be listed, or a listed blob
// that cannot be read (a blob-filtered clone), is recorded as missing with the fetch that cures it: the check fails closed
// on it instead of treating the file as absent.

/** Runs git in the repository; undefined when git fails (an object this checkout does not have). */
export type GitReader = (args: readonly string[]) => string | undefined
/** Reads objects by `<rev>:<path>` name in one process; a name absent from the answer could not be read. */
export type BlobBatch = (names: readonly string[]) => ReadonlyMap<string, string>

export type Trees = {
  readonly base: string
  /** A file at a revision; undefined when that tree has no such file (a listed file that cannot be read is missing). */
  readonly read: (ref: string, path: string) => string | undefined
  readonly list: (ref: string, directory: string) => readonly string[]
  readonly resolver: (ref: string) => Resolver
  /** Whether some non-test source file under packages/ imports the file at the head, by any edge form. */
  readonly isImported: (file: string) => boolean
  /** Objects this checkout lacks, each with the fetch that cures it; non-empty means the check cannot conclude. */
  readonly missing: () => readonly string[]
}

const toPosix = (path: string): string => path.split(sep).join("/")
const lines = (text: string | undefined): string[] => (text ?? "").split("\n").filter(Boolean)

const SOURCE = /\.[cm]?[jt]sx?$/

const importsOf = (facts: readonly FileFacts[], resolve: Resolver, file: string): boolean =>
  facts.some(
    (fact) =>
      !ADAPTER_RULES.testFile(fact.file) && fact.edges.some((edge) => resolve(fact.file, edge.specifier) === file),
  )

// Every specifier that can name a file carries its name without the extension, its directory's name when it is an index
// file, or a package exports/imports key that resolves to it; a source file that contains none of them cannot import it,
// so only the files git grep finds at HEAD are scanned.
function specifierNeedles(file: string, resolve: Resolver, manifest: (dir: string) => string | undefined): string[] {
  const stem = basename(file).replace(/\.[^.]+$/, "")
  const needles = new Set([stem === "index" ? basename(dirname(file)) : stem])
  const pkg = /^packages\/[^/]+\//.exec(file)?.[0]
  const json = pkg === undefined ? undefined : manifest(pkg)
  if (json !== undefined) {
    const parsed = JSON.parse(json) as { name?: unknown; exports?: unknown; imports?: unknown }
    const keys = [parsed.exports, parsed.imports].flatMap((map) =>
      map !== null && typeof map === "object" && !Array.isArray(map) ? Object.keys(map) : [],
    )
    for (const key of keys) {
      const specifier = key.startsWith("#") ? key : `${String(parsed.name)}${key.slice(1)}`
      if (resolve(file, specifier) === file) needles.add(specifier)
    }
  }
  return [...needles]
}

function catFileBatch(repoRoot: string): BlobBatch {
  return (names) => {
    const found = new Map<string, string>()
    if (names.length === 0) return found
    const output = execFileSync("git", ["cat-file", "--batch"], {
      cwd: repoRoot,
      input: `${names.join("\n")}\n`,
      maxBuffer: 1 << 30,
      stdio: ["pipe", "pipe", "ignore"],
    })
    let at = 0
    for (const name of names) {
      const end = output.indexOf(10, at)
      const header = output.subarray(at, end).toString("utf8")
      at = end + 1
      const size = /^[0-9a-f]+ \w+ (\d+)$/.exec(header)?.[1]
      if (size === undefined) continue
      found.set(name, output.subarray(at, at + Number(size)).toString("utf8"))
      at += Number(size) + 1
    }
    return found
  }
}

type Revision = { readonly files: ReadonlySet<string>; readonly children: ReadonlyMap<string, ReadonlySet<string>> }

/** Both sides from git at their exact revisions; `prefetch` names the paths read in the first batch of each revision. */
export function gitTrees(
  git: GitReader,
  base: string,
  repoRoot: string,
  prefetch: (files: ReadonlySet<string>) => readonly string[],
  batch: BlobBatch = catFileBatch(repoRoot),
): Trees {
  const missing = new Set<string>()
  const revisions = new Map<string, Revision>()
  const blobs = new Map<string, string>()
  const fetched = new Set<string>()
  const revision = (ref: string): Revision => {
    const known = revisions.get(ref)
    if (known !== undefined) return known
    const listing = git(["ls-tree", "-r", "--name-only", ref])
    if (listing === undefined)
      missing.add(`the tree of ${ref} is not in this checkout: fetch it (git fetch origin ${ref})`)
    const files = new Set(lines(listing))
    const children = new Map<string, Set<string>>()
    for (const file of files) {
      const parts = file.split("/")
      for (let depth = 1; depth < parts.length; depth++) {
        const parent = parts.slice(0, depth - 1).join("/")
        children.set(parent, (children.get(parent) ?? new Set<string>()).add(parts[depth - 1] ?? ""))
      }
    }
    const made = { files, children }
    revisions.set(ref, made)
    return made
  }
  const load = (ref: string, paths: readonly string[]): void => {
    const names = paths.map((path) => `${ref}:${path}`).filter((name) => !fetched.has(name))
    for (const [name, text] of batch(names)) blobs.set(name, text)
    for (const name of names) {
      fetched.add(name)
      if (!blobs.has(name))
        missing.add(`${name} is listed but cannot be read: fetch its blobs (git fetch origin ${ref})`)
    }
  }
  const read = (ref: string, path: string): string | undefined => {
    const files = revision(ref).files
    if (!files.has(path)) return undefined
    if (!fetched.has(`${ref}:${path}`))
      load(ref, [...new Set([path, ...prefetch(files).filter((file) => files.has(file))])])
    return blobs.get(`${ref}:${path}`)
  }
  const resolvers = new Map<string, Resolver>()
  const files = (ref: string): ResolverFiles => {
    const inRepo = (path: string): string => toPosix(relative(repoRoot, path))
    return {
      isFile: (path) => revision(ref).files.has(inRepo(path)),
      readText: (path) => read(ref, inRepo(path)) ?? "",
      directories: (path) => [...(revision(ref).children.get(inRepo(path)) ?? [])],
    }
  }
  const importedAnswers = new Map<string, boolean>()
  const isImported = (file: string): boolean => {
    const known = importedAnswers.get(file)
    if (known !== undefined) return known
    const resolve = createResolver(repoRoot)
    const needles = specifierNeedles(file, resolve, (dir) => read("HEAD", `${dir}package.json`))
    const grep = git(["grep", "-l", "-F", ...needles.flatMap((needle) => ["-e", needle]), "HEAD", "--", "packages"])
    const candidates = lines(grep)
      .map((line) => line.replace(/^HEAD:/, ""))
      .filter((path) => SOURCE.test(path) && path !== file)
    const answer = importsOf(scanRepository(repoRoot, candidates), resolve, file)
    importedAnswers.set(file, answer)
    return answer
  }
  return {
    base,
    read,
    list: (ref, directory) => [...revision(ref).files].filter((file) => file.startsWith(directory)).toSorted(),
    resolver: (ref) => {
      const resolve = resolvers.get(ref) ?? createResolver(repoRoot, files(ref))
      resolvers.set(ref, resolve)
      return resolve
    },
    isImported,
    missing: () => [...missing],
  }
}
