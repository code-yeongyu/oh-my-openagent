import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
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
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, "utf-8");
    const serialized = JSON.parse(content) as SerializedInteractiveBashSessionState;
    return {
      sessionID: serialized.sessionID,
      tmuxSessions: new Set(serialized.tmuxSessions),
      updatedAt: serialized.updatedAt,
    };
  } catch {
    return null;
  }
}

export function saveInteractiveBashSessionState(
  state: InteractiveBashSessionState,
): void {
  if (!existsSync(INTERACTIVE_BASH_SESSION_STORAGE)) {
    mkdirSync(INTERACTIVE_BASH_SESSION_STORAGE, { recursive: true });
  }

  const filePath = getStoragePath(state.sessionID);
  const serialized: SerializedInteractiveBashSessionState = {
    sessionID: state.sessionID,
    tmuxSessions: Array.from(state.tmuxSessions),
    updatedAt: state.updatedAt,
  };
  writeFileSync(filePath, JSON.stringify(serialized, null, 2));
}

export function clearInteractiveBashSessionState(sessionID: string): void {
  const filePath = getStoragePath(sessionID);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
