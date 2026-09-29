// Reading values that arrived as JSON.
//
// Protocol payloads, HTTP bodies and page messages all reach us as `unknown`. These two guards are
// the only sanctioned way to look inside one, so no module has to reach for a type assertion.

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

export const recordOf = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})
