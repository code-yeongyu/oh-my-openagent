/**
 * Memory file frontmatter parse/render — letta-exact parity port.
 *
 * Format (letta tools/impl/memory.ts:472-553, memory-apply-patch.ts:644-714):
 * ---\n description: <single-line non-empty>\n [read_only: <value>]\n [limit: tolerated-ignored]\n ---\n <body>
 *
 * Tolerances (from source at a75f4d93e):
 * - Frontmatter delimited by ^---\r?\n ... \r?\n---\r?\n?
 * - Key parsing: split on FIRST colon, trim key and value
 * - description: required, non-empty (whitespace-only rejected)
 * - read_only: string value preserved verbatim (not coerced to boolean)
 * - limit: tolerated (parsed but not surfaced in the frontmatter object)
 * - Unknown keys: silently ignored (hook-layer enforces allowed set)
 * - CRLF normalized: regex tolerates \r\n on read; render emits LF only
 * - sanitizeFrontmatterValue collapses \r?\n to spaces then trims
 *
 * Dual-copy verdict: memory.ts:472-553 and memory-apply-patch.ts:644-714
 * are BEHAVIORALLY IDENTICAL. The only divergence is error-message prefix
 * ("memory:" vs "memory_apply_patch:"). This module uses a neutral prefix
 * since tool-level distinction is the caller's responsibility (todo 9/10).
 */

export interface ParsedMemoryFile {
  frontmatter: {
    description: string;
    read_only?: string;
  };
  body: string;
}

export class FrontmatterError extends Error {
  override readonly name = "FrontmatterError";
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse a memory markdown file, extracting frontmatter and body.
 *
 * Throws FrontmatterError if:
 * - frontmatter delimiters are missing/malformed
 * - description is absent or whitespace-only
 */
export function parseMemoryFile(content: string): ParsedMemoryFile {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    throw new FrontmatterError(
      "frontmatter: target file is missing required frontmatter",
    );
  }

  const frontmatterText = match[1] ?? "";
  const body = match[2] ?? "";

  let description: string | undefined;
  let readOnly: string | undefined;

  for (const line of frontmatterText.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    if (key === "description") {
      description = value;
    } else if (key === "read_only") {
      readOnly = value;
    }
    // 'limit' and unknown keys are tolerated-ignored per letta source.
  }

  if (!description || !description.trim()) {
    throw new FrontmatterError(
      "frontmatter: target file frontmatter is missing 'description'",
    );
  }

  return {
    frontmatter: {
      description,
      ...(readOnly !== undefined ? { read_only: readOnly } : {}),
    },
    body,
  };
}

/**
 * Render a memory markdown file from frontmatter and body.
 *
 * - description is sanitized to a single line (newlines collapsed to spaces)
 * - read_only preserved verbatim when present
 * - empty body yields header with trailing newline; non-empty body appended as-is
 * - LF only output (CRLF normalized)
 *
 * Throws FrontmatterError if description is empty after trimming.
 */
export function renderMemoryFile(
  frontmatter: { description: string; read_only?: string },
  body: string,
): string {
  const description = frontmatter.description.trim();
  if (!description) {
    throw new FrontmatterError(
      "frontmatter: 'description' must not be empty",
    );
  }

  const lines = [
    "---",
    `description: ${sanitizeFrontmatterValue(description)}`,
  ];

  if (frontmatter.read_only !== undefined) {
    lines.push(`read_only: ${frontmatter.read_only}`);
  }

  lines.push("---");

  const header = lines.join("\n");
  if (!body) {
    return `${header}\n`;
  }
  return `${header}\n${body}`;
}

/**
 * Sanitize a frontmatter value to a single line by collapsing
 * any \r?\n sequence to a space, then trimming.
 */
function sanitizeFrontmatterValue(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}
