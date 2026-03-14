export interface ContinuationState {
    hasActiveBoulder: boolean;
    hasActiveRalphLoop: boolean;
    hasHookMarker: boolean;
    hasTodoHookMarker: boolean;
    hasActiveHookMarker: boolean;
    activeHookMarkerReason: string | null;
}
export declare function getContinuationState(directory: string, sessionID: string): ContinuationState;
