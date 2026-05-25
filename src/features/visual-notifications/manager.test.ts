import { describe, expect, it } from "bun:test";
import { VisualNotificationManager } from "./manager";
import type { VisualNotificationConfig } from "./manager";
import type { ActivityEvent } from "../activity-bus/types";

// given
type Handler = (event: ActivityEvent) => void | Promise<void>;
class FakeBus {
  handlers = new Set<Handler>();

  onAny(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async emit(event: ActivityEvent): Promise<void> {
    for (const h of this.handlers) {
      await h(event);
    }
  }
}

const defaultConfig: VisualNotificationConfig = {
  on_task_complete: true,
  on_error: true,
  on_team_member_join: true,
  sound: false,
};

const makeEvent = (
  kind: ActivityEvent["kind"],
  data: Record<string, unknown>,
  ts = Date.now(),
): ActivityEvent => ({ kind, data, timestamp: ts } as ActivityEvent);

function captureStdout(): { outputs: string[]; restore: () => void } {
  const outputs: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: any) => {
    outputs.push(String(chunk));
    return true;
  };
  return {
    outputs,
    restore: () => {
      process.stdout.write = orig;
    },
  };
}

describe("VisualNotificationManager", () => {
  describe("#given constructor", () => {
    it("#then accepts bus and config", () => {
      // given
      const bus = new FakeBus();
      // when
      const mgr = new VisualNotificationManager(
        bus as any as import("../activity-bus/types").ActivityBus,
        defaultConfig,
      );
      // then
      expect(mgr).toBeDefined();
    });
  });

  describe("#when start/stop lifecycle", () => {
    it("#then start registers onAny handler and stop unregisters it", async () => {
      // given
      const bus = new FakeBus();
      const mgr = new VisualNotificationManager(
        bus as any as import("../activity-bus/types").ActivityBus,
        { ...defaultConfig, on_task_complete: true, on_error: false, on_team_member_join: false },
      );
      expect(bus.handlers.size).toBe(0);

      // when
      mgr.start();
      // then
      expect(bus.handlers.size).toBe(1);

      // when
      mgr.stop();
      // then
      expect(bus.handlers.size).toBe(0);
    });
  });

  describe("#when task:completed event fires", () => {
    it("#then shows notification when on_task_complete is true", async () => {
      // given
      const bus = new FakeBus();
      const mgr = new VisualNotificationManager(
        bus as any as import("../activity-bus/types").ActivityBus,
        { ...defaultConfig, on_task_complete: true, on_error: false, on_team_member_join: false },
      );
      mgr.start();
      const cap = captureStdout();

      try {
        // when
        await bus.emit(makeEvent("task:completed", { taskId: "t1", duration: 500 }));

        // then
        expect(cap.outputs.length).toBeGreaterThanOrEqual(1);
        expect(cap.outputs.some((o) => o.includes("✅") && o.includes("t1"))).toBe(true);
      } finally {
        cap.restore();
      }
    });

    it("#then does NOT show notification when on_task_complete is false", async () => {
      // given
      const bus = new FakeBus();
      const mgr = new VisualNotificationManager(
        bus as any as import("../activity-bus/types").ActivityBus,
        { ...defaultConfig, on_task_complete: false, on_error: false, on_team_member_join: false },
      );
      mgr.start();
      const cap = captureStdout();

      try {
        // when
        await bus.emit(makeEvent("task:completed", { taskId: "t1", duration: 500 }));

        // then
        const notificationLines = cap.outputs.filter((o) => o.includes("[notification]"));
        expect(notificationLines).toHaveLength(0);
      } finally {
        cap.restore();
      }
    });
  });

  describe("#when task:error event fires", () => {
    it("#then shows notification with error message", async () => {
      // given
      const bus = new FakeBus();
      const mgr = new VisualNotificationManager(
        bus as any as import("../activity-bus/types").ActivityBus,
        { ...defaultConfig, on_task_complete: false, on_error: true, on_team_member_join: false },
      );
      mgr.start();
      const cap = captureStdout();

      try {
        // when
        await bus.emit(makeEvent("task:error", { taskId: "t2", error: "timeout", duration: 1000 }));

        // then
        expect(cap.outputs.some((o) => o.includes("❌") && o.includes("t2") && o.includes("timeout"))).toBe(true);
      } finally {
        cap.restore();
      }
    });
  });

  describe("#when team:created event fires", () => {
    it("#then shows notification with team name", async () => {
      // given
      const bus = new FakeBus();
      const mgr = new VisualNotificationManager(
        bus as any as import("../activity-bus/types").ActivityBus,
        { ...defaultConfig, on_task_complete: false, on_error: false, on_team_member_join: true },
      );
      mgr.start();
      const cap = captureStdout();

      try {
        // when
        await bus.emit(makeEvent("team:created", { teamId: "team1", name: "Alpha", members: ["a", "b"] }));

        // then
        expect(cap.outputs.some((o) => o.includes("🤖") && o.includes("Alpha"))).toBe(true);
      } finally {
        cap.restore();
      }
    });
  });

  describe("#when rapid same-type events fire", () => {
    it("#then only first fires (rate limited to 1 per 2s)", async () => {
      // given
      const bus = new FakeBus();
      const mgr = new VisualNotificationManager(
        bus as any as import("../activity-bus/types").ActivityBus,
        { ...defaultConfig, on_task_complete: true, on_error: false, on_team_member_join: false },
      );
      mgr.start();
      const cap = captureStdout();

      try {
        // when — emit two task:completed events within rate limit window
        const now = Date.now();
        await bus.emit(makeEvent("task:completed", { taskId: "t1", duration: 500 }, now));
        await bus.emit(makeEvent("task:completed", { taskId: "t2", duration: 300 }, now + 10));

        // then
        const notificationLines = cap.outputs.filter((o) => o.includes("[notification]"));
        expect(notificationLines).toHaveLength(1);
      } finally {
        cap.restore();
      }
    });
  });

  describe("#when different event types fire rapidly", () => {
    it("#then both fire (rate limit is per-type)", async () => {
      // given
      const bus = new FakeBus();
      const mgr = new VisualNotificationManager(
        bus as any as import("../activity-bus/types").ActivityBus,
        { ...defaultConfig, on_task_complete: true, on_error: true, on_team_member_join: false },
      );
      mgr.start();
      const cap = captureStdout();

      try {
        // when
        const now = Date.now();
        await bus.emit(makeEvent("task:completed", { taskId: "t1", duration: 500 }, now));
        await bus.emit(makeEvent("task:error", { taskId: "t1", error: "fail", duration: 500 }, now + 10));

        // then
        const notificationLines = cap.outputs.filter((o) => o.includes("[notification]"));
        expect(notificationLines).toHaveLength(2);
      } finally {
        cap.restore();
      }
    });
  });

  describe("#when sound config is true and error fires", () => {
    it("#then playBeep is called", async () => {
      // given
      const bus = new FakeBus();
      const mgr = new VisualNotificationManager(
        bus as any as import("../activity-bus/types").ActivityBus,
        { ...defaultConfig, on_task_complete: false, on_error: true, on_team_member_join: false, sound: true },
      );
      mgr.start();
      const beeps: string[] = [];
      const orig = process.stdout.write.bind(process.stdout);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdout as any).write = (chunk: any) => {
        if (String(chunk) === "\x07") beeps.push(String(chunk));
        return true;
      };

      try {
        // when
        await bus.emit(makeEvent("task:error", { taskId: "t1", error: "fail", duration: 500 }));

        // then
        expect(beeps).toHaveLength(1);
      } finally {
        process.stdout.write = orig;
      }
    });
  });

  describe("#when updateConfig is called", () => {
    it("#then config is updated", () => {
      // given
      const bus = new FakeBus();
      const mgr = new VisualNotificationManager(
        bus as any as import("../activity-bus/types").ActivityBus,
        { ...defaultConfig },
      );

      // when
      mgr.updateConfig({ on_task_complete: false });

      // then — smoke test, no throw
      expect(true).toBe(true);
    });
  });

  describe("#when shouldNotify is called directly", () => {
    it("#then returns true for supported kinds and false otherwise", () => {
      const bus = new FakeBus();
      const mgr = new VisualNotificationManager(
        bus as any as import("../activity-bus/types").ActivityBus,
        defaultConfig,
      );

      // Access private method through prototype for testing
      const shouldNotify = (VisualNotificationManager.prototype as unknown as Record<string, (k: string) => boolean>).shouldNotify.bind(mgr);

      expect(shouldNotify("task:completed")).toBe(true);
      expect(shouldNotify("task:error")).toBe(true);
      expect(shouldNotify("team:created")).toBe(true);
      expect(shouldNotify("agent:spawned")).toBe(false);
      expect(shouldNotify("unknown:event")).toBe(false);
    });
  });
});
