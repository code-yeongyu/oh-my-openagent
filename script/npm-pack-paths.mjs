// npm 11 prints `npm pack --json` as an array of package results; npm 12 (the npm bundled with
// Node 26) prints an object keyed by package name. Reading only the array shape throws
// "TypeError: parsed is not iterable" on npm 12, which reads as a broken script rather than a
// version difference.
export function parseNpmPackResult(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`npm pack --json did not return JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const results = Array.isArray(parsed) ? parsed : Object.values(parsed ?? {})
  const [result] = results
  if (result === null || typeof result !== "object" || !Array.isArray(result.files)) {
    throw new Error("npm pack --json returned no packed file list; expected an array of results or an object keyed by package name")
  }
  return result
}

export function parseNpmPackPaths(raw) {
  return parseNpmPackResult(raw).files.map((file) => {
    if (file === null || typeof file !== "object" || typeof file.path !== "string") {
      throw new Error("npm pack --json returned a packed entry without a string path")
    }
    return file.path
  })
}
