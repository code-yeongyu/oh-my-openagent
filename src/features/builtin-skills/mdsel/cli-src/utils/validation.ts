import type { Root, Parent } from 'mdast';

/**
 * Default configuration constants for validation.
 */
export const DEFAULT_MAX_DEPTH = 20;
export const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const BINARY_THRESHOLD_RATIO = 0.1; // 10% null bytes indicates binary

/**
 * Detects if content is likely binary by checking for null bytes.
 *
 * Binary files often contain null bytes (0x00) which are rare in text files.
 * This function samples the beginning of the content and checks if more than
 * the threshold ratio of bytes are null characters.
 *
 * @param content - The string content to check
 * @param sampleSize - Number of characters to sample from the beginning (default: 1024)
 * @returns true if content appears to be binary, false otherwise
 *
 * @example
 * ```typescript
 * const textContent = '# Hello World';
 * isLikelyBinary(textContent); // false
 *
 * const binaryContent = '\x00\x00\x00\x00';
 * isLikelyBinary(binaryContent); // true
 * ```
 */
export function isLikelyBinary(content: string, sampleSize = 1024): boolean {
  if (!content || content.length === 0) {
    return false;
  }

  const sample = content.slice(0, sampleSize);
  const nullCount = (sample.match(/\0/g) ?? []).length;
  const ratio = nullCount / sample.length;

  return ratio > BINARY_THRESHOLD_RATIO;
}

/**
 * Validates if a Buffer contains valid UTF-8 encoded data.
 *
 * This function uses the TextDecoder API which will throw (or produce replacement
 * characters) for invalid UTF-8 sequences.
 *
 * @param buffer - The buffer to validate
 * @returns true if buffer contains valid UTF-8, false otherwise
 *
 * @example
 * ```typescript
 * const validBuffer = Buffer.from('Hello', 'utf-8');
 * isValidUtf8(validBuffer); // true
 *
 * const invalidBuffer = Buffer.from([0xFF, 0xFF, 0xFF]);
 * isValidUtf8(invalidBuffer); // false
 * ```
 */
export function isValidUtf8(buffer: Buffer): boolean {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoder.decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Calculates the maximum nesting depth of an mdast tree.
 *
 * Depth is calculated by traversing the tree and finding the longest path
 * from root to any leaf node. This is useful for detecting deeply nested
 * structures that might cause performance issues.
 *
 * @param ast - The mdast Root node
 * @returns The maximum depth of the tree
 *
 * @example
 * ```typescript
 * const { ast } = parseMarkdown('# Title\n\n## Subtitle');
 * getNestingDepth(ast); // 2 (root -> heading -> text)
 * ```
 */
export function getNestingDepth(ast: Root): number {
  let maxDepth = 0;

  function traverse(node: Root | Parent, currentDepth: number): void {
    maxDepth = Math.max(maxDepth, currentDepth);

    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child as Root | Parent, currentDepth + 1);
      }
    }
  }

  traverse(ast, 0);
  return maxDepth;
}

/**
 * Sanitizes input content by normalizing line endings and trimming.
 *
 * This function:
 * 1. Normalizes CRLF and CR line endings to LF
 * 2. Trims leading and trailing whitespace
 *
 * @param content - The markdown content to sanitize
 * @returns The sanitized content
 *
 * @example
 * ```typescript
 * const windowsContent = '# Title\r\n\r\nContent';
 * sanitizeInput(windowsContent); // '# Title\n\nContent'
 * ```
 */
export function sanitizeInput(content: string): string {
  if (!content) return '';

  // Normalize CRLF (\r\n) and CR (\r) to LF (\n)
  let normalized = content.replace(/\r\n?/g, '\n');

  // Trim leading and trailing whitespace (but preserve internal whitespace)
  normalized = normalized.trim();

  return normalized;
}

/**
 * Validates file size against a maximum limit.
 *
 * @param fileSize - The size of the file in bytes
 * @param maxSize - The maximum allowed file size in bytes (default: 50MB)
 * @returns true if file size is within limits, false otherwise
 *
 * @example
 * ```typescript
 * isValidFileSize(1024 * 1024); // true (1MB)
 * isValidFileSize(100 * 1024 * 1024); // false (100MB exceeds default 50MB)
 * ```
 */
export function isValidFileSize(fileSize: number, maxSize = DEFAULT_MAX_FILE_SIZE): boolean {
  return fileSize <= maxSize;
}

/**
 * Formats file size for human-readable display.
 *
 * @param bytes - The size in bytes
 * @returns Formatted string (e.g., "1.5 MB", "512 KB")
 *
 * @example
 * ```typescript
 * formatFileSize(1536000); // "1.46 MB"
 * formatFileSize(512); // "512 B"
 * ```
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex] ?? 'B'}`;
}
