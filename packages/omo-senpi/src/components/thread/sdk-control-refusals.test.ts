import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGatewayStore } from "./gateway/store"
import { createThreadSdk } from "./sdk"
import type { ThreadHost } from "./tools"

// Design 4.1: createThreadSdk is a compatibility facade that answers exactly what it shipped. The expected answers below
// are the shipped code's own, captured at the base before the facade moved over the root (design lane ruling on the
// regression slice T1b found): every self and not_found refusal of the controls keeps its nested kind, field for field
// and in its key order. The existing self-address test compared with toMatchObject, which ignores extra fields.
const SHIPPED = {
  interrupt: {
    kind: "error",
    error: {
      kind: "error",
      code: "caller_context_missing",
      message: "The caller's durable session id is not in the thread address book.",
      next_action:
        "Call thread_list (tool.thread_list() in an eval cell) and pass an explicit thread, or retry from a session with caller context.",
    },
  },
  closeSelf: {
    kind: "error",
    error: {
      kind: "error",
      code: "caller_context_missing",
      message: "The caller's durable session id is not in the thread address book.",
      next_action:
        "Call thread_list (tool.thread_list() in an eval cell) and pass an explicit thread, or retry from a session with caller context.",
    },
  },
  closeDefault: {
    kind: "error",
    error: {
      kind: "error",
      code: "caller_context_missing",
      message: "The caller's durable session id is not in the thread address book.",
      next_action:
        "Call thread_list (tool.thread_list() in an eval cell) and pass an explicit thread, or retry from a session with caller context.",
    },
  },
  renameSelf: {
    kind: "error",
    error: {
      kind: "error",
      code: "caller_context_missing",
      message: "The caller's durable session id is not in the thread address book.",
      next_action:
        "Call thread_list (tool.thread_list() in an eval cell) and pass an explicit thread, or retry from a session with caller context.",
    },
  },
  renameDefault: {
    kind: "error",
    error: {
      kind: "error",
      code: "caller_context_missing",
      message: "The caller's durable session id is not in the thread address book.",
      next_action:
        "Call thread_list (tool.thread_list() in an eval cell) and pass an explicit thread, or retry from a session with caller context.",
    },
  },
  setModel: {
    kind: "error",
    error: {
      kind: "error",
      code: "caller_context_missing",
      message: "The caller's durable session id is not in the thread address book.",
      next_action:
        "Call thread_list (tool.thread_list() in an eval cell) and pass an explicit thread, or retry from a session with caller context.",
    },
  },
  interruptMissing: {
    kind: "error",
    error: {
      kind: "error",
      code: "not_found",
      message: 'No visible thread matches "nope-thread" in this workspace.',
      next_action:
        "Call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value or a unique name it returned.",
      details: {
        kind: "thread",
      },
    },
  },
  closeMissing: {
    kind: "error",
    error: {
      kind: "error",
      code: "not_found",
      message: 'No visible thread matches "nope-thread" in this workspace.',
      next_action:
        "Call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value or a unique name it returned.",
      details: {
        kind: "thread",
      },
    },
  },
  renameMissing: {
    kind: "error",
    error: {
      kind: "error",
      code: "not_found",
      message: 'No visible thread matches "nope-thread" in this workspace.',
      next_action:
        "Call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value or a unique name it returned.",
      details: {
        kind: "thread",
      },
    },
  },
  setModelMissing: {
    kind: "error",
    error: {
      kind: "error",
      code: "not_found",
      message: 'No visible thread matches "nope-thread" in this workspace.',
      next_action:
        "Call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value or a unique name it returned.",
      details: {
        kind: "thread",
      },
    },
  },
  interruptBogus: {
    kind: "error",
    error: {
      code: "invalid_arguments",
      message: 'This tool takes no field "bogus" Nothing was done.',
      next_action: 'Call the tool again without "bogus"; it takes: thread, turn_id, all_scope, idempotency_key.',
      details: {
        field: "bogus",
        accepted: ["thread", "turn_id", "all_scope", "idempotency_key"],
      },
    },
  },
} as const

test("#given a script with no session of its own and an unknown thread #when each control is called #then every answer equals the shipped one, nested fields and key order included", async () => {
  const unused = async (): Promise<never> => {
    throw new Error("not used")
  }
  const host: ThreadHost = {
    socket: "/tmp/capture-legacy.sock",
    listSessions: async () => [],
    listView: async () => ({ sessions: [], hosts: [], disk: [] }),
    openSession: unused,
    getMessages: unused,
    getState: unused,
    prompt: unused,
    interrupt: unused,
    setSessionName: unused,
    setModel: unused,
    getAvailableModels: unused,
    setThinkingLevel: unused,
    getAvailableThinkingLevels: unused,
    gateway: { wake: async () => ({ admitted: [] }), releaseSession: unused },
  }
  const agentDir = mkdtempSync(join(tmpdir(), "capture-controls-"))
  const store = createGatewayStore({ agentDir })
  const sdk = createThreadSdk({
    agentDir,
    cwd: process.cwd(),
    uid: 501,
    user: "qa-user",
    host,
    store,
    firstPromptWaitMs: 0,
  })
  const answers = {
    interrupt: await sdk.interrupt({ thread: "self" }),
    closeSelf: await sdk.close({ thread: "self" }),
    closeDefault: await sdk.close({}),
    renameSelf: await sdk.rename({ thread: "self", name: "mine" }),
    renameDefault: await sdk.rename({ name: "mine" }),
    setModel: await sdk.set_model({ thread: "self", model: "opus" }),
    interruptMissing: await sdk.interrupt({ thread: "nope-thread" }),
    closeMissing: await sdk.close({ thread: "nope-thread" }),
    renameMissing: await sdk.rename({ thread: "nope-thread", name: "mine" }),
    setModelMissing: await sdk.set_model({ thread: "nope-thread", model: "opus" }),
    interruptBogus: await sdk.interrupt({ thread: "self", bogus: 1 } as never),
  }
  await sdk.dispose()
  await store.dispose()
  rmSync(agentDir, { recursive: true, force: true })
  expect(JSON.stringify(answers)).toBe(JSON.stringify(SHIPPED))
})
