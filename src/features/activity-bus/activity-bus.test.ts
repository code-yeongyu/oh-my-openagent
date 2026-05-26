import { describe, expect, it } from "bun:test";
import { createActivityBus } from "./activity-bus";
import type { ActivityEvent } from "./types";

describe("ActivityBus", () => {
  // given
  const makeBus = () => {
    let now = 1000;
    const bus = createActivityBus(() => now++);
    return { bus, now: () => now };
  };

  describe("#when emit + on receive event", () => {
    it("#then handler receives the event with timestamp", async () => {
      const { bus } = makeBus();
      const received: ActivityEvent[] = [];

      bus.on("task:created", (e) => received.push(e));
      await bus.emit({
        kind: "task:created",
        data: { taskId: "t1", agent: "a1", description: "d1" },
      });

      expect(received).toHaveLength(1);
      expect(received[0].kind).toBe("task:created");
      expect(received[0].timestamp).toBe(1000);
      expect(received[0].data).toEqual({
        taskId: "t1",
        agent: "a1",
        description: "d1",
      });
    });
  });

  describe("#when unsubscribe returned from on()", () => {
    it("#then handler stops receiving events", async () => {
      const { bus } = makeBus();
      const received: ActivityEvent[] = [];

      const unsub = bus.on("task:created", (e) => received.push(e));
      await bus.emit({
        kind: "task:created",
        data: { taskId: "t1", agent: "a1", description: "d1" },
      });
      expect(received).toHaveLength(1);

      unsub();
      await bus.emit({
        kind: "task:created",
        data: { taskId: "t2", agent: "a2", description: "d2" },
      });
      expect(received).toHaveLength(1);
    });
  });

  describe("#when off() removes handler", () => {
    it("#then handler stops receiving events", async () => {
      const { bus } = makeBus();
      const received: ActivityEvent[] = [];

      const handler = (e: ActivityEvent) => received.push(e);
      bus.on("task:created", handler);
      await bus.emit({
        kind: "task:created",
        data: { taskId: "t1", agent: "a1", description: "d1" },
      });
      expect(received).toHaveLength(1);

      bus.off("task:created", handler);
      await bus.emit({
        kind: "task:created",
        data: { taskId: "t2", agent: "a2", description: "d2" },
      });
      expect(received).toHaveLength(1);
    });
  });

  describe("#when onAny receives all events", () => {
    it("#then handler receives every emitted event", async () => {
      const { bus } = makeBus();
      const received: ActivityEvent[] = [];

      bus.onAny((e) => received.push(e));
      await bus.emit({
        kind: "task:created",
        data: { taskId: "t1", agent: "a1", description: "d1" },
      });
      await bus.emit({
        kind: "agent:spawned",
        data: { agent: "a1", taskId: "t1", model: "m1" },
      });
      await bus.emit({
        kind: "team:created",
        data: { teamId: "tm1", name: "Team1", members: ["a1"] },
      });

      expect(received).toHaveLength(3);
      expect(received[0].kind).toBe("task:created");
      expect(received[1].kind).toBe("agent:spawned");
      expect(received[2].kind).toBe("team:created");
    });
  });

  describe("#when getRecentEvents returns events in order", () => {
    it("#then events are returned chronologically", async () => {
      const { bus } = makeBus();

      await bus.emit({
        kind: "task:created",
        data: { taskId: "t1", agent: "a1", description: "d1" },
      });
      await bus.emit({
        kind: "task:created",
        data: { taskId: "t2", agent: "a2", description: "d2" },
      });

      const recent = bus.getRecentEvents();
      expect(recent).toHaveLength(2);
      expect(recent[0].timestamp).toBe(1000);
      expect(recent[1].timestamp).toBe(1001);
    });
  });

  describe("#when getRecentEvents with type filter", () => {
    it("#then only matching events are returned", async () => {
      const { bus } = makeBus();

      await bus.emit({
        kind: "task:created",
        data: { taskId: "t1", agent: "a1", description: "d1" },
      });
      await bus.emit({
        kind: "agent:spawned",
        data: { agent: "a1", taskId: "t1", model: "m1" },
      });
      await bus.emit({
        kind: "task:created",
        data: { taskId: "t2", agent: "a2", description: "d2" },
      });

      const recent = bus.getRecentEvents("task:created");
      expect(recent).toHaveLength(2);
      expect(recent.every((e) => e.kind === "task:created")).toBe(true);
    });
  });

  describe("#when getSnapshot counts correctly", () => {
    it("#then running count reflects created minus completed/error", async () => {
      const { bus } = makeBus();

      await bus.emit({
        kind: "task:created",
        data: { taskId: "t1", agent: "a1", description: "d1" },
      });
      await bus.emit({
        kind: "task:created",
        data: { taskId: "t2", agent: "a2", description: "d2" },
      });
      await bus.emit({
        kind: "task:completed",
        data: { taskId: "t1", duration: 100 },
      });

      const snapshot = bus.getSnapshot();
      expect(snapshot.running).toBe(1);
    });
  });

  describe("#when handler errors don't crash other handlers", () => {
    it("#then all handlers still run and emit resolves", async () => {
      const { bus } = makeBus();
      const received: string[] = [];

      bus.on("task:created", () => {
        throw new Error("boom");
      });
      bus.on("task:created", () => received.push("ok"));

      await bus.emit({
        kind: "task:created",
        data: { taskId: "t1", agent: "a1", description: "d1" },
      });

      expect(received).toEqual(["ok"]);
    });
  });

  describe("#when ring buffer caps at 100 events", () => {
    it("#then oldest event is dropped after 101 emits", async () => {
      const { bus } = makeBus();

      for (let i = 0; i < 101; i++) {
        await bus.emit({
          kind: "task:created",
          data: { taskId: `t${i}`, agent: "a1", description: "d" },
        });
      }

      const recent = bus.getRecentEvents();
      expect(recent).toHaveLength(100);
      expect(recent[0].data.taskId).toBe("t1");
      expect(recent[99].data.taskId).toBe("t100");
    });
  });

  describe("#when clear() resets everything", () => {
    it("#then handlers and buffer are empty", async () => {
      const { bus } = makeBus();
      const received: ActivityEvent[] = [];

      bus.on("task:created", (e) => received.push(e));
      await bus.emit({
        kind: "task:created",
        data: { taskId: "t1", agent: "a1", description: "d1" },
      });
      expect(received).toHaveLength(1);

      bus.clear();
      await bus.emit({
        kind: "task:created",
        data: { taskId: "t2", agent: "a2", description: "d2" },
      });

      expect(received).toHaveLength(1);
      expect(bus.getRecentEvents()).toHaveLength(1);
      expect(bus.getRecentEvents()[0].data.taskId).toBe("t2");
    });
  });
});
