import type { PluginInput } from "@opencode-ai/plugin";
import type { Message, Part } from "@opencode-ai/sdk";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createAgentUsageReminderHook } from "./index";
import { REMINDER_MESSAGE } from "./constants";
import { clearSessionAgent, updateSessionAgent, _resetForTesting } from "../../features/claude-code-session-state";
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value";
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
    return createAgentUsageReminderHook(unsafeTestValue<PluginInput>({}));
  }

  type MessageWithParts = {
    info: Message;
    parts: Part[];
  };

  function createOutput(text = "result") {
    return { title: "", output: text, metadata: {} };
  }

  function createUserTurn(
    sessionID: string,
    text: string,
    options: { id?: string; synthetic?: boolean } = {},
  ): MessageWithParts {
    const messageID = options.id ?? `msg_${sessionID}`;
    return {
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: 1 },
        agent: "sisyphus",
        model: { providerID: "test", modelID: "test" },
      },
      parts: [{
        id: `prt_${messageID}`,
        sessionID,
        messageID,
        type: "text",
        text,
        ...(options.synthetic === true ? { synthetic: true } : {}),
      }],
    };
  }

  function findReminderParts(messages: MessageWithParts[]): Part[] {
    return messages.flatMap((message) => message.parts).filter(
      (part) => part.type === "text"
        && part.synthetic === true
        && part.id === `prt_agent_usage_reminder_${part.messageID}`,
    );
  }

  async function transformMessages(
    hook: ReturnType<typeof createHook>,
    messages: MessageWithParts[],
  ): Promise<void> {
    await hook["experimental.chat.messages.transform"]({}, { messages });
  }

  async function useTool(
    hook: ReturnType<typeof createHook>,
    sessionID: string,
    tool: string,
    callID: string,
    output = createOutput(),
  ) {
    await hook["tool.execute.after"]({ tool, sessionID, callID }, output);
    return output;
  }

  test("does not append the reminder onto tool result payloads", async () => {
    const hook = createHook();
    const sessionID = "agent-usage-payload-session";
    updateSessionAgent(sessionID, "Sisyphus");
    const original = "stdout\r\nwith trailing bytes\u0000\n";
    const output = createOutput(original);

    await useTool(hook, sessionID, "grep", "1", output);
    const messages = [createUserTurn(sessionID, "continue")];
    await transformMessages(hook, messages);

    expect(output.output).toBe(original);
    expect(output.output).not.toContain("[Agent Usage Reminder]");
    expect(findReminderParts(messages)).toHaveLength(1);
    expect(messages[0]?.parts[0]).toMatchObject({ synthetic: true, type: "text" });
    expect(messages[0]?.parts[1]).toMatchObject({ text: "continue", type: "text" });
    const reminder = findReminderParts(messages)[0];
    expect(reminder?.type).toBe("text");
    if (reminder?.type !== "text") throw new Error("expected reminder text part");
    expect(reminder.text).toBe(REMINDER_MESSAGE);

    clearSessionAgent(sessionID);
  });

  test("caps reminders and does not re-arm after session.compacted", async () => {
    const hook = createHook();
    const sessionID = "agent-usage-compact-session";
    updateSessionAgent(sessionID, "Sisyphus");

    const outputs = [
      createOutput("result-1"),
      createOutput("result-2"),
      createOutput("result-3"),
      createOutput("result-4"),
    ];
    const injected: MessageWithParts[] = [];

    for (const [index, output] of outputs.slice(0, 3).entries()) {
      await useTool(hook, sessionID, "grep", String(index + 1), output);
      const messages = [createUserTurn(sessionID, `continue-${index + 1}`, { id: `msg_${index + 1}` })];
      await transformMessages(hook, messages);
      injected.push(...messages);
    }

    expect(outputs[0]?.output).toBe("result-1");
    expect(outputs[1]?.output).toBe("result-2");
    expect(outputs[2]?.output).toBe("result-3");
    expect(findReminderParts(injected)).toHaveLength(3);

    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } });
    await useTool(hook, sessionID, "grep", "4", outputs[3]);
    const afterCompact = [createUserTurn(sessionID, "continue-4", { id: "msg_4" })];
    await transformMessages(hook, afterCompact);

    expect(outputs[3]?.output).toBe("result-4");
    expect(findReminderParts(afterCompact)).toHaveLength(0);

    clearSessionAgent(sessionID);
  });

  test("resets reminder state on session.deleted", async () => {
    const hook = createHook();
    const sessionID = "agent-usage-delete-session";
    updateSessionAgent(sessionID, "Sisyphus");

    const outputs = [
      createOutput("result-1"),
      createOutput("result-2"),
      createOutput("result-3"),
      createOutput("result-4"),
      createOutput("result-5"),
    ];

    for (const [index, output] of outputs.slice(0, 4).entries()) {
      await useTool(hook, sessionID, "grep", String(index + 1), output);
      const messages = [createUserTurn(sessionID, `continue-${index + 1}`, { id: `msg_${index + 1}` })];
      await transformMessages(hook, messages);
      if (index < 3) {
        expect(findReminderParts(messages)).toHaveLength(1);
      } else {
        expect(findReminderParts(messages)).toHaveLength(0);
      }
    }

    expect(outputs[0]?.output).toBe("result-1");
    expect(outputs[3]?.output).toBe("result-4");

    await hook.event({ event: { type: "session.deleted", properties: { info: { id: sessionID } } } });
    await useTool(hook, sessionID, "grep", "5", outputs[4]);
    const afterDelete = [createUserTurn(sessionID, "continue-5", { id: "msg_5" })];
    await transformMessages(hook, afterDelete);

    expect(outputs[4]?.output).toBe("result-5");
    expect(findReminderParts(afterDelete)).toHaveLength(1);

    clearSessionAgent(sessionID);
  });

  test("does not re-arm after session.compacted when task delegation already happened", async () => {
    const hook = createHook();
    const sessionID = "agent-usage-delegated-session";
    updateSessionAgent(sessionID, "Sisyphus");

    const output = createOutput();
    await useTool(hook, sessionID, "task", "1", output);

    await hook.event({ event: { type: "session.compacted", properties: { sessionID } } });
    await useTool(hook, sessionID, "grep", "2", output);
    const messages = [createUserTurn(sessionID, "continue")];
    await transformMessages(hook, messages);

    expect(output.output).toBe("result");
    expect(findReminderParts(messages)).toHaveLength(0);

    clearSessionAgent(sessionID);
  });

  test("coalesces multiple target tools into one injected reminder", async () => {
    const hook = createHook();
    const sessionID = "agent-usage-coalesce-session";
    updateSessionAgent(sessionID, "Sisyphus");

    const first = createOutput("grep-hits");
    const second = createOutput("glob-hits");
    const third = createOutput("fetch-body");
    await useTool(hook, sessionID, "grep", "1", first);
    await useTool(hook, sessionID, "glob", "2", second);
    await useTool(hook, sessionID, "webfetch", "3", third);

    const firstTurn = [createUserTurn(sessionID, "first turn", { id: "msg_first" })];
    await transformMessages(hook, firstTurn);
    await useTool(hook, sessionID, "grep", "4", createOutput("later"));
    const secondTurn = [createUserTurn(sessionID, "second turn", { id: "msg_second" })];
    await transformMessages(hook, secondTurn);

    expect(first.output).toBe("grep-hits");
    expect(second.output).toBe("glob-hits");
    expect(third.output).toBe("fetch-body");
    expect(findReminderParts(firstTurn)).toHaveLength(1);
    expect(findReminderParts(secondTurn)).toHaveLength(1);

    clearSessionAgent(sessionID);
  });

  test("retains a queued reminder until a real user text part exists", async () => {
    const hook = createHook();
    const sessionID = "agent-usage-pending-session";
    updateSessionAgent(sessionID, "Sisyphus");
    await useTool(hook, sessionID, "grep", "1");

    const noText = createUserTurn(sessionID, "unused");
    noText.parts = [];
    await transformMessages(hook, []);
    await transformMessages(hook, [noText]);
    await transformMessages(hook, [createUserTurn(sessionID, "internal", { synthetic: true })]);
    const realMessages = [createUserTurn(sessionID, "real user text", { id: "msg_real" })];
    await transformMessages(hook, realMessages);

    expect(findReminderParts(realMessages)).toHaveLength(1);

    clearSessionAgent(sessionID);
  });
});
