export declare function findPlanByName(plans: readonly string[], requestedName: string): string | null;
export declare function pickPreferredIncompletePlan(incompletePlans: readonly string[], preferredPlanPath: string | null): string | null;
export declare function formatIncompletePlanList(plans: readonly string[], includeModifiedTime: boolean): string;
export declare function buildMissingPlanContext(explicitPlanName: string, allPlans: readonly string[]): string;
