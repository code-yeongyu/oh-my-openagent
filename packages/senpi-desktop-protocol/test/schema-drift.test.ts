import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENGINE_ABI, ENGINE_METHODS, ENGINE_NOTIFICATIONS, ERROR_CODES, PROTOCOL_VERSION } from "../src/index";

const schemaPath = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../crates/senpi-desktop-core/schema/engine.schema.json",
);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOf(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`${label} is not an object`);
	}
	return value;
}

function loadEngineSchema(): Record<string, unknown> {
	const raw: unknown = JSON.parse(readFileSync(schemaPath, "utf8"));
	return recordOf(raw, "engine.schema.json");
}

function stringKeys(record: Record<string, unknown>): string[] {
	return Object.keys(record).sort();
}

function errorCodesFromDefinition(definition: unknown): string[] {
	const def = recordOf(definition, "definitions.ErrorCode");
	if (!Array.isArray(def.oneOf)) {
		throw new Error("definitions.ErrorCode is not a oneOf union");
	}
	const codes: string[] = [];
	for (const branch of def.oneOf) {
		if (!isRecord(branch)) {
			continue;
		}
		if (typeof branch.const === "string") {
			codes.push(branch.const);
			continue;
		}
		if (!Array.isArray(branch.enum)) {
			continue;
		}
		for (const item of branch.enum) {
			if (typeof item === "string") {
				codes.push(item);
			}
		}
	}
	return codes.sort();
}

describe("engine schema drift", () => {
	it("keeps PROTOCOL_VERSION equal to the committed schema", () => {
		const schema = loadEngineSchema();
		expect(PROTOCOL_VERSION).toBe(schema.protocolVersion);
	});

	it("keeps ENGINE_ABI equal to the committed schema", () => {
		const schema = loadEngineSchema();
		expect(ENGINE_ABI).toBe(schema.abi);
	});

	it("keeps ERROR_CODES equal to schema.errors and definitions.ErrorCode", () => {
		const schema = loadEngineSchema();
		const errors = recordOf(schema.errors, "errors");
		const definitions = recordOf(schema.definitions, "definitions");
		const fromErrors = stringKeys(errors);
		const fromDefinition = errorCodesFromDefinition(definitions.ErrorCode);
		const exported = [...ERROR_CODES].sort();
		expect(exported).toEqual(fromErrors);
		expect(exported).toEqual(fromDefinition);
	});

	it("keeps ENGINE_METHODS equal to the schema method list", () => {
		const schema = loadEngineSchema();
		const methods = recordOf(schema.methods, "methods");
		const definitions = recordOf(schema.definitions, "definitions");
		const methodDef = recordOf(definitions.Method, "definitions.Method");
		if (!Array.isArray(methodDef.enum)) {
			throw new Error("definitions.Method.enum is missing");
		}
		const fromEnum = methodDef.enum.filter((item) => typeof item === "string").sort();
		const exported = [...ENGINE_METHODS].sort();
		expect(exported).toEqual(stringKeys(methods));
		expect(exported).toEqual(fromEnum);
	});

	it("keeps ENGINE_NOTIFICATIONS equal to the schema notification list", () => {
		const schema = loadEngineSchema();
		const notifications = recordOf(schema.notifications, "notifications");
		expect([...ENGINE_NOTIFICATIONS].sort()).toEqual(stringKeys(notifications));
	});
});
