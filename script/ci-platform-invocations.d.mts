export type InvocationCoverage = { readonly kind: "exact" | "prefix"; readonly value: string }

export function platformOnlyStepTexts(workflowText: string): string[]
export function platformInvocationCoverage(workflowText: string): InvocationCoverage[]
export function coveredByInvocation(path: string, coverage: readonly InvocationCoverage[]): boolean
export function readCiInvocationCoverage(): InvocationCoverage[]
