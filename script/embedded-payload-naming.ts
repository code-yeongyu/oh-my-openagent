/** Directory name that prefixes every embedded asset name. */
export const EMBEDDED_PAYLOAD_ROOT = "omo-runtime"
/** Relative path of the embedded runtime manifest inside the payload root. */
export const RUNTIME_MANIFEST_REL_PATH = "runtime-manifest.json"

/** Maps a payload-relative path to the name bun assigns the embedded asset. */
export function embeddedNameForRelPath(relPath: string): string {
  return `${EMBEDDED_PAYLOAD_ROOT}/${relPath}`
}

/** Inverse of {@link embeddedNameForRelPath}; undefined for non-payload assets. */
export function relPathForEmbeddedName(embeddedName: string): string | undefined {
  const prefix = `${EMBEDDED_PAYLOAD_ROOT}/`
  if (!embeddedName.startsWith(prefix)) return undefined
  return embeddedName.slice(prefix.length)
}
