import { readFile } from "node:fs/promises";
import type { SessionMessageEntry } from "../../../session-manager.ts";
import { parseSessionEntries } from "../../../session-manager.ts";
import type { TranscriptSnapshot } from "./types.ts";

export async function loadTranscriptSnapshot(filePath: string): Promise<TranscriptSnapshot> {
	const content = await readFile(filePath, "utf-8");
	const entries = parseSessionEntries(content);
	const messages: SessionMessageEntry[] = [];
	let model: string | undefined;
	for (const entry of entries) {
		if (entry.type === "message") {
			messages.push(entry);
			if (!model && entry.message.role === "assistant") model = entry.message.responseModel ?? entry.message.model;
		} else if (entry.type === "model_change") {
			model = `${entry.provider}/${entry.modelId}`;
		}
	}
	return { entries: messages, model };
}
