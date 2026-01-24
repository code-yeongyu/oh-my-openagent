import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import type { ParserOptions } from './types.js';

/**
 * Type for a processor that can parse markdown to AST.
 */
export interface MarkdownProcessor {
  parse(markdown: string): Root;
}

/**
 * Creates a configured unified processor for parsing Markdown.
 *
 * @param options - Parser configuration options
 * @returns A unified processor configured for Markdown parsing
 *
 * @example
 * ```typescript
 * const processor = createProcessor();
 * const ast = processor.parse('# Hello');
 * ```
 */
export function createProcessor(options: ParserOptions = {}): MarkdownProcessor {
  const { gfm = true } = options;

  // Build the processor with all plugins
  let processor = unified().use(remarkParse);

  if (gfm) {
    processor = processor.use(remarkGfm);
  }

  return {
    parse: (markdown: string): Root => processor.parse(markdown),
  };
}
