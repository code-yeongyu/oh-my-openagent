import * as Diff from "diff";

export function createPatchDiff(
	oldContent: string,
	newContent: string,
): { diff: string; added: number; removed: number } {
	const parts = Diff.diffLines(oldContent, newContent);
	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const lineNumWidth = String(Math.max(oldLines.length, newLines.length)).length;
	const output: string[] = [];
	let oldLineNum = 1;
	let newLineNum = 1;
	let added = 0;
	let removed = 0;

	for (const part of parts) {
		const rawLines = part.value.split("\n");
		if (rawLines[rawLines.length - 1] === "") rawLines.pop();
		for (const line of rawLines) {
			if (part.added) {
				output.push(`+${String(newLineNum).padStart(lineNumWidth, " ")} ${line}`);
				newLineNum++;
				added++;
				continue;
			}
			if (part.removed) {
				output.push(`-${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
				oldLineNum++;
				removed++;
				continue;
			}
			output.push(` ${String(oldLineNum).padStart(lineNumWidth, " ")} ${line}`);
			oldLineNum++;
			newLineNum++;
		}
	}

	return { diff: output.join("\n"), added, removed };
}
