// A memory repository's git must run against that repository and its own hooks, whatever the process
// that hosts the engine exported. An inherited GIT_CONFIG_COUNT/KEY_n/VALUE_n or GIT_CONFIG_PARAMETERS
// outranks the repository's config: `core.hooksPath=/dev/null` there made every memory commit skip the
// installed pre-commit, commit-msg and post-commit hooks (no validation, no mirror push) without an error
// (omo #12354). GIT_DIR, GIT_WORK_TREE and the rest point git at another repository altogether.
//
// The names are git's own repository-local list (`git rev-parse --local-env-vars`), which git itself clears
// when it moves into another repository, plus GIT_NAMESPACE, which would move every ref the memory repository
// reads or writes. GIT_INDEX_FILE is the one exception: memory-core callers set it on purpose for a temporary index.
// File selection (GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM) is kept, so the user's credentials and identity still apply.
//
// Injected config (GIT_CONFIG_COUNT pairs, GIT_CONFIG_PARAMETERS) is filtered, not dropped: url.*.insteadOf,
// http.extraHeader, credential and safe.directory pairs still reach memory git. Only the keys that take the
// repository's own hooks away are removed: core.hooksPath, core.fsmonitor (memory git pins it, exec.ts), and
// include.path / includeIf.*.path, which git honors from injected config and which can carry core.hooksPath.
const REPOSITORY_LOCAL_GIT_ENV = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
])
const CONFIG_COUNT = "GIT_CONFIG_COUNT"
const CONFIG_PARAMETERS = "GIT_CONFIG_PARAMETERS"
const NUMBERED_CONFIG_PAIR = /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/

/** Whether an injected config key would take the memory repository's own hooks away. */
function defeatsMemoryHooks(key: string): boolean {
  // Section and variable names are case-insensitive; git trims an old-style 'key=value' key before parsing it.
  const name = key.trim()
  const firstDot = name.indexOf(".")
  const lastDot = name.lastIndexOf(".")
  if (firstDot <= 0 || lastDot === name.length - 1) return false
  const section = name.slice(0, firstDot).toLowerCase()
  const variable = name.slice(lastDot + 1).toLowerCase()
  if (section === "core") return firstDot === lastDot && (variable === "hookspath" || variable === "fsmonitor")
  return variable === "path" && (section === "include" || section === "includeif")
}

/** The GIT_CONFIG_COUNT pairs git would apply, or undefined when git would refuse them (it then fails every command). */
function configCountPairs(environment: Map<string, string | undefined>): Array<[string, string]> | undefined {
  const raw = environment.get(CONFIG_COUNT)
  if (raw === undefined) return []
  if (raw.trim() !== "" && !/^\s*\+?\d+$/.test(raw)) return undefined
  const count = Number(raw.trim() || "0")
  const pairs: Array<[string, string]> = []
  for (let index = 0; index < count; index += 1) {
    const key = environment.get(`GIT_CONFIG_KEY_${index}`)
    const value = environment.get(`GIT_CONFIG_VALUE_${index}`)
    if (key === undefined || value === undefined) return undefined
    pairs.push([key, value])
  }
  return pairs
}

/** One single-quoted token as git's sq_dequote_step reads it; `end` is the offset just past it. */
function dequoteStep(text: string, start: number): { value: string; end: number } | undefined {
  if (text[start] !== "'") return undefined
  let value = ""
  let at = start + 1
  for (;;) {
    const quote = text.indexOf("'", at)
    if (quote < 0) return undefined
    value += text.slice(at, quote)
    // `'\''` and `'\!'` resume the quoted part with an escaped character; anything else ends the token.
    const escaped = text[quote + 2]
    if (text[quote + 1] === "\\" && (escaped === "'" || escaped === "!") && text[quote + 3] === "'") {
      value += escaped
      at = quote + 4
      continue
    }
    return { value, end: quote + 1 }
  }
}

/** GIT_CONFIG_PARAMETERS split into its entries' source text and keys, or undefined when git would call it bogus. */
function configParameterEntries(text: string): Array<{ source: string; key: string }> | undefined {
  const entries: Array<{ source: string; key: string }> = []
  let at = 0
  while (at < text.length) {
    const key = dequoteStep(text, at)
    if (!key) return undefined
    let end = key.end
    let name = key.value
    if (text[end] === "=") {
      // new style 'key'='value', or 'key'= for an implicit boolean
      end += 1
      if (text[end] === "'") {
        const value = dequoteStep(text, end)
        if (!value) return undefined
        end = value.end
      }
    } else {
      // old style 'key=value'
      const equals = name.indexOf("=")
      if (equals >= 0) name = name.slice(0, equals)
    }
    if (end < text.length && !/\s/.test(text[end] ?? "")) return undefined
    entries.push({ source: text.slice(at, end), key: name })
    while (end < text.length && /\s/.test(text[end] ?? "")) end += 1
    at = end
  }
  return entries
}

/** The environment a memory repository's git runs with: `environment` minus inherited repository redirection and hook-defeating config. */
export function memoryGitEnvironment(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {}
  // Off Windows, environment names are case-sensitive and git reads only the exact upper-case names, so a
  // `Git_Config_Count` is an unrelated variable that must not become config here either. Windows names are
  // case-insensitive (git-for-windows reads `Git_Dir` as GIT_DIR), so there any spelling counts; of two spellings
  // in one object, the first one is the one read here.
  const gitName = platform === "win32" ? (name: string) => name.toUpperCase() : (name: string) => name
  const byGitName = new Map<string, string | undefined>()
  for (const [name, value] of Object.entries(environment)) {
    const key = gitName(name)
    if (!byGitName.has(key)) byGitName.set(key, value)
    if (REPOSITORY_LOCAL_GIT_ENV.has(key) || NUMBERED_CONFIG_PAIR.test(key)) continue
    if (key === CONFIG_COUNT || key === CONFIG_PARAMETERS) continue
    kept[name] = value
  }

  const pairs = configCountPairs(byGitName)?.filter(([key]) => !defeatsMemoryHooks(key)) ?? []
  if (pairs.length > 0) kept[CONFIG_COUNT] = String(pairs.length)
  pairs.forEach(([key, value], index) => {
    kept[`GIT_CONFIG_KEY_${index}`] = key
    kept[`GIT_CONFIG_VALUE_${index}`] = value
  })

  const parameters = byGitName.get(CONFIG_PARAMETERS)
  const entries = parameters === undefined ? [] : (configParameterEntries(parameters)?.filter((entry) => !defeatsMemoryHooks(entry.key)) ?? [])
  if (entries.length > 0) kept[CONFIG_PARAMETERS] = entries.map((entry) => entry.source).join(" ")
  return kept
}
