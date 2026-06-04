import { isAbsolute, relative, resolve } from "node:path";

export function displayPath(cwd: string, filePath: string): string {
	const rel = isAbsolute(filePath) ? relative(cwd, filePath) : filePath;
	return toPosixPath(rel);
}

export function isSameOrChildPath(childPath: string, parentPath: string): boolean {
	const childRelativePath = relative(parentPath, resolve(childPath));
	return childRelativePath === "" || (!childRelativePath.startsWith("..") && !isAbsolute(childRelativePath));
}

export function toPosixPath(path: string): string {
	return path.replaceAll("\\", "/");
}

export function uniqueStrings(values: ReadonlyArray<string>): string[] {
	const uniqueValues: string[] = [];
	const seenValues = new Set<string>();
	for (const value of values) {
		if (seenValues.has(value)) {
			continue;
		}

		seenValues.add(value);
		uniqueValues.push(value);
	}
	return uniqueValues;
}
