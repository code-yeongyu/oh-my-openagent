import { describe, it, expect } from "bun:test";
import { OpenClawConfigSchema } from "../../config/schema/openclaw";

describe("OpenClaw Config Schema", () => {
  it("validates correct config", () => {
    const raw = {
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
      },
    };
    const parsed = OpenClawConfigSchema.safeParse(raw);
    if (!parsed.success) console.log(parsed.error);
    expect(parsed.success).toBe(true);
  });

  it("fails on invalid event", () => {
    const raw = {
      enabled: true,
      gateways: {},
      hooks: {
        "invalid-event": {
          gateway: "foo",
          instruction: "start",
          enabled: true,
        },
      },
    };
    const parsed = OpenClawConfigSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
  });
});
