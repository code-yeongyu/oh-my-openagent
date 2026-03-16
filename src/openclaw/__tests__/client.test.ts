import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolveGateway, wakeOpenClaw } from "../client";
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

  describe("wakeOpenClaw env gate", () => {
    let oldEnv: string | undefined;

    beforeEach(() => {
      oldEnv = process.env.OMO_OPENCLAW;
    });

    afterEach(() => {
      if (oldEnv === undefined) {
        delete process.env.OMO_OPENCLAW;
      } else {
        process.env.OMO_OPENCLAW = oldEnv;
      }
    });

    it("returns null when OMO_OPENCLAW is not set", async () => {
      delete process.env.OMO_OPENCLAW;
      const config: OpenClawConfig = {
        enabled: true,
        gateways: { gw: { type: "command", command: "echo test" } },
        hooks: {
          "session-start": { gateway: "gw", instruction: "hi", enabled: true },
        },
      };
      const result = await wakeOpenClaw("session-start", { projectPath: "/tmp" }, config);
      expect(result).toBeNull();
    });

    it("returns null when OMO_OPENCLAW is not '1'", async () => {
      process.env.OMO_OPENCLAW = "0";
      const config: OpenClawConfig = {
        enabled: true,
        gateways: { gw: { type: "command", command: "echo test" } },
        hooks: {
          "session-start": { gateway: "gw", instruction: "hi", enabled: true },
        },
      };
      const result = await wakeOpenClaw("session-start", { projectPath: "/tmp" }, config);
      expect(result).toBeNull();
    });

    it("does not use OMX_OPENCLAW (old env var)", async () => {
      delete process.env.OMO_OPENCLAW;
      process.env.OMX_OPENCLAW = "1";
      const config: OpenClawConfig = {
        enabled: true,
        gateways: { gw: { type: "command", command: "echo test" } },
        hooks: {
          "session-start": { gateway: "gw", instruction: "hi", enabled: true },
        },
      };
      const result = await wakeOpenClaw("session-start", { projectPath: "/tmp" }, config);
      expect(result).toBeNull();
      delete process.env.OMX_OPENCLAW;
    });
  });
});
