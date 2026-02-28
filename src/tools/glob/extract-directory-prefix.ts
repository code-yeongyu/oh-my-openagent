const GLOB_META = /[*?[\]{]/

/**
 * Splits a glob pattern into a static directory prefix and a glob-only portion.
 *
 * Ripgrep's `--glob` flag doesn't match directory prefixes in patterns.
 * For example, `rg --files --glob='apps/backend/**\/*.ts' /project` returns nothing
 * even though files exist under `/project/apps/backend/`.
 *
 * This function extracts the leading literal path segments so the caller can
 * append them to the search path and pass only the glob portion to ripgrep.
 *
 * @example
 *   extractDirectoryPrefix("apps/backend/**\/*.ts")
 *   // { prefix: "apps/backend", glob: "**\/*.ts" }
 *
 *   extractDirectoryPrefix("**\/*.ts")
 *   // { prefix: "", glob: "**\/*.ts" }
 *
 *   extractDirectoryPrefix("src/{hooks,components}/**\/*.tsx")
 *   // { prefix: "src", glob: "{hooks,components}/**\/*.tsx" }
 */
export function extractDirectoryPrefix(pattern: string): { prefix: string; glob: string } {
  const segments = pattern.split("/")

  let splitIndex = 0
  for (const segment of segments) {
    if (GLOB_META.test(segment)) break
    splitIndex++
  }

  if (splitIndex === 0 || splitIndex === segments.length) {
    return { prefix: "", glob: pattern }
  }

  return {
    prefix: segments.slice(0, splitIndex).join("/"),
    glob: segments.slice(splitIndex).join("/"),
  }
}
