import { describe, expect, test } from "bun:test"

import { FavoriteModelsSelectorComponent } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/components/favorite-models-selector.js"
import { InteractiveMode } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/interactive-mode.js"
import { initTheme } from "../node_modules/@code-yeongyu/senpi/dist/modes/interactive/theme/theme.js"
import { stripAnsi } from "../node_modules/@code-yeongyu/senpi/dist/utils/ansi.js"

describe("patched Senpi TUI regressions", () => {
  test("favorite model rows stay on one line in a narrow terminal", () => {
    initTheme("dark")
    const selector = new FavoriteModelsSelectorComponent(
      {
        allModels: [
          {
            provider: "openai-codex",
            id: "gpt-5.6-extraordinarily-long-favorite-model",
            name: "Long",
            reasoning: true,
          },
        ],
        favoriteModelIds: ["openai-codex/gpt-5.6-extraordinarily-long-favorite-model"],
      },
      {
        onChange() {},
        onPersist() {},
        onCancel() {},
        onSelect() {},
      },
    )

    const selectedRow = selector
      .render(36)
      .map(stripAnsi)
      .find((line) => line.includes("→ *"))

    expect(selectedRow).toContain("gpt-5.6")
  })

  test("thinking-level status waits for the asynchronous session result", async () => {
    const statuses: string[] = []
    const mode = {
      session: { cycleThinkingLevel: async () => "high" },
      showStatus: (value: string) => statuses.push(value),
      footer: { invalidate() {} },
      updateEditorBorderColor() {},
    }

    await InteractiveMode.prototype.cycleThinkingLevel.call(mode)

    expect(statuses).toEqual(["Thinking level: high"])
  })
})
