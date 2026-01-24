// Public API for the parser module
export { parseMarkdown, parseFile } from './parse.js';
export { createProcessor, type MarkdownProcessor } from './processor.js';
export {
  ParserError,
  type ParserOptions,
  type ParseResult,
  type ParserErrorCode,
  // Re-exported mdast types
  type Root,
  type RootContent,
  type Position,
  type Point,
  type Heading,
  type Paragraph,
  type Code,
  type List,
  type ListItem,
  type Blockquote,
  type Table,
  type TableRow,
  type TableCell,
  type Text,
  type ThematicBreak,
} from './types.js';
