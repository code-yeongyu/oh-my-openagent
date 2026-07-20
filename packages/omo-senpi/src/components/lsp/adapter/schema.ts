export type Schema =
	| { readonly type: "object"; readonly properties: Record<string, Schema>; readonly required?: readonly string[] }
	| { readonly type: "string"; readonly description?: string }
	| { readonly type: "number"; readonly description?: string }
	| { readonly type: "boolean"; readonly description?: string }
	| { readonly const: string; readonly type: "string" }
	| { readonly anyOf: readonly Schema[]; readonly description?: string };

type SchemaOptions = { readonly description?: string };

export const Type = {
	Object(properties: Record<string, Schema>): Schema {
		const required = Object.entries(properties)
			.filter(([, schema]) => !("optional" in schema))
			.map(([key]) => key);
		return { type: "object", properties, required };
	},
	String(options: SchemaOptions = {}): Schema {
		return { type: "string", ...options };
	},
	Number(options: SchemaOptions = {}): Schema {
		return { type: "number", ...options };
	},
	Boolean(options: SchemaOptions = {}): Schema {
		return { type: "boolean", ...options };
	},
	Optional(schema: Schema): Schema & { readonly optional: true } {
		return { ...schema, optional: true };
	},
	Literal(value: string): Schema {
		return { type: "string", const: value };
	},
	Union(values: readonly Schema[], options: SchemaOptions = {}): Schema {
		return { anyOf: values, ...options };
	},
};

export function defineTool<TTool extends Record<string, unknown>>(tool: TTool): TTool {
	return tool;
}
