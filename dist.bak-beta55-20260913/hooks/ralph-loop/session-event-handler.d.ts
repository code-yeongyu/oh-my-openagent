import type { RalphLoopState } from "./types";
type LoopStateController = {
    getState: () => RalphLoopState | null;
    clear: () => boolean;
};
export declare function handleDeletedLoopSession(props: Record<string, unknown> | undefined, loopState: LoopStateController): boolean;
export declare function handleErroredLoopSession(props: Record<string, unknown> | undefined, loopState: LoopStateController): boolean;
export {};
