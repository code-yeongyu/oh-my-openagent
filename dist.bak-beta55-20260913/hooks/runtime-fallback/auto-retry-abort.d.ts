import type { HookDeps } from "./types";
export declare function createAbortSessionRequest(deps: HookDeps): (sessionID: string, source: string) => Promise<void>;
