import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildFacadeManifest, renderFacadeManifest } from "../scripts/facade-manifest";

const packageDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const facadeSource = readFileSync(path.join(packageDir, "src/facade.ts"), "utf8");

// facade-manifest.json is a generated artifact the kernel preludes and the guide are built from (rows 26, 37).
describe("facade manifest", () => {
	it("#given src/facade.ts #when regenerating #then the committed facade-manifest.json is byte-identical", () => {
		expect(readFileSync(path.join(packageDir, "facade-manifest.json"), "utf8")).toBe(renderFacadeManifest(facadeSource));
	});

	it("#given the manifest #when reading the verify entry #then tier read, policy none, READ wire methods only", () => {
		const entry = buildFacadeManifest(facadeSource).methods.find((method) => method.method === "Computer.verify");

		expect(entry).toMatchObject({
			params: [
				{ name: "expectation", type: "Expectation", optional: false },
				{ name: "options", type: "VerifyOptions", optional: true },
			],
			returns: "Promise<Verdict>",
			tier: "read",
			policy: "none",
			wire: ["ax.node", "ax.attributes", "windows"],
		});
	});

	it("#given a method without tags or with an unknown wire method #when generating #then generation fails naming it", () => {
		const untagged = "export interface X {\n\t/** Does a thing. */\n\tgo(): Promise<void>;\n}\n";
		const unknownWire = "export interface X {\n\t/**\n\t * @tier read\n\t * @policy none\n\t * @wire nope\n\t */\n\tgo(): Promise<void>;\n}\n";

		expect(() => buildFacadeManifest(untagged)).toThrow("X.go: @tier must be read or exec");
		expect(() => buildFacadeManifest(unknownWire)).toThrow("X.go: @wire names unknown engine method nope");
	});
});
