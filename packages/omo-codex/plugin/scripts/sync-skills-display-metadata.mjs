import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const skillDisplayPrefix = "(OmO) ";

function readSkillFrontmatterName(content, fallbackName) {
	const frontmatter = content.match(/^---\n(?<body>[\s\S]*?)\n---\n+/);
	const rawName = frontmatter?.groups?.body
		.match(/^name:\s*"?([^"\n]+)"?\s*$/m)?.[1]
		?.trim();
	return rawName && rawName.length > 0 ? rawName : fallbackName;
}

function upsertDisplayName(metadata, displayName) {
	const content = metadata.endsWith("\n") ? metadata : `${metadata}\n`;
	if (/^\s*display_name:/m.test(metadata)) {
		return content.replace(/^(\s*display_name:\s*).+$/m, `$1"${displayName}"`);
	}
	if (/^interface:\s*$/m.test(metadata)) {
		return content.replace(
			/^interface:\s*$/m,
			`interface:\n  display_name: "${displayName}"`,
		);
	}
	return `interface:\n  display_name: "${displayName}"\n${content}`;
}

export async function writeCodexSkillDisplayMetadata(skillsRoot, skillName) {
	const skillRoot = join(skillsRoot, skillName);
	const content = await readFile(join(skillRoot, "SKILL.md"), "utf8");
	const frontmatterName = readSkillFrontmatterName(content, skillName);
	const metadataDir = join(skillRoot, "agents");
	const metadataPath = join(metadataDir, "openai.yaml");
	await mkdir(metadataDir, { recursive: true });
	let metadata = "interface:\n";
	try {
		metadata = await readFile(metadataPath, "utf8");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
	}
	await writeFile(
		metadataPath,
		upsertDisplayName(metadata, `${skillDisplayPrefix}${frontmatterName}`),
		"utf8",
	);
}
