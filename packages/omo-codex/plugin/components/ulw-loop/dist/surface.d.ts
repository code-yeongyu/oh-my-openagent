export type UlwLoopToolkitSurface = "lazycodex" | "omo-senpi";
export interface UlwLoopReviewerRoles {
    readonly codeReview: string;
    readonly manualQa: string;
    readonly gateReview: string;
}
export declare const REVIEWER_ROLES_BY_SURFACE: Readonly<Record<UlwLoopToolkitSurface, UlwLoopReviewerRoles>>;
export declare const GATE_REVIEWER_AGENT_NAMES: ReadonlySet<string>;
export type UlwLoopGateSection = "codeReview" | "manualQa" | "gateReview" | "iteration" | "criteriaCoverage";
export declare const REQUIRED_GATE_SECTIONS_BY_SURFACE: Readonly<Record<UlwLoopToolkitSurface, readonly UlwLoopGateSection[]>>;
export declare const GATE_SECTION_BY_ACCEPTOR: Readonly<Record<UlwLoopToolkitSurface, Readonly<Partial<Record<UlwLoopGateSection, readonly string[]>>>>>;
export declare function reviewerRolesFor(surface: UlwLoopToolkitSurface): UlwLoopReviewerRoles;
export declare const SURFACE_MARKER_FILENAME = "surface.json";
export interface ResolveToolkitSurfaceOptions {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly entryDir?: string;
}
export declare function resolveToolkitSurface(options?: ResolveToolkitSurfaceOptions): UlwLoopToolkitSurface;
