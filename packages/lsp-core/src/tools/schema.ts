import type { JsonSchema } from "./types.js";

export function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
	return {
		type: "object",
		properties,
		required,
	};
}
