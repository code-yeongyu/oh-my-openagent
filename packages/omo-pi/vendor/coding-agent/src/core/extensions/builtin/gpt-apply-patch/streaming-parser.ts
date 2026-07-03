import { normalizePatchText, stripHeredoc } from "./text.ts";
import type { ParsedPatch, PatchChunk } from "./types.ts";

const BEGIN = "*** Begin Patch";
const END = "*** End Patch";
const ADD = "*** Add File: ";
const DELETE = "*** Delete File: ";
const UPDATE = "*** Update File: ";
const MOVE = "*** Move to: ";
const EOF = "*** End of File";

type Mode = "not-started" | "started" | "add" | "delete" | "update" | "ended";

export class StreamingPatchParser {
	private lineBuffer = "";
	private mode: Mode = "not-started";
	private hunks: ParsedPatch[] = [];

	pushDelta(delta: string): ParsedPatch[] {
		for (const character of normalizePatchText(delta)) {
			if (character === "\n") {
				const line = this.lineBuffer;
				this.lineBuffer = "";
				this.processLine(line);
			} else {
				this.lineBuffer += character;
			}
		}
		return this.snapshot();
	}

	finish(): ParsedPatch[] {
		if (this.lineBuffer.length > 0) {
			const line = this.lineBuffer;
			this.lineBuffer = "";
			if (line.trim() === END) {
				this.ensureUpdateHunkIsNotEmpty(line.trim());
				this.mode = "ended";
			} else {
				this.processLine(line);
			}
		}
		if (this.mode !== "ended") throw new Error("The last line of the patch must be '*** End Patch'");
		return this.snapshot();
	}

	private snapshot(): ParsedPatch[] {
		return structuredClone(this.hunks);
	}

	private ensureUpdateHunkIsNotEmpty(line: string): void {
		const hunk = this.hunks[this.hunks.length - 1];
		if (hunk?.type !== "update") return;
		if (hunk.chunks.length === 0 && this.mode === "update") {
			throw new Error(`Update file hunk for path '${hunk.filePath}' is empty`);
		}
		const chunk = hunk.chunks[hunk.chunks.length - 1];
		if (chunk && chunk.oldLines.length === 0 && chunk.newLines.length === 0 && chunk.changeContexts.length === 0) {
			if (line === END) throw new Error("Update hunk does not contain any lines");
			throw new Error(`Unexpected line found in update hunk: '${line}'`);
		}
	}

	private handleHeader(line: string): boolean {
		if (line === END) {
			this.ensureUpdateHunkIsNotEmpty(line);
			this.mode = "ended";
			return true;
		}
		if (line.startsWith(ADD)) return this.startAdd(line.slice(ADD.length));
		if (line.startsWith(DELETE)) return this.startDelete(line.slice(DELETE.length));
		if (line.startsWith(UPDATE)) return this.startUpdate(line.slice(UPDATE.length));
		return false;
	}

	private startAdd(filePath: string): true {
		this.ensureUpdateHunkIsNotEmpty(`${ADD}${filePath}`);
		this.hunks.push({ type: "add", filePath, content: "" });
		this.mode = "add";
		return true;
	}

	private startDelete(filePath: string): true {
		this.ensureUpdateHunkIsNotEmpty(`${DELETE}${filePath}`);
		this.hunks.push({ type: "delete", filePath });
		this.mode = "delete";
		return true;
	}

	private startUpdate(filePath: string): true {
		this.ensureUpdateHunkIsNotEmpty(`${UPDATE}${filePath}`);
		this.hunks.push({ type: "update", filePath, chunks: [] });
		this.mode = "update";
		return true;
	}

	private currentUpdate(): Extract<ParsedPatch, { type: "update" }> {
		const hunk = this.hunks[this.hunks.length - 1];
		if (hunk?.type !== "update") throw new Error("Internal parser state error: expected update hunk");
		return hunk;
	}

	private currentChunk(): PatchChunk {
		const hunk = this.currentUpdate();
		let chunk = hunk.chunks[hunk.chunks.length - 1];
		if (!chunk || chunk.isEndOfFile) {
			chunk = { changeContexts: [], oldLines: [], newLines: [], isEndOfFile: false };
			hunk.chunks.push(chunk);
		}
		return chunk;
	}

	private processLine(line: string): void {
		if (this.mode === "not-started") {
			if (stripHeredoc(line).trim() === BEGIN) {
				this.mode = "started";
				return;
			}
			throw new Error("The first line of the patch must be '*** Begin Patch'");
		}
		if (this.mode === "started") {
			this.processStarted(line.trim());
			return;
		}
		if (this.mode === "add") {
			this.processAdd(line);
			return;
		}
		if (this.mode === "delete") {
			this.processDelete(line.trim());
			return;
		}
		if (this.mode === "update") {
			this.processUpdate(line);
		}
	}

	private processStarted(trimmed: string): void {
		if (this.handleHeader(trimmed)) return;
		throw new Error(`'${trimmed}' is not a valid hunk header`);
	}

	private processAdd(line: string): void {
		if (this.handleHeader(line.trim())) return;
		const hunk = this.hunks[this.hunks.length - 1];
		if (line.startsWith("+") && hunk?.type === "add") {
			hunk.content += `${line.slice(1)}\n`;
			return;
		}
		throw new Error(`'${line.trim()}' is not a valid hunk header`);
	}

	private processDelete(trimmed: string): void {
		if (this.handleHeader(trimmed)) return;
		throw new Error(`'${trimmed}' is not a valid hunk header`);
	}

	private processUpdate(line: string): void {
		const updateLine = line.trimEnd();
		if (this.handleHeader(updateLine)) return;
		const hunk = this.currentUpdate();
		if (hunk.chunks.length === 0 && !hunk.movePath && updateLine.startsWith(MOVE)) {
			hunk.movePath = updateLine.slice(MOVE.length);
			return;
		}
		if (updateLine === "@@") return;
		if (updateLine.startsWith("@@ ")) {
			this.currentChunk().changeContexts.push(updateLine.slice("@@ ".length));
			return;
		}
		if (updateLine === EOF) {
			const chunk = this.currentChunk();
			if (chunk.oldLines.length === 0 && chunk.newLines.length === 0)
				throw new Error("Update hunk does not contain any lines");
			chunk.isEndOfFile = true;
			return;
		}
		this.pushUpdateLine(line);
	}

	private pushUpdateLine(line: string): void {
		const prefix = line[0];
		const value = line.slice(1);
		const chunk = this.currentChunk();
		if (prefix === " ") {
			chunk.oldLines.push(value);
			chunk.newLines.push(value);
		} else if (prefix === "-") {
			chunk.oldLines.push(value);
		} else if (prefix === "+") {
			chunk.newLines.push(value);
		} else if (prefix === undefined) {
			chunk.oldLines.push("");
			chunk.newLines.push("");
		} else {
			throw new Error(`Unexpected line found in update hunk: '${line}'`);
		}
	}
}
