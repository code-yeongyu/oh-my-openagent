import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { MESSAGE_STORAGE_DIR } from "./storage-paths"

export function getMessageDir(sessionID: string): string {
	if (!existsSync(MESSAGE_STORAGE_DIR)) return ""

	const directPath = join(MESSAGE_STORAGE_DIR, sessionID)
	if (existsSync(directPath)) {
		return directPath
	}

	for (const directory of readdirSync(MESSAGE_STORAGE_DIR)) {
		const sessionPath = join(MESSAGE_STORAGE_DIR, directory, sessionID)
		if (existsSync(sessionPath)) {
			return sessionPath
		}
	}

	return ""
}

export function getMessageIds(sessionID: string): string[] {
	const messageDir = getMessageDir(sessionID)
	if (!messageDir || !existsSync(messageDir)) return []

	const messageIds: string[] = []
	for (const file of readdirSync(messageDir)) {
		if (!file.endsWith(".json")) continue
		const messageId = file.replace(".json", "")
		messageIds.push(messageId)
	}

	return messageIds
}
