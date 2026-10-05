export const ignoredSkillSourceDirNames: readonly string[];
export const ignoredSkillSourceFileNames: readonly string[];

export interface SkillSourceCopyFilterOptions {
	/** Additional file names (basename) to skip, merged with the shared defaults. */
	ignoredFileNames?: readonly string[];
}

/**
 * Returns an fs.cp-compatible filter for copying one skill source tree. Ignore rules are
 * evaluated against the path RELATIVE to sourceRoot, never against the checkout's ancestors.
 */
export function createSkillSourceCopyFilter(
	sourceRoot: string,
	options?: SkillSourceCopyFilterOptions,
): (sourcePath: string) => boolean;
