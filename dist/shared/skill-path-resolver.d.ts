/**
 * Resolves @path references in skill content to absolute paths.
 *
 * Matches @references that contain at least one slash (e.g., @scripts/search.py, @data/)
 * to avoid false positives with decorators (@param), JSDoc tags (@ts-ignore), etc.
 *
 * Email addresses are excluded since they have alphanumeric characters before @.
 */
export declare function resolveSkillPathReferences(content: string, basePath: string): string;
