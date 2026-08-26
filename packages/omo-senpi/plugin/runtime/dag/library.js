// Stored dag definitions for JavaScript eval cells: load a named definition from the dag library
// directories and start it, without pasting the full definition JSON into the cell. Like sdk.js
// this file must stay import-free: the eval worker has no node_modules on its resolver path, and
// the globals it needs (`read`, `env`, `tool`) are injected by the kernel at call time.
//
// Library dirs, first hit wins: $OMO_DAG_LIBRARY (colon-separated), $PWD/.omo/dags, $HOME/.omo/dags.
// A definition is the plain dag definition JSON with two extras: string values may carry
// {{key}} / {{date}} / {{datetime}} placeholders, and `key` is treated as a base key that load()
// rotates with a suffix so the same stored graph can run repeatedly (suffix "" keeps it idempotent).

function kernel(name) {
  const value = globalThis[name]
  if (value === undefined || value === null) {
    throw new Error(`dag library: the eval kernel global \`${name}\` is unavailable here.`)
  }
  return value
}

function libraryDirs() {
  const env = kernel("env")
  const dirs = []
  const configured = env("OMO_DAG_LIBRARY")
  if (typeof configured === "string" && configured !== "") {
    const separator = globalThis.process?.platform === "win32" ? ";" : ":"
    dirs.push(...configured.split(separator).filter((dir) => dir !== ""))
  }
  const pwd = env("PWD")
  if (typeof pwd === "string" && pwd !== "") dirs.push(`${pwd}/.omo/dags`)
  const home = env("HOME")
  if (typeof home === "string" && home !== "") dirs.push(`${home}/.omo/dags`)
  return dirs
}

async function readDefinitionText(name, dirs) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`dag library: invalid definition name "${name}" (letters, digits, dot, dash, underscore).`)
  }
  const read = kernel("read")
  for (const dir of dirs) {
    try {
      return await read(`${dir}/${name}.json`)
    } catch {
    }
  }
  throw new Error(`dag library: definition "${name}" not found. Searched: ${dirs.join(", ")}`)
}

function utcVars(finalKey, now) {
  const stamp = now.toISOString()
  const date = stamp.slice(0, 10).replaceAll("-", "")
  const datetime = `${date}-${stamp.slice(11, 19).replaceAll(":", "")}`
  return { key: finalKey, date, datetime }
}

function fillPlaceholders(value, vars) {
  if (typeof value === "string") {
    return value.replaceAll("{{key}}", vars.key).replaceAll("{{date}}", vars.date).replaceAll("{{datetime}}", vars.datetime)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => fillPlaceholders(entry, vars))
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([field, entry]) => [field, fillPlaceholders(entry, vars)]))
  }
  return value
}

export async function load(name, options) {
  const text = await readDefinitionText(name, libraryDirs())
  const definition = JSON.parse(text)
  if (typeof definition.key !== "string" || definition.key === "") {
    throw new Error(`dag library: definition "${name}" needs a non-empty string key (the base idempotency key).`)
  }
  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
    throw new Error(`dag library: definition "${name}" needs a non-empty nodes array.`)
  }
  const suffix = options?.suffix
  const now = new Date()
  const finalKey = suffix === "" ? definition.key : `${definition.key}-${suffix ?? utcVars("", now).datetime}`
  return { ...fillPlaceholders(definition, utcVars(finalKey, now)), key: finalKey }
}

// Mirrors sdk.js: a refused start resolves with { details: { kind: "error", error: { code, message } } }
// and no run_id, so surface the tool's own words instead of the missing-run_id symptom.
function throwIfToolError(action, response) {
  if (response?.details?.kind !== "error") return response
  const error = response.details.error
  const code = typeof error?.code === "string" && error.code !== "" ? error.code : undefined
  const message = typeof error?.message === "string" && error.message !== "" ? error.message : undefined
  const detail =
    code === undefined && message === undefined
      ? firstContentText(response) ?? "the dag tool reported an error with no details."
      : [code, message].filter((part) => part !== undefined).join(": ")
  throw new Error(`dag library: ${action} failed: ${detail}`)
}

function firstContentText(response) {
  const content = response?.content
  if (!Array.isArray(content)) return undefined
  for (const entry of content) {
    if (typeof entry?.text === "string" && entry.text !== "") return entry.text
  }
  return undefined
}

export async function start(name, options) {
  const definition = await load(name, options)
  const response = throwIfToolError("start", await kernel("tool").dag({ action: "start", definition }))
  const runId = response?.details?.run_id ?? response?.run_id
  if (typeof runId !== "string" || runId === "") {
    throw new Error("dag library: the dag start response did not include a run_id.")
  }
  const dag = kernel("tool").dag
  return {
    ...response,
    run_id: runId,
    // done() blocks for the final result, opting out of the tool's detached default.
    done: () => dag({ action: "wait", run_id: runId, detach: false }),
    cancel: (reason) =>
      reason === undefined
        ? dag({ action: "cancel", run_id: runId })
        : dag({ action: "cancel", run_id: runId, reason }),
  }
}
