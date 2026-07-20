import { Type } from "typebox";
import { describe, expect, it } from "bun:test";

import { webfetch } from "../src/webfetch/tool.js";

describe("webfetch tool definition", () => {
	it("#given webfetch tool #when inspecting metadata #then exposes expected name and schema", () => {
		// given
		const objectSchema = Type.Object({});

		// when / then
		expect(webfetch.name).toBe("webfetch");
		expect(webfetch.label).toBe("Web Fetch");
		expect(webfetch.description).toContain("Fetches content from a URL");
		expect(webfetch.parameters.type).toBe(objectSchema.type);
		expect(webfetch.parameters.required).toEqual(["url"]);
		expect(webfetch.parameters.properties).toHaveProperty("url");
		expect(webfetch.parameters.properties).toHaveProperty("format");
		expect(webfetch.parameters.properties).toHaveProperty("timeout");
	});
});
