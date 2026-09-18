/**
 * Cross-platform path validator for Prometheus file writes.
 * Uses path.resolve/relative instead of string matching to handle:
 * - Windows backslashes (e.g., .omo\\plans\\x.md)
 * - Mixed separators (e.g., .omo\\plans/x.md)
 * - Case-insensitive directory/extension matching
 * - Workspace confinement (blocks paths outside root or via traversal)
 * - Nested project paths (e.g., parent/.omo/... when ctx.directory is parent)
 */
export declare function isAllowedFile(filePath: string, workspaceRoot: string): boolean;
