/**
 * Plan format detection for v1 (flat) vs v2 (hierarchical) plan structures
 *
 * v1: No format metadata header → defaults to flat structure
 * v2: Has `Plan-Format: 2` metadata → hierarchical structure
 *
 * Backward compatible: Missing metadata → v1
 */

export const FORMAT_METADATA_HEADER = "<!-- Plan-Format: {version} -->";

/**
 * Detects plan format version from markdown content
 *
 * Looks for HTML comment with `Plan-Format: N` metadata header.
 * Case-insensitive, whitespace-tolerant. Defaults to v1 if missing.
 */
export function detectPlanFormat(
  markdownContent: string
): "v1" | "v2" {
  if (!markdownContent || markdownContent.trim().length === 0) {
    return "v1";
  }

  // Look for Plan-Format metadata in HTML comments
  // Pattern: <!-- Plan-Format: 2 --> (case-insensitive, whitespace-tolerant)
  const metadataPattern = /<!--\s*plan-format\s*:\s*(\d)\s*-->/i;
  const match = markdownContent.match(metadataPattern);

  if (match) {
    const version = match[1];
    return version === "2" ? "v2" : "v1";
  }

  // No metadata found → default to v1 (backward compatible)
  return "v1";
}

/**
 * Adds format metadata header to plan content
 *
 * Prepends HTML comment with format version at the top of the content.
 * Preserves original content exactly, adds blank line separator.
 */
export function addFormatMetadata(
  content: string,
  version: "v1" | "v2"
): string {
  const versionNumber = version === "v2" ? "2" : "1";
  const header = `<!-- Plan-Format: ${versionNumber} -->`;

  if (!content || content.trim().length === 0) {
    return header;
  }

  return `${header}\n\n${content}`;
}
