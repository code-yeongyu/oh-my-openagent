/**
 * Namespace derivation utilities for CLI.
 *
 * @module cli/utils/namespace
 */

import { basename, extname } from 'node:path';

/**
 * Derive a namespace from a file path.
 *
 * The namespace is the lowercase filename without extension.
 * Underscores and hyphens are preserved.
 *
 * @param filePath - The file path to derive namespace from
 * @returns Lowercase namespace string
 *
 * @example
 * ```typescript
 * deriveNamespace('README.md');       // 'readme'
 * deriveNamespace('API_GUIDE.md');    // 'api_guide'
 * deriveNamespace('path/to/doc.md');  // 'doc'
 * deriveNamespace('my-file.md');      // 'my-file'
 * ```
 */
export function deriveNamespace(filePath: string): string {
  const base = basename(filePath, extname(filePath));
  return base.toLowerCase();
}
