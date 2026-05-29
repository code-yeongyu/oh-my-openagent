import { describe, expect, it } from "vitest";
import { resolveLazyLspIdleTimeoutMs } from "../src/lazy-lsp-mcp.js";
import { DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS } from "../src/lazy-mcp-proxy.js";

describe("lazy LSP MCP config", () => {
	it("#given idle timeout env input #when resolving lazy LSP config #then default and malformed values are safe", () => {
		// given
		const fallback = DEFAULT_LAZY_MCP_IDLE_TIMEOUT_MS;

		// when
		const missing = resolveLazyLspIdleTimeoutMs(undefined, fallback);
		const valid = resolveLazyLspIdleTimeoutMs("25", fallback);
		const malformed = resolveLazyLspIdleTimeoutMs("abc", fallback);

		// then
		expect(missing).toEqual({ value: fallback });
		expect(valid).toEqual({ value: 25 });
		expect(malformed.value).toBe(fallback);
		expect(malformed.warning).toContain("Ignoring malformed lazy MCP idle timeout");
	});
});
