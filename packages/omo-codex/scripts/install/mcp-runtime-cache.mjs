import { existsSync } from "node:fs";
import { cp } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export function createCachedMcpRuntimeArgRewriter({ copyDist = cp } = {}) {
	const copiedDistRoots = new Map();
	return async function rewriteCachedMcpRuntimeArg({ arg, pluginRoot, serverName, sourceRoot }) {
		return rewriteCachedMcpRuntimeArgWithCache({ arg, pluginRoot, serverName, sourceRoot }, { copiedDistRoots, copyDist });
	};
}

export async function rewriteCachedMcpRuntimeArg(args) {
	return createCachedMcpRuntimeArgRewriter()(args);
}

async function rewriteCachedMcpRuntimeArgWithCache({ arg, pluginRoot, serverName, sourceRoot }, { copiedDistRoots, copyDist }) {
	if (typeof arg !== "string" || (!arg.startsWith("./") && !arg.startsWith("../"))) return arg;
	const fallback = resolveCachedRuntimePath(pluginRoot, sourceRoot, arg);
	const targetPath = resolve(pluginRoot, arg);
	const runtimePath = isPathInside(targetPath, pluginRoot) ? targetPath : resolve(sourceRoot, arg);
	const packageRoot = resolveExternalMcpPackageRoot(runtimePath, sourceRoot);
	if (packageRoot === undefined) return fallback;
	const distRoot = join(packageRoot, "dist");
	const distPath = relative(distRoot, runtimePath);
	if (distPath.startsWith("..") || isAbsolute(distPath)) return fallback;
	const cachedRoot = join(pluginRoot, "mcp", safePathSegment(serverName));
	const cacheKey = `${distRoot}\0${cachedRoot}`;
	let copyPromise = copiedDistRoots.get(cacheKey);
	if (copyPromise === undefined) {
		copyPromise = copyDist(distRoot, join(cachedRoot, "dist"), { recursive: true });
		copiedDistRoots.set(cacheKey, copyPromise);
	}
	await copyPromise;
	return join(cachedRoot, "dist", distPath);
}

function resolveExternalMcpPackageRoot(runtimePath, sourceRoot) {
	const packagesRoot = findPackagesRoot(sourceRoot);
	if (packagesRoot === undefined) return undefined;
	if (!isPathInside(runtimePath, packagesRoot)) return undefined;
	let packageRoot = dirname(runtimePath);
	while (packageRoot !== packagesRoot) {
		if (existsSync(join(packageRoot, "package.json")) && isPathInside(runtimePath, join(packageRoot, "dist"))) {
			return packageRoot;
		}
		const parent = dirname(packageRoot);
		if (parent === packageRoot) return undefined;
		packageRoot = parent;
	}
	return undefined;
}

function findPackagesRoot(path) {
	let current = resolve(path);
	for (let index = 0; index < 8; index++) {
		if (basename(current) === "packages") return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
	return undefined;
}

function resolveCachedRuntimePath(pluginRoot, sourceRoot, runtimePath) {
	const targetPath = resolve(pluginRoot, runtimePath);
	if (isPathInside(targetPath, pluginRoot)) return targetPath;
	return resolve(sourceRoot, runtimePath);
}

function isPathInside(candidatePath, rootPath) {
	const pathFromRoot = relative(rootPath, candidatePath);
	return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

function safePathSegment(value) {
	return value.replace(/[^A-Za-z0-9._-]/g, "_");
}
