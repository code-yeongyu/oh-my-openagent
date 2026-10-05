/**
 * Single source of truth for which files inside a skill source tree are copied into a
 * harness plugin. Both omo-codex and omo-senpi sync-skills scripts consume this.
 *
 * Segments are tested RELATIVE to the copy root. The ignore list targets the skill tree's
 * own cache directories; it must never react to where the repository happens to be checked
 * out (a clone under ~/.omo/... or beneath any __pycache__-named ancestor still ships its
 * skills). Testing the absolute path was the defect this module replaces.
 */

export const ignoredSkillSourceDirNames = Object.freeze([".mypy_cache", ".omo", ".pytest_cache", ".ruff_cache", "__pycache__"]);
export const ignoredSkillSourceFileNames = Object.freeze([".gitignore", ".npmignore", "pyrightconfig.json"]);
const sourceTestFilePattern = /\.test\.ts$/;

function toSegments(path) {
	return path.replaceAll("\\", "/").split("/").filter((segment) => segment.length > 0);
}

/**
 * @param {string} sourceRoot absolute path of the directory being copied
 * @param {{ ignoredFileNames?: readonly string[] }} [options]
 * @returns {(sourcePath: string) => boolean} an fs.cp-compatible filter
 */
export function createSkillSourceCopyFilter(sourceRoot, options = {}) {
	const rootSegments = toSegments(sourceRoot);
	const ignoredFileNames = new Set([...ignoredSkillSourceFileNames, ...(options.ignoredFileNames ?? [])]);
	const ignoredDirNames = new Set(ignoredSkillSourceDirNames);

	return function shouldCopySkillSource(sourcePath) {
		const pathSegments = toSegments(sourcePath);
		if (pathSegments.length < rootSegments.length) return false;
		for (let index = 0; index < rootSegments.length; index += 1) {
			if (pathSegments[index] !== rootSegments[index]) return false;
		}
		const segments = pathSegments.slice(rootSegments.length);
		if (segments.length === 0) return true;
		const name = segments.at(-1) ?? "";
		if (segments.some((segment) => ignoredDirNames.has(segment))) return false;
		if (ignoredFileNames.has(name)) return false;
		if (sourceTestFilePattern.test(name) || name.endsWith(".pyc")) return false;
		const scriptsIndex = segments.lastIndexOf("scripts");
		return scriptsIndex === -1 || segments[scriptsIndex + 1] !== "tests";
	};
}
