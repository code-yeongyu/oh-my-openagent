// Shared transform for vendoring code-yeongyu/pi-* extension packages into senpi builtins.
// Rewrites the standalone packages' published-API imports to senpi's in-tree equivalents:
//   - relative imports: drop the `.js` suffix the packages publish with, use senpi's `.ts`
//   - @mariozechner/pi-ai|pi-tui  -> @earendil-works/pi-ai|pi-tui (senpi's workspace names)
//   - {@mariozechner,@earendil-works}/pi-coding-agent -> depth-relative core/extensions/types.ts,
//     except `Theme`, which lives in modes/interactive/theme/theme.ts
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

function toImportSpecifier(fromDir, targetAbs) {
	let spec = relative(fromDir, targetAbs).split("\\").join("/");
	if (!spec.startsWith(".")) spec = `./${spec}`;
	return spec;
}

function splitNamedImports(body) {
	return body
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

// builtinRoot = .../core/extensions/builtin ; targetFileAbs = absolute path of the vendored file.
export function transformVendoredSource(content, targetFileAbs, builtinRoot) {
	const fromDir = dirname(targetFileAbs);
	const typesAbs = resolve(builtinRoot, "..", "types.ts");
	const themeAbs = resolve(builtinRoot, "..", "..", "..", "modes", "interactive", "theme", "theme.ts");
	const typesSpec = toImportSpecifier(fromDir, typesAbs);
	const themeSpec = toImportSpecifier(fromDir, themeAbs);

	let out = content;

	// Relative imports: published `.js` -> senpi `.ts`.
	out = out.replace(/(from\s+["'])(\.[^"']*?)\.js(["'])/g, "$1$2.ts$3");
	out = out.replace(/(import\s+["'])(\.[^"']*?)\.js(["'])/g, "$1$2.ts$3");

	// pi-ai / pi-tui workspace rename.
	out = out.replace(/(["'])@mariozechner\/pi-ai(["'])/g, "$1@earendil-works/pi-ai$2");
	out = out.replace(/(["'])@mariozechner\/pi-tui(["'])/g, "$1@earendil-works/pi-tui$2");

	// pi-coding-agent: split Theme (theme module) from the rest (extensions/types.ts).
	const codingAgentImport = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["'](?:@mariozechner|@earendil-works)\/pi-coding-agent["'];?/g;
	out = out.replace(codingAgentImport, (_match, typeKeyword, body) => {
		const isType = typeKeyword ? "type " : "";
		const names = splitNamedImports(body);
		const themeNames = names.filter((name) => name === "Theme" || name.startsWith("Theme ") || name.endsWith(" Theme"));
		const restNames = names.filter((name) => !themeNames.includes(name));
		const lines = [];
		if (restNames.length > 0) lines.push(`import ${isType}{ ${restNames.join(", ")} } from "${typesSpec}";`);
		if (themeNames.length > 0) lines.push(`import ${isType}{ ${themeNames.join(", ")} } from "${themeSpec}";`);
		return lines.join("\n");
	});

	return out;
}

export function listSourceFiles(dir) {
	const results = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			results.push(...listSourceFiles(full));
		} else if (full.endsWith(".ts")) {
			results.push(full);
		}
	}
	return results;
}
