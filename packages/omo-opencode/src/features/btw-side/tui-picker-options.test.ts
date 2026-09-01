import { describe, expect, it } from "bun:test"

import { buildBtwPickerOptions } from "./tui-picker-options"
import type { BtwSessionCatalog } from "./tui-session-catalog"

describe("buildBtwPickerOptions", () => {
  it("#given retained sides #when options build #then Main stable numbers summaries and New BTW are distinct", () => {
    // given
    const catalog: BtwSessionCatalog = {
      main: {
        id: "ses_parent",
        title: "Main implementation",
        time: {
          created: 1,
          updated: 10,
        },
      },
      sides: [
        {
          id: "ses_side_1",
          title: "BTW · first retained question",
          time: {
            created: 2,
            updated: 20,
          },
        },
        {
          id: "ses_side_2",
          title: "BTW · second retained question",
          time: {
            created: 3,
            updated: 30,
          },
        },
      ],
    }

    // when
    const result = buildBtwPickerOptions(catalog, "ses_side_2")

    // then
    expect(result.options.map((option) => option.title)).toEqual([
      "Main · Main implementation",
      "BTW #1 · first retained question",
      "BTW #2 · second retained question",
      "New BTW",
    ])
    expect(result.options.map((option) => option.category)).toEqual([
      "Main conversation",
      "Retained BTW sessions",
      "Retained BTW sessions",
      "Actions",
    ])
    expect(result.current).toBe("session:ses_side_2")
  })

  it("#given untitled rows #when options build #then readable fallbacks replace empty labels", () => {
    // given
    const catalog: BtwSessionCatalog = {
      main: {
        id: "ses_parent",
        title: "",
        time: {
          created: 1,
          updated: 1,
        },
      },
      sides: [
        {
          id: "ses_side",
          title: "BTW · ",
          time: {
            created: 2,
            updated: 2,
          },
        },
      ],
    }

    // when
    const result = buildBtwPickerOptions(catalog, "ses_parent")

    // then
    expect(result.options[0]?.title).toBe("Main · Untitled conversation")
    expect(result.options[1]?.title).toBe("BTW #1 · Untitled side")
  })

  it("#given no retained sides #when options build #then an explanatory disabled row points to New BTW", () => {
    // given
    const catalog: BtwSessionCatalog = {
      main: {
        id: "ses_parent",
        title: "Main",
        time: {
          created: 1,
          updated: 1,
        },
      },
      sides: [],
    }

    // when
    const result = buildBtwPickerOptions(catalog, "ses_parent")

    // then
    expect(result.options).toEqual([
      expect.objectContaining({
        title: "Main · Main",
      }),
      expect.objectContaining({
        title: "No retained BTW sessions yet",
        disabled: true,
      }),
      expect.objectContaining({
        title: "New BTW",
      }),
    ])
  })
})
