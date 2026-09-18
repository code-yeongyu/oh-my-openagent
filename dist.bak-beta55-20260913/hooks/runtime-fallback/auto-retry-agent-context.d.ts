import type { HookDeps } from "./types";
export declare function createAgentContextResolver(deps: HookDeps): (sessionID: string, eventAgent?: string) => Promise<string | undefined>;
