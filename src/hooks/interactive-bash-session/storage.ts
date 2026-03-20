import { INTERACTIVE_BASH_SESSION_STORAGE } from "./constants";
import { createSessionStorage } from "../../shared/session-storage";
import type {
  InteractiveBashSessionState,
  SerializedInteractiveBashSessionState,
} from "./types";

const storage = createSessionStorage<
  InteractiveBashSessionState,
  SerializedInteractiveBashSessionState
>({
  storageDir: INTERACTIVE_BASH_SESSION_STORAGE,
  onParseError: "rethrow-non-error",
  serialize: (state, _sessionID) => ({
    sessionID: state.sessionID,
    tmuxSessions: Array.from(state.tmuxSessions),
    updatedAt: state.updatedAt,
  }),
  deserialize: (data) => ({
    sessionID: data.sessionID,
    tmuxSessions: new Set(data.tmuxSessions),
    updatedAt: data.updatedAt,
  }),
});

export const loadInteractiveBashSessionState = storage.load;
export const saveInteractiveBashSessionState = (
  state: InteractiveBashSessionState,
): void => storage.save(state.sessionID, state);
export const clearInteractiveBashSessionState = storage.clear;
