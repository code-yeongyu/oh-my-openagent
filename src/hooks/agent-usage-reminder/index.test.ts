import type { PluginInput } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createAgentUsageReminderHook } from "./index";
import { clearSessionAgent, updateSessionAgent, _resetForTesting } from "../../features/claude-code-session-state";
import * as storage from "./storage";

describe("agent-usage-reminder hook", () => {
  let loadStateSpy: ReturnType<typeof spyOn>;
  let saveStateSpy: ReturnType<typeof spyOn>;
  let clearStateSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    _resetForTesting();
    loadStateSpy = spyOn(storage, "loadAgentUsageState").mockReturnValue(null);
    saveStateSpy = spyOn(storage, "saveAgentUsageState").mockImplementation(mock(() => {}));
    clearStateSpy = spyOn(storage, "clearAgentUsageState").mockImplementation(mock(() => {}));
  });

  afterEach(() => {
    loadStateSpy?.mockRestore();
    saveStateSpy?.mockRestore();
    clearStateSpy?.mockRestore();
  });

  function createHook() {
    return createAgentUsageReminderHook({} as PluginInput);
  }

  test("caps reminders and does not re-arm after session.compacted", async () => {
    // given - an orchestrator session has already hit the reminder cap
    const hook = createHook();
    const sessionID = "agent-usage-compact-session";
    updateSessionAgent(sessionID, "Sisyphus");

    const output1 = { title: "", output: "result-1", metadata: {} };
    const output2 = { title: "", output: "result-2", metadata: {} };
    const output3 = { title: "", output: "result-3", metadata: {} };
    const output4 = { title: "", output: "result-4", metadata: {} };

    await hook["tool.execute.after"]({ tool: "grep", sessionID, callID: "1" }, output1);
    await hook["tool.execute.after"]({ tool: "grep", sessionID, callID: "2" }, output2);
    await hook["tool.execute.after"]({ tool: "grep", sessionID, callID: "3" }, output3);

    // then - the first three reminders are shown
    expect(output1.output).toContain("[Agent Usage Reminder]");
    expect(output2.output).toContain("[Agent Usage Reminder]");
    expect(output3.output).toContain("[Agent Usage Reminder]");

    // when - compaction happens and another target tool runs
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } });
    await hook["tool.execute.after"]({ tool: "grep", sessionID, callID: "4" }, output4);

    // then - compaction does not reset the reminder cap
    expect(output4.output).not.toContain("[Agent Usage Reminder]");

    clearSessionAgent(sessionID);
  });

  test("resets reminder state on session.deleted", async () => {
    // given - an orchestrator session has reminder state
    const hook = createHook();
    const sessionID = "agent-usage-delete-session";
    updateSessionAgent(sessionID, "Sisyphus");

    const output1 = { title: "", output: "result-1", metadata: {} };
    const output2 = { title: "", output: "result-2", metadata: {} };
    const output3 = { title: "", output: "result-3", metadata: {} };
    const output4 = { title: "", output: "result-4", metadata: {} };
    const output5 = { title: "", output: "result-5", metadata: {} };

    await hook["tool.execute.after"]({ tool: "grep", sessionID, callID: "1" }, output1);
    await hook["tool.execute.after"]({ tool: "grep", sessionID, callID: "2" }, output2);
    await hook["tool.execute.after"]({ tool: "grep", sessionID, callID: "3" }, output3);
    await hook["tool.execute.after"]({ tool: "grep", sessionID, callID: "4" }, output4);

    expect(output1.output).toContain("[Agent Usage Reminder]");
    expect(output2.output).toContain("[Agent Usage Reminder]");
    expect(output3.output).toContain("[Agent Usage Reminder]");
    expect(output4.output).not.toContain("[Agent Usage Reminder]");

    // when - the session is deleted and another target tool runs
    await hook.event({ event: { type: "session.deleted", properties: { info: { id: sessionID } } } });
    await hook["tool.execute.after"]({ tool: "grep", sessionID, callID: "5" }, output5);

    // then - deletion still resets the state
    expect(output5.output).toContain("[Agent Usage Reminder]");

    clearSessionAgent(sessionID);
  });

  test("does not re-arm after session.compacted when task delegation already happened", async () => {
    const hook = createHook();
    const sessionID = "agent-usage-delegated-session";
    updateSessionAgent(sessionID, "Sisyphus");

    const output = { title: "", output: "result", metadata: {} };

    await hook["tool.execute.after"]({ tool: "task", sessionID, callID: "1" }, output);
    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } });
    await hook["tool.execute.after"]({ tool: "grep", sessionID, callID: "2" }, output);

    expect(output.output).not.toContain("[Agent Usage Reminder]");

    clearSessionAgent(sessionID);
  });
});
