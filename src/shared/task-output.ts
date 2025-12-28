import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { log } from "./logger";

export const INLINE_OUTPUT_MAX_CHARS = 15000;

export function getTaskOutputsDir(): string {
	const dir = join(tmpdir(), "opencode-task-outputs");
	if (!existsSync(dir)) {
		try {
			mkdirSync(dir, { recursive: true });
		} catch (error) {
			log(`[task-output] Failed to create output directory: ${error}`);
		}
	}
	return dir;
}

export function saveOutputToFile(
	toolName: string,
	id: string,
	content: string,
): string | null {
	try {
		const outputDir = getTaskOutputsDir();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const filename = `${toolName}_${id}_${timestamp}.md`;
		const filePath = join(outputDir, filename);
		writeFileSync(filePath, content, "utf-8");
		return filePath;
	} catch (error) {
		log(`[task-output] Failed to save output to file: ${error}`);
		return null;
	}
}

export function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength) + "...";
}
