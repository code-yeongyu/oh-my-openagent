function frame(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

export function fakeFinishedSseWithThinking(): string {
  return [
    frame({
      v: {
        response: {
          message_id: 101,
          fragments: [{ id: 2, type: "THINK", content: "我们" }],
        },
      },
    }),
    frame({ p: "response/fragments/-1/content", o: "APPEND", v: "被" }),
    frame({ v: "问到" }),
    frame({
      p: "response/fragments",
      o: "APPEND",
      v: [{ id: 3, type: "RESPONSE", content: "园" }],
    }),
    frame({ p: "response/fragments/-1/content", o: "APPEND", v: "林" }),
    frame({ v: "里。" }),
    frame({ p: "response/status", v: "FINISHED" }),
  ].join("")
}

export function fakeFinishedSseLegacyContent(): string {
  return [
    frame({ p: "response/content", o: "APPEND", v: "hello" }),
    frame({ v: " world" }),
    frame({ p: "response/status", v: "FINISHED" }),
  ].join("")
}

export function fakeFinishedSseThinkingOnly(): string {
  return [
    frame({
      v: {
        response: {
          message_id: 102,
          fragments: [{ id: 2, type: "THINK", content: "alpha" }],
        },
      },
    }),
    frame({ p: "response/fragments/-1/content", o: "APPEND", v: "beta" }),
    frame({ p: "response/status", v: "FINISHED" }),
  ].join("")
}

export function fakeFinishedSseResponseOnly(): string {
  return [
    frame({
      v: {
        response: {
          message_id: 103,
          fragments: [{ id: 2, type: "RESPONSE", content: "alpha" }],
        },
      },
    }),
    frame({ p: "response/fragments/-1/content", o: "APPEND", v: "beta" }),
    frame({ p: "response/status", v: "FINISHED" }),
  ].join("")
}
