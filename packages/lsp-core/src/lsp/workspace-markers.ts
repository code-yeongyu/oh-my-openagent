/** Repository marker: an ancestor containing this always wins over intermediate package markers. */
export const GIT_WORKSPACE_MARKER = ".git" as const;

/**
 * Package/project markers. On their own they resolve to the NEAREST marked directory, but inside a
 * request cwd they are only a fallback: a `.git` ancestor further up collapses nested package roots
 * (one client per repository instead of one per monorepo package).
 */
export const PROJECT_WORKSPACE_MARKERS = [
	"package.json",
	"pyproject.toml",
	"Cargo.toml",
	"go.mod",
	"pom.xml",
	"build.gradle",
] as const;

export const WORKSPACE_MARKERS = [GIT_WORKSPACE_MARKER, ...PROJECT_WORKSPACE_MARKERS] as const;
