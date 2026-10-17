import { describe, expect, it } from "bun:test"
import { declaredToolNames } from "./mock-provider/index.ts"

const tool = (name: string) => ({ name, description: name, parameters: {} })

describe("mock provider declared-tool recorder", () => {
  it("#given a context that carries tools only in transcript system messages #then it replays the deltas", () => {
    // Given the shape senpi's normalizeContext produces: no `tools`, declarations in system messages.
    const context = {
      messages: [
        { role: "system", content: "base", toolsAdded: [tool("computer"), tool("eval")] },
        { role: "user", content: "go" },
        { role: "system", content: "", toolsAdded: [tool("computer_actions")], toolsRemoved: [tool("eval")] },
      ],
    }

    // When the recorder reads it, Then it names the tools current after every delta, in insertion order.
    expect(declaredToolNames(context)).toEqual(["computer", "computer_actions"])
  })

  it("#given one system message that removes and re-adds a tool #then the tool stays declared", () => {
    expect(
      declaredToolNames({
        messages: [
          { role: "system", content: "base", toolsAdded: [tool("computer"), tool("eval")] },
          { role: "system", content: "", toolsRemoved: [tool("computer")], toolsAdded: [tool("computer")] },
        ],
      }),
    ).toEqual(["eval", "computer"])
  })

  it("#given a context with a direct tools list #then that list is the declaration", () => {
    expect(declaredToolNames({ tools: [tool("computer")], messages: [] })).toEqual(["computer"])
  })

  it("#given transcript system messages that declare no tools #then the declaration is an empty list", () => {
    expect(declaredToolNames({ messages: [{ role: "system", content: "base" }, { role: "user", content: "hi" }] })).toEqual([])
  })

  it("#given no tools list and no system message #then the declaration is unavailable, not empty", () => {
    expect(declaredToolNames({ messages: [{ role: "user", content: "hi" }] })).toBeNull()
    expect(declaredToolNames({})).toBeNull()
    expect(declaredToolNames({ tools: null as unknown as undefined })).toBeNull()
  })
})
