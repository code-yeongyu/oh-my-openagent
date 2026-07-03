import { realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

export interface ContainmentResult {
	canonicalPath: string;
	canonicalRoot: string;
}

export interface ResolveAndContainInput {
	filePath: string;
	rootDir: string;
}

export async function resolveAndContain(input: ResolveAndContainInput): Promise<ContainmentResult | null> {
	if (!input.filePath) return null;

	const resolvedPath = isAbsolute(input.filePath) ? input.filePath : resolve(input.rootDir, input.filePath);

	let canonicalRoot: string;
	let canonicalPath: string;
	try {
		canonicalRoot = await realpath(input.rootDir);
		canonicalPath = await realpath(resolvedPath);
	} catch {
		return null;
	}

	if (canonicalPath === canonicalRoot) return null;

	const rootBoundary = canonicalRoot.endsWith(sep) ? canonicalRoot : canonicalRoot + sep;
	if (!canonicalPath.startsWith(rootBoundary)) return null;

	return { canonicalPath, canonicalRoot };
}
