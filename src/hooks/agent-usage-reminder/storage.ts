import { AGENT_USAGE_REMINDER_STORAGE } from "./constants";
import { createSessionStorage } from "../../shared/session-storage";
import type { AgentUsageState } from "./types";

const storage = createSessionStorage<AgentUsageState>({
  storageDir: AGENT_USAGE_REMINDER_STORAGE,
});

export const loadAgentUsageState = storage.load;
export const saveAgentUsageState = (state: AgentUsageState): void =>
  storage.save(state.sessionID, state);
export const clearAgentUsageState = storage.clear;
