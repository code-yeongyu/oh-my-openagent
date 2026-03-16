import { describe, it, expect } from "bun:test";
import { resolveGateway } from "../client";
import { type OpenClawConfig } from "../types";

describe("OpenClaw Client", () => {
  describe("resolveGateway", () => {
    const config: OpenClawConfig = {
      enabled: true,
      gateways: {
        foo: { type: "command", command: "echo foo" },
        bar: { type: "http", url: "https://example.com" },
      },
      hooks: {
        "session-start": {
          gateway: "foo",
          instruction: "start",
          enabled: true,
        },
        "session-end": { gateway: "bar", instruction: "end", enabled: true },
        stop: { gateway: "foo", instruction: "stop", enabled: false },
      },
    };

    it("resolves valid mapping", () => {
      const result = resolveGateway(config, "session-start");
      expect(result).not.toBeNull();
      expect(result?.gatewayName).toBe("foo");
      expect(result?.instruction).toBe("start");
    });

    it("returns null for disabled hook", () => {
      const result = resolveGateway(config, "stop");
      expect(result).toBeNull();
    });

    it("returns null for unmapped event", () => {
      const result = resolveGateway(config, "ask-user-question");
      expect(result).toBeNull();
    });
  });
});
