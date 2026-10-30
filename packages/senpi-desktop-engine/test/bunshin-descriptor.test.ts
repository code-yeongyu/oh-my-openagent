import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { desktopDescriptor } from "../bunshin/descriptor.mjs";

// Copied from bunshin packages/machine-sdk/src/handlers-sidecar.ts:44-70 at commit 0a21e2c1 (the `superRefine`
// checks that apply to a json-rpc-stdio sidecar with a full_access grant are asserted separately below).
const SchemaObject = z.record(z.string(), z.unknown());
const CommandSchema = z
	.object({ args: z.array(z.string()).default([]), output: z.enum(["json", "png_base64"]) })
	.strict();
const DescriptorSchema = z
	.object({
		name: z.string().min(1),
		kind: z.literal("sidecar"),
		version: z.string().min(1),
		description: z.string().optional(),
		schema: SchemaObject.optional(),
		schemas: z.record(z.string().min(1), SchemaObject).optional(),
		ops: z.array(z.string().min(1)).min(1).optional(),
		effects: z.record(z.string().min(1), z.enum(["read", "mutate"])).default({}),
		sidecar: z
			.object({
				executable: z.string().min(1),
				args: z.array(z.string()).default([]),
				protocol: z.enum(["json-rpc-stdio", "cli"]),
				timeoutMs: z.number().int().positive(),
				commands: z.record(z.string().min(1), CommandSchema).default({}),
			})
			.strict(),
		sandbox: z
			.object({
				grant: z.enum(["full_access", "required", "workspace_write"]),
				kind: z.string().min(1).optional(),
				workspace: z.string().min(1).optional(),
			})
			.strict(),
	})
	.strict();

const descriptor = desktopDescriptor({
	executable: "/opt/senpi/senpi-desktop-engine",
	version: "0.0.0-test",
	bunshinHome: "/home/user/.bunshin",
	platform: "linux",
});

describe("bunshin desktop descriptor", () => {
	it("is a valid bunshin sidecar descriptor", () => {
		expect(DescriptorSchema.safeParse(descriptor).error).toBeUndefined();
	});

	it("gives every op an effect and a params schema", () => {
		const missing = descriptor.ops.filter(
			(op) => descriptor.effects[op] === undefined || descriptor.schemas[op] === undefined,
		);
		expect(missing).toEqual([]);
	});

	it("never exposes a host-only or test-only engine method, and stopping needs no mutate token", () => {
		const exposed = descriptor.ops.map((op) => op.replace(/^desktop\./, ""));
		const forbidden = [
			"session.open",
			"session.close",
			"stopPath.start",
			"stopPath.heartbeat",
			"stopPath.resume",
			"$/test.advanceClock",
		];
		expect({
			forbidden: exposed.filter((method) => forbidden.includes(method)),
			stop: descriptor.effects["desktop.stop"],
			status: descriptor.effects["desktop.stopPath.status"],
		}).toEqual({ forbidden: [], stop: "read", status: "read" });
	});

	it("classifies input as mutate and inspection as read", () => {
		expect([
			descriptor.effects["desktop.click"],
			descriptor.effects["desktop.typeText"],
			descriptor.effects["desktop.capture"],
		]).toEqual(["mutate", "mutate", "read"]);
	});

	it("matches the shipped template apart from the host-specific fields", () => {
		const shipped = JSON.parse(readFileSync(new URL("../bunshin/desktop.capability.json", import.meta.url), "utf8"));
		const template = desktopDescriptor({
			executable: "<abs path to senpi-desktop-engine>",
			version: "<workspace>",
			bunshinHome: "<$BUNSHIN_HOME>",
			platform: "linux",
		});
		expect(shipped).toEqual(template);
	});
});
