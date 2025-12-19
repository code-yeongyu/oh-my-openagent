import type { ConflictDetectorConfig } from "./types";

export const CONFLICT_DETECTOR_NAME = "conflict-detector";

export const DEFAULT_CONFLICT_DETECTOR_CONFIG: ConflictDetectorConfig = {
  enabled: true,
  lockTimeoutMs: 60000,
  warnOnConflict: true,
  blockOnConflict: false,
};

export const WARNING_MESSAGES = {
  conflict: (filePath: string, existingAgent: string, newAgent: string) =>
    `⚠️ CONFLICT: File "${filePath}" is being edited by "${existingAgent}". Agent "${newAgent}" is also attempting to edit it.`,
  stale: (filePath: string, agentName: string) =>
    `Lock on "${filePath}" by "${agentName}" has expired and was released.`,
};
