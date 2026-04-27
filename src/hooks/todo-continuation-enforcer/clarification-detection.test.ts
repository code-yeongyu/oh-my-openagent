/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import { detectClarificationSeeking } from "./clarification-detection"

describe("detectClarificationSeeking", () => {
  test("given empty messages, returns false", () => {
    expect(detectClarificationSeeking([]).isAskingForClarification).toBe(false)
  })

  test("given null-ish input, returns false", () => {
    expect(detectClarificationSeeking(undefined as never).isAskingForClarification).toBe(false)
  })

  test("given last assistant message asking for more details, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "I need more details about the API. What endpoint should I use?" },
        ],
      },
    ]
    const result = detectClarificationSeeking(messages)
    expect(result.isAskingForClarification).toBe(true)
    expect(result.matchedPattern).toBeDefined()
  })

  test("given last assistant message with 'please clarify', returns true", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "Please clarify the requirements before I proceed." },
        ],
      },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given last assistant message asking 'what should I do', returns true", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "What should I do next? I'm stuck here." },
        ],
      },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent saying it cannot proceed without information, returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Cannot proceed without more information about the database schema." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent saying it is blocked on user input, returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "I am blocked until I get clarification on the auth flow." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent saying it needs user direction, returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "I need your direction on how to handle the error case." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent waiting for user input, returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Awaiting your response before I can continue." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent unsure about what to do, returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "I'm unsure about which approach to take here." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent asking how to start, returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "How should I start the implementation?" }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent asking 'which option', returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Which API endpoint should I use for this?" }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent with 'insufficient information', returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "There is insufficient information to complete the task." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent asking 'do you want', returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Do you want me to use REST or GraphQL?" }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent saying it does not know something, returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "I don't know what API key to use for this service." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given user message after clarification (answered), returns false", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "I need more details." }] },
      { info: { role: "user" } },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(false)
  })

  test("given question tool already used, returns false (handled separately)", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "I need more details about the API." },
          { type: "tool_use", name: "question" },
        ],
      },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(false)
  })

  test("given question tool via toolName, returns false", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "I need more details." },
          { type: "tool-invocation", toolName: "question" },
        ],
      },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(false)
  })

  test("given normal work response, returns false", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "I've implemented the feature. The tests pass and lsp_diagnostics is clean." },
        ],
      },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(false)
  })

  test("given agent delegating to subagent, returns false", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Let me delegate this to a subagent for implementation." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(false)
  })

  test("given agent reporting task completion, returns false", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "All tasks are now complete. Running final verification." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(false)
  })

  test("given multiple text parts with clarification in later part, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "I've reviewed the code." },
          { type: "text", text: "I need more instructions on how to proceed with the auth module." },
        ],
      },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given role directly on message (not in info), returns true for clarification", () => {
    const messages = [
      { role: "user" },
      {
        role: "assistant",
        parts: [
          { type: "text", text: "What should I do next?" },
        ],
      },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given assistant message with no text parts, returns false", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool_use", name: "bash" },
        ],
      },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(false)
  })

  test("given 'missing instructions' phrase, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "The instructions for the API integration are missing." },
        ],
      },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given a very long message with clarification buried deep, returns true", () => {
    const longPrefix = "I've analyzed the codebase. ".repeat(50)
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: longPrefix + "I need more instructions about the deployment process." }],
      },
    ]
    const result = detectClarificationSeeking(messages)
    expect(result.isAskingForClarification).toBe(true)
    expect(result.matchedText).toBeDefined()
    expect(result.matchedText!.length).toBeLessThan(longPrefix.length + 200)
  })

  test("given message with a normal mention of 'need' not seeking clarification, returns false", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "You need to run the tests after making changes." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(false)
  })

  test("given message about project requirements (not asking), returns false", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "The requirements for this feature are: auth, database, API." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(false)
  })

  test("given NETBOX MCP CRUD scenario: agent needs schema details, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "I need more details about the Netbox API. What fields are required for the CRUD operations? Which API version should I target? What authentication method should I use?" },
        ],
      },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent describing what it needs to know, returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "I need to know the database connection string and the target schema name." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent trying to clarify scope, returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Could you clarify the scope of this feature?" }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent asking if user wants something, returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Should I implement the feature using TypeScript or JavaScript?" }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent asking about specific configuration, returns true", () => {
    const messages = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "What API endpoint should I use for this integration?" }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given agent that completed work and reported results, returns false", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "I've completed the implementation. All tests pass and the build succeeds. Here are the files changed: src/api/routes.ts, src/models/user.ts" },
          { type: "tool_use", name: "bash" },
        ],
      },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(false)
  })

  // ── Multilingual tests ──────────────────────────────────

  test("given Portuguese (pt-BR) agent asking for details, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Preciso de mais informações sobre a API. Quais campos são obrigatórios?" }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given Spanish agent asking what to do, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "No sé qué hacer, necesito más instrucciones para continuar." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given French agent asking for clarification, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "J'ai besoin de plus de détails avant de pouvoir continuer." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given German agent asking for instructions, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Ich brauche mehr Anweisungen, bevor ich fortfahren kann." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given Japanese agent asking what to do, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "どうすればいいですか？もっと情報が必要です。" }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given Korean agent asking for guidance, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "더 자세한 내용이 필요합니다. 어떻게 해야 할지 모르겠습니다." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given Chinese agent asking what to do, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "我不明白怎么做。请提供更多信息。" }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given Russian agent saying it's stuck, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Мне нужно больше информации. Я не знаю что делать." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given Hindi agent asking for details, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "मुझे और जानकारी चाहिए। मुझे नहीं पता क्या करना है।" }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })

  test("given Arabic agent waiting for input, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "في انتظار ردك. أحتاج إلى مزيد من المعلومات للمتابعة." }] },
    ]
    expect(detectClarificationSeeking(messages).isAskingForClarification).toBe(true)
  })
})
