import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "../../shared/json-cache";
import { INTERACTIVE_BASH_SESSION_STORAGE } from "./constants";
import type {
  InteractiveBashSessionState,
  SerializedInteractiveBashSessionState,
} from "./types";

function getStoragePath(sessionID: string): string {
  return join(INTERACTIVE_BASH_SESSION_STORAGE, `${sessionID}.json`);
}

export function loadInteractiveBashSessionState(
  sessionID: string,
): InteractiveBashSessionState | null {
  const filePath = getStoragePath(sessionID);
  const serialized = readJsonFile<SerializedInteractiveBashSessionState>(filePath);
  
  if (!serialized) {
    return null;
  }

  return {
    sessionID: serialized.sessionID,
    tmuxSessions: new Set(serialized.tmuxSessions),
    updatedAt: serialized.updatedAt,
  };
}

export function saveInteractiveBashSessionState(
  state: InteractiveBashSessionState,
): void {
  const filePath = getStoragePath(state.sessionID);
  const serialized: SerializedInteractiveBashSessionState = {
    sessionID: state.sessionID,
    tmuxSessions: Array.from(state.tmuxSessions),
    updatedAt: state.updatedAt,
  };
  writeJsonFile(filePath, serialized, { ensureDir: true });
}

export function clearInteractiveBashSessionState(sessionID: string): void {
  const filePath = getStoragePath(sessionID);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
