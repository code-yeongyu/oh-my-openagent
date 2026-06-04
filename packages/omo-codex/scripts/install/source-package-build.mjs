import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PACKAGED_INSTALLER_PACKAGE_NAMES = new Set([
	"@code-yeongyu/lazycodex",
	"@code-yeongyu/lazycodex-ai",
	"lazycodex",
	"lazycodex-ai",
	"oh-my-opencode",
	"oh-my-openagent",
]);

export async function shouldBuildSourcePackages(repoRoot) {
	if (existsSync(join(repoRoot, "src", "index.ts"))) return true;
	const packageJsonPath = join(repoRoot, "package.json");
	if (!existsSync(packageJsonPath)) return true;
	const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
	return !PACKAGED_INSTALLER_PACKAGE_NAMES.has(packageJson?.name);
}
