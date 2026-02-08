import { basename, resolve } from "path"

/**
 * Extracts the project folder name from a directory path.
 * Returns empty string for root path "/" or empty input.
 */
export function extractProjectName(directory: string): string {
  if (!directory) return ""
  const resolved = resolve(directory)
  const name = basename(resolved)
  return name === "/" ? "" : name
}

/**
 * Resolves template variables {project} and {cwd} in a format string.
 * Unrecognized variables (e.g., {unknown}) are left as-is.
 */
export function resolveMessageFormat(
  format: string,
  vars: { project: string; cwd: string }
): string {
  return format
    .replace("{project}", vars.project)
    .replace("{cwd}", vars.cwd)
}
