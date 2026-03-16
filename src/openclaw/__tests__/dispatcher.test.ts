import { describe, it, expect } from "bun:test";
import {
  interpolateInstruction,
  resolveCommandTimeoutMs,
  shellEscapeArg,
  validateGatewayUrl,
  wakeCommandGateway,
} from "../dispatcher";
import { type OpenClawCommandGatewayConfig } from "../types";

describe("OpenClaw Dispatcher", () => {
  describe("validateGatewayUrl", () => {
    it("accepts valid https URLs", () => {
      expect(validateGatewayUrl("https://example.com")).toBe(true);
    });

    it("rejects http URLs (remote)", () => {
      expect(validateGatewayUrl("http://example.com")).toBe(false);
    });

    it("accepts http URLs for localhost", () => {
      expect(validateGatewayUrl("http://localhost:3000")).toBe(true);
      expect(validateGatewayUrl("http://127.0.0.1:8080")).toBe(true);
    });
  });

  describe("interpolateInstruction", () => {
    it("interpolates variables correctly", () => {
      const result = interpolateInstruction("Hello {{name}}!", { name: "World" });
      expect(result).toBe("Hello World!");
    });

    it("handles missing variables", () => {
      const result = interpolateInstruction("Hello {{name}}!", {});
      expect(result).toBe("Hello !");
    });
  });

  describe("shellEscapeArg", () => {
    it("escapes simple string", () => {
      expect(shellEscapeArg("foo")).toBe("'foo'");
    });

    it("escapes string with single quotes", () => {
      expect(shellEscapeArg("it's")).toBe("'it'\\''s'");
    });
  });

  describe("resolveCommandTimeoutMs", () => {
    it("uses default timeout", () => {
      expect(resolveCommandTimeoutMs(undefined, undefined)).toBe(5000);
    });

    it("uses provided timeout", () => {
      expect(resolveCommandTimeoutMs(1000, undefined)).toBe(1000);
    });

    it("clamps timeout", () => {
      expect(resolveCommandTimeoutMs(10, undefined)).toBe(100);
      expect(resolveCommandTimeoutMs(1000000, undefined)).toBe(300000);
    });
  });

  describe("wakeCommandGateway", () => {
    it("rejects if disabled via env", async () => {
      const oldEnv = process.env.OMX_OPENCLAW_COMMAND;
      process.env.OMX_OPENCLAW_COMMAND = "0";
      const config: OpenClawCommandGatewayConfig = {
        type: "command",
        command: "echo hi",
      };
      const result = await wakeCommandGateway("test", config, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("disabled");
      process.env.OMX_OPENCLAW_COMMAND = oldEnv;
    });
  });
});
