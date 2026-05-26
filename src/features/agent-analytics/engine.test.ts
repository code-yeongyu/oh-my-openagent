import { describe, expect, it } from "bun:test";
import { createActivityBus } from "../activity-bus/activity-bus";
import { AnalyticsEngine } from "./engine";

// given
const makeBus = () => {
  let now = 1000;
  const bus = createActivityBus(() => now++);
  return { bus, tick: () => now };
};

const emitTaskCreated = async (
  bus: ReturnType<typeof makeBus>["bus"],
  taskId: string,
  agent: string,
  description = "test task",
) => {
  await bus.emit({
    kind: "task:created",
    data: { taskId, agent, description },
  });
};

const emitTaskCompleted = async (
  bus: ReturnType<typeof makeBus>["bus"],
  taskId: string,
  duration = 500,
) => {
  await bus.emit({
    kind: "task:completed",
    data: { taskId, duration },
  });
};

const emitTaskError = async (
  bus: ReturnType<typeof makeBus>["bus"],
  taskId: string,
  duration = 300,
  error = "test error",
) => {
  await bus.emit({
    kind: "task:error",
    data: { taskId, error, duration },
  });
};

const emitAgentActivity = async (
  bus: ReturnType<typeof makeBus>["bus"],
  agent: string,
  toolName = "test_tool",
  sessionId = "ses_001",
) => {
  await bus.emit({
    kind: "agent:activity",
    data: { agent, toolName, sessionId },
  });
};

const emitAgentSpawned = async (
  bus: ReturnType<typeof makeBus>["bus"],
  agent: string,
  taskId = "t0",
  model = "test-model",
) => {
  await bus.emit({
    kind: "agent:spawned",
    data: { agent, taskId, model },
  });
};

const emitAgentCompleted = async (
  bus: ReturnType<typeof makeBus>["bus"],
  agent: string,
  duration = 1000,
  sessionId = "ses_001",
) => {
  await bus.emit({
    kind: "agent:completed",
    data: { agent, duration, sessionId },
  });
};

describe("AnalyticsEngine", () => {
  describe("#when created and started", () => {
    it("#then engine subscribes to events and builds snapshot", async () => {
      // given
      const { bus } = makeBus();
      const engine = new AnalyticsEngine(bus);

      // when
      engine.start();
      await emitTaskCreated(bus, "t1", "sisyphus");
      await emitTaskCompleted(bus, "t1", 500);

      const snapshot = engine.getSnapshot();

      // then
      expect(snapshot.agentStats).toHaveLength(1);
      expect(snapshot.agentStats[0].agentName).toBe("sisyphus");
      expect(snapshot.agentStats[0].totalTasks).toBe(1);
      expect(snapshot.agentStats[0].completedTasks).toBe(1);
      expect(snapshot.agentStats[0].totalDurationMs).toBe(500);
      engine.stop();
    });
  });

  describe("#when engine tracks agent stats across multiple events", () => {
    it("#then accumulates stats per agent", async () => {
      // given
      const { bus } = makeBus();
      const engine = new AnalyticsEngine(bus);
      engine.start();

      // when
      await emitTaskCreated(bus, "t1", "atlas");
      await emitTaskCreated(bus, "t2", "atlas");
      await emitTaskCreated(bus, "t3", "hephaestus");
      await emitTaskCompleted(bus, "t1", 200);
      await emitTaskCompleted(bus, "t2", 400);
      await emitTaskError(bus, "t3", 150);

      const snapshot = engine.getSnapshot();

      // then
      const atlas = snapshot.agentStats.find((s) => s.agentName === "atlas");
      const hephaestus = snapshot.agentStats.find((s) => s.agentName === "hephaestus");

      expect(atlas).toBeDefined();
      expect(atlas!.totalTasks).toBe(2);
      expect(atlas!.completedTasks).toBe(2);
      expect(atlas!.failedTasks).toBe(0);
      expect(atlas!.totalDurationMs).toBe(600);

      expect(hephaestus).toBeDefined();
      expect(hephaestus!.totalTasks).toBe(1);
      expect(hephaestus!.completedTasks).toBe(0);
      expect(hephaestus!.failedTasks).toBe(1);
      expect(hephaestus!.totalDurationMs).toBe(150);

      engine.stop();
    });
  });

  describe("#when agent activity events are emitted", () => {
    it("#then tracks tool calls and active time", async () => {
      // given
      const { bus } = makeBus();
      const engine = new AnalyticsEngine(bus);
      engine.start();

      // when
      await emitAgentActivity(bus, "sisyphus", "read");
      await emitAgentActivity(bus, "sisyphus", "write");
      await emitAgentActivity(bus, "sisyphus", "bash");
      await emitAgentCompleted(bus, "sisyphus", 2000);

      const snapshot = engine.getSnapshot();

      // then
      const sisyphus = snapshot.agentStats.find((s) => s.agentName === "sisyphus");
      expect(sisyphus).toBeDefined();
      expect(sisyphus!.toolCalls).toBe(3);
      // 100ms per activity tick * 3 + 2000 from agent:completed
      expect(sisyphus!.activeTimeMs).toBe(2300);

      engine.stop();
    });
  });

  describe("#when duration samples fill the ring buffer", () => {
    it("#then only keeps up to maxSamples", async () => {
      // given
      const { bus } = makeBus();
      const engine = new AnalyticsEngine(bus, { maxSamples: 3 });
      engine.start();

      // when
      for (let i = 0; i < 5; i++) {
        await emitTaskCreated(bus, `t${i}`, "agent");
        await emitTaskCompleted(bus, `t${i}`, i * 100);
      }

      // then
      const snapshot = engine.getSnapshot();
      expect(snapshot.recentDurations).toHaveLength(3);
      // t2, t3, t4 should remain (ring buffer drops oldest)
      expect(snapshot.recentDurations[0].taskId).toBe("t2");
      expect(snapshot.recentDurations[2].taskId).toBe("t4");

      engine.stop();
    });
  });

  describe("#when events span multiple time buckets", () => {
    it("#then heatmap cells are computed correctly", async () => {
      // given
      const { bus } = makeBus();
      const engine = new AnalyticsEngine(bus);
      engine.start();

      // when - events at timestamps 1000, 1001, 1002 (same minute bucket)
      await emitAgentSpawned(bus, "atlas");
      await emitAgentActivity(bus, "atlas", "read");
      await emitAgentActivity(bus, "atlas", "write");
      const snapshot = engine.getSnapshot();

      // then
      expect(snapshot.heatmap.length).toBeGreaterThan(0);
      for (const cell of snapshot.heatmap) {
        expect(cell.agentName).toBe("atlas");
        expect(cell.timeBucket).toBeGreaterThanOrEqual(0);
        expect(cell.intensity).toBeGreaterThanOrEqual(0);
        expect(cell.intensity).toBeLessThanOrEqual(1);
        expect(cell.eventCount).toBeGreaterThan(0);
      }

      engine.stop();
    });
  });

  describe("#when engines computes success rate", () => {
    it("#then reflects completed/failed ratio", async () => {
      // given
      const { bus } = makeBus();
      const engine = new AnalyticsEngine(bus);
      engine.start();

      // when
      await emitTaskCreated(bus, "t1", "agent-a");
      await emitTaskCreated(bus, "t2", "agent-a");
      await emitTaskCreated(bus, "t3", "agent-b");
      await emitTaskCreated(bus, "t4", "agent-b");
      await emitTaskCompleted(bus, "t1", 100);
      await emitTaskCompleted(bus, "t2", 200);
      await emitTaskError(bus, "t3", 50);
      await emitTaskCompleted(bus, "t4", 300);

      const snapshot = engine.getSnapshot();

      // then
      const aRate = snapshot.successRate.find((r) => r.agent === "agent-a");
      const bRate = snapshot.successRate.find((r) => r.agent === "agent-b");

      expect(aRate).toBeDefined();
      expect(aRate!.rate).toBe(1); // 2 completed, 0 failed
      expect(aRate!.total).toBe(2);

      expect(bRate).toBeDefined();
      expect(bRate!.rate).toBe(0.5); // 1 completed, 1 failed
      expect(bRate!.total).toBe(2);
      expect(bRate!.failed).toBe(1);

      engine.stop();
    });
  });

  describe("#when cost estimation runs", () => {
    it("#then estimates based on tool calls", async () => {
      // given
      const { bus } = makeBus();
      const engine = new AnalyticsEngine(bus);
      engine.start();

      // when
      await emitAgentSpawned(bus, "sisyphus");
      for (let i = 0; i < 10; i++) {
        await emitAgentActivity(bus, "sisyphus", "tool_" + i);
      }

      const snapshot = engine.getSnapshot();

      // then
      const cost = snapshot.costEstimate.find((c) => c.agent === "sisyphus");
      expect(cost).toBeDefined();
      // 10 tool calls * 1000 tokens = 10000 tokens
      expect(cost!.estimatedTokens).toBe(10000);
      // 10000 * 0.000002 = 0.02
      expect(cost!.estimatedCostUsd).toBe(0.02);

      engine.stop();
    });
  });

  describe("#when summary is computed", () => {
    it("#then aggregates across all agents", async () => {
      // given
      const { bus } = makeBus();
      const engine = new AnalyticsEngine(bus);
      engine.start();

      // when
      await emitTaskCreated(bus, "t1", "a");
      await emitTaskCreated(bus, "t2", "a");
      await emitTaskCreated(bus, "t3", "b");
      await emitTaskCompleted(bus, "t1", 200);
      await emitTaskCompleted(bus, "t2", 400);
      await emitTaskError(bus, "t3", 100);

      const snapshot = engine.getSnapshot();

      // then
      expect(snapshot.summary.totalTasks).toBe(3);
      expect(snapshot.summary.totalCompleted).toBe(2);
      expect(snapshot.summary.totalFailed).toBe(1);
      // (200 + 400 + 100) / 3 = 233.33 -> 233
      expect(snapshot.summary.avgDurationMs).toBe(233);
      expect(snapshot.summary.uptimeMs).toBeGreaterThanOrEqual(0);

      engine.stop();
    });
  });

  describe("#when engine is stopped", () => {
    it("#then no longer receives events", async () => {
      // given
      const { bus } = makeBus();
      const engine = new AnalyticsEngine(bus);
      engine.start();
      engine.stop();

      // when - events emitted after stop
      await emitTaskCreated(bus, "t1", "ghost");
      await emitTaskCompleted(bus, "t1", 500);

      const snapshot = engine.getSnapshot();

      // then - no agent stats should have been tracked
      expect(snapshot.agentStats).toHaveLength(0);

      engine.stop(); // safe to call twice
    });
  });

  describe("#when engine is started twice", () => {
    it("#then does not double-subscribe", async () => {
      // given
      const { bus } = makeBus();
      const engine = new AnalyticsEngine(bus);

      // when
      engine.start();
      engine.start(); // second start should be no-op

      await emitTaskCreated(bus, "t1", "agent");
      await emitTaskCompleted(bus, "t1", 100);

      const snapshot = engine.getSnapshot();

      // then - should only have counted events once
      expect(snapshot.agentStats).toHaveLength(1);
      expect(snapshot.agentStats[0].totalTasks).toBe(1);
      expect(snapshot.agentStats[0].completedTasks).toBe(1);

      engine.stop();
    });
  });
});
