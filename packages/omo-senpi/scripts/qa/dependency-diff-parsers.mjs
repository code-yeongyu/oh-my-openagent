// Dependency entries of one manifest or lockfile, as `entry key -> value` where the KEY names WHAT
// the repository depends on and the VALUE says which version. `dependency-diff-check.mjs` compares
// two revisions of a file through these maps: a key present only at head is an ADDED dependency; the
// same key with another value is a bump. Lockfiles whose keys embed the version (yarn selectors,
// pnpm package keys) are therefore re-keyed by package name with every resolved version as the value,
// so a bump never masquerades as an addition and a second version of a known name is a change.
// Every reader is pure and throws on text it cannot read; the caller decides what unreadable means.

const MANIFEST_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
const PACKAGE_JSON_SECTIONS = [...MANIFEST_SECTIONS, "overrides", "resolutions"]

/** The files the control reads, by basename. `bun.lockb` is binary: listed, never parsed. */
export const MANIFEST_KINDS = new Map([
  ["package.json", "package.json"],
  ["bun.lock", "bun.lock"],
  ["bun.lockb", "opaque"],
  ["package-lock.json", "npm-lock"],
  ["npm-shrinkwrap.json", "npm-lock"],
  ["yarn.lock", "yarn.lock"],
  ["pnpm-lock.yaml", "pnpm-lock"],
])

export function manifestKind(path) {
  const base = path.slice(path.lastIndexOf("/") + 1)
  if (/(^|\/)node_modules\//u.test(path)) return undefined
  return MANIFEST_KINDS.get(base)
}

/** `entry -> value` for one file, or `undefined` for an opaque kind. Throws when the text is unreadable. */
export function entriesOf(kind, text) {
  switch (kind) {
    case "package.json": return packageJsonEntries(JSON.parse(text))
    case "bun.lock": return bunLockEntries(JSON.parse(stripJsonc(text)))
    case "npm-lock": return npmLockEntries(JSON.parse(text))
    case "yarn.lock": return yarnLockEntries(text)
    case "pnpm-lock": return pnpmLockEntries(text)
    case "opaque": return undefined
    default: throw new Error(`unknown manifest kind ${kind}`)
  }
}

export function packageJsonEntries(json) {
  const entries = new Map()
  addSections(entries, json, PACKAGE_JSON_SECTIONS, "")
  const bundled = json.bundledDependencies ?? json.bundleDependencies
  if (Array.isArray(bundled)) for (const name of bundled) if (typeof name === "string") entries.set(`bundledDependencies:${name}`, "*")
  return entries
}

function addSections(entries, json, sections, prefix) {
  if (!isRecord(json)) return
  for (const section of sections) {
    const block = json[section]
    if (!isRecord(block)) continue
    for (const [name, spec] of Object.entries(block)) entries.set(`${prefix}${section}:${name}`, typeof spec === "string" ? spec : JSON.stringify(spec))
  }
}

/** bun.lock: every workspace's dependency sections, the resolved `packages` map, overrides and patches. */
export function bunLockEntries(json) {
  const entries = new Map()
  if (isRecord(json.workspaces)) {
    for (const [path, workspace] of Object.entries(json.workspaces)) addSections(entries, workspace, MANIFEST_SECTIONS, `workspaces:${path}:`)
  }
  if (isRecord(json.packages)) {
    for (const [key, tuple] of Object.entries(json.packages)) {
      entries.set(`packages:${key}`, Array.isArray(tuple) && typeof tuple[0] === "string" ? tuple[0] : JSON.stringify(tuple))
    }
  }
  for (const section of ["overrides", "patchedDependencies", "catalog"]) {
    if (!isRecord(json[section])) continue
    for (const [name, spec] of Object.entries(json[section])) entries.set(`${section}:${name}`, typeof spec === "string" ? spec : JSON.stringify(spec))
  }
  return entries
}

/** package-lock.json / npm-shrinkwrap.json: the v2/v3 `packages` map (root sections split out) and the v1 tree. */
export function npmLockEntries(json) {
  const entries = new Map()
  if (isRecord(json.packages)) {
    for (const [path, meta] of Object.entries(json.packages)) {
      if (path === "") addSections(entries, meta, MANIFEST_SECTIONS, "root:")
      else entries.set(`packages:${path}`, isRecord(meta) ? String(meta.version ?? meta.resolved ?? "") : "")
    }
  }
  if (isRecord(json.dependencies)) walkNpmV1(entries, json.dependencies, "dependencies")
  return entries
}

function walkNpmV1(entries, block, prefix) {
  for (const [name, meta] of Object.entries(block)) {
    entries.set(`${prefix}:${name}`, isRecord(meta) ? String(meta.version ?? "") : "")
    if (isRecord(meta) && isRecord(meta.dependencies)) walkNpmV1(entries, meta.dependencies, `${prefix}:${name}/node_modules`)
  }
}

/** yarn.lock (v1 and berry): one entry per package name, valued by every resolved version. */
export function yarnLockEntries(text) {
  const versions = new Map()
  let names = []
  for (const raw of text.split(/\r?\n/u)) {
    if (raw.length === 0 || raw.startsWith("#")) continue
    if (!/^\s/u.test(raw)) {
      const header = raw.replace(/:\s*$/u, "")
      names = header.split(/,\s*/u).map((selector) => nameOfSelector(unquote(selector.trim()))).filter((name) => name.length > 0 && name !== "__metadata")
      for (const name of names) if (!versions.has(name)) versions.set(name, new Set())
      continue
    }
    const version = /^\s+version:?\s+(\S+)\s*$/u.exec(raw)
    if (version !== null) for (const name of names) versions.get(name)?.add(unquote(version[1]))
  }
  return byName(versions, "packages")
}

/** pnpm-lock.yaml: the `packages` and `snapshots` keys, one entry per package name valued by its versions. */
export function pnpmLockEntries(text) {
  const versions = new Map()
  let section
  for (const raw of text.split(/\r?\n/u)) {
    if (raw.length === 0 || raw.startsWith("#")) continue
    const top = /^([A-Za-z][\w-]*):\s*$/u.exec(raw)
    if (top !== null) { section = top[1]; continue }
    if (!/^\s/u.test(raw)) { section = undefined; continue }
    if ((section !== "packages" && section !== "snapshots") || !/^ {2}\S/u.test(raw)) continue
    const { name, version } = splitPackageKey(unquote(raw.trim().replace(/:\s*$/u, "")).replace(/^\//u, ""))
    const bucket = versions.get(`${section}/${name}`) ?? new Set()
    if (version.length > 0) bucket.add(version)
    versions.set(`${section}/${name}`, bucket)
  }
  return byName(versions, "")
}

function byName(versions, prefix) {
  const entries = new Map()
  for (const [name, set] of versions) entries.set(prefix.length === 0 ? name : `${prefix}:${name}`, [...set].sort().join(","))
  return entries
}

/** `@scope/name@range` -> `@scope/name`; `name@range` -> `name`; a bare name stays. */
export function nameOfSelector(selector) {
  const at = selector.indexOf("@", 1)
  return at === -1 ? selector : selector.slice(0, at)
}

/** pnpm package keys: `name@1.2.3(peer@x)` (v6+) or `name/1.2.3` (v5) -> the name and the bare version. */
export function splitPackageKey(key) {
  const name = nameOfSelector(key)
  if (name !== key) return { name, version: key.slice(name.length + 1).replace(/\(.*$/u, "") }
  const slash = key.lastIndexOf("/")
  return slash > 0 ? { name: key.slice(0, slash), version: key.slice(slash + 1) } : { name: key, version: "" }
}

function unquote(text) {
  return /^(['"]).*\1$/u.test(text) ? text.slice(1, -1) : text
}

/** JSON with trailing commas and `//` / `/* *\/` comments outside strings (bun.lock's dialect) to strict JSON. */
export function stripJsonc(text) {
  let out = ""
  let inString = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      out += char
      if (char === "\\") { out += text[index + 1] ?? ""; index += 1 }
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') { inString = true; out += char; continue }
    if (char === "/" && text[index + 1] === "/") { index = text.indexOf("\n", index) === -1 ? text.length : text.indexOf("\n", index) - 1; continue }
    if (char === "/" && text[index + 1] === "*") { const end = text.indexOf("*/", index + 2); index = end === -1 ? text.length : end + 1; continue }
    if (char === ",") {
      let ahead = index + 1
      while (ahead < text.length && /\s/u.test(text[ahead])) ahead += 1
      if (text[ahead] === "}" || text[ahead] === "]") continue
    }
    out += char
  }
  return out
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
