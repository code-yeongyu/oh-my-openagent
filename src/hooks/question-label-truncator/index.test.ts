import { describe, it, expect } from "bun:test";
import { createQuestionLabelTruncatorHook } from "./index";

describe("createQuestionLabelTruncatorHook", () => {
  const hook = createQuestionLabelTruncatorHook();

  describe("tool.execute.before", () => {
    it("truncates labels exceeding 30 characters with ellipsis", async () => {
      // #given
      const longLabel = "This is a very long label that exceeds thirty characters";
      const input = { tool: "AskUserQuestion" };
      const output = {
        args: {
          questions: [
            {
              question: "Choose an option",
              options: [
                { label: longLabel, description: "A long option" },
              ],
            },
          ],
        },
      };

      // #when
      await hook["tool.execute.before"]?.(input as any, output as any);

      // #then
      const truncatedLabel = (output.args as any).questions[0].options[0].label;
      expect(truncatedLabel.length).toBeLessThanOrEqual(30);
      expect(truncatedLabel).toBe("This is a very long label t...");
      expect(truncatedLabel.endsWith("...")).toBe(true);
    });

    it("preserves labels within 30 characters", async () => {
      // #given
      const shortLabel = "Short label";
      const input = { tool: "AskUserQuestion" };
      const output = {
        args: {
          questions: [
            {
              question: "Choose an option",
              options: [
                { label: shortLabel, description: "A short option" },
              ],
            },
          ],
        },
      };

      // #when
      await hook["tool.execute.before"]?.(input as any, output as any);

      // #then
      const resultLabel = (output.args as any).questions[0].options[0].label;
      expect(resultLabel).toBe(shortLabel);
    });

    it("handles exactly 30 character labels without truncation", async () => {
      // #given
      const exactLabel = "Exactly thirty chars here!!!!!"; // 30 chars
      expect(exactLabel.length).toBe(30);
      const input = { tool: "ask_user_question" };
      const output = {
        args: {
          questions: [
            {
              question: "Choose",
              options: [{ label: exactLabel }],
            },
          ],
        },
      };

      // #when
      await hook["tool.execute.before"]?.(input as any, output as any);

      // #then
      const resultLabel = (output.args as any).questions[0].options[0].label;
      expect(resultLabel).toBe(exactLabel);
    });

    it("ignores non-AskUserQuestion tools", async () => {
      // #given
      const input = { tool: "Bash" };
      const output = {
        args: { command: "echo hello" },
      };
      const originalArgs = { ...output.args };

      // #when
      await hook["tool.execute.before"]?.(input as any, output as any);

      // #then
      expect(output.args).toEqual(originalArgs);
    });

    it("handles multiple questions with multiple options", async () => {
      // #given
      const input = { tool: "AskUserQuestion" };
      const output = {
        args: {
          questions: [
            {
              question: "Q1",
              options: [
                { label: "Very long label number one that needs truncation" },
                { label: "Short" },
              ],
            },
            {
              question: "Q2",
              options: [
                { label: "Another extremely long label for testing purposes" },
              ],
            },
          ],
        },
      };

      // #when
      await hook["tool.execute.before"]?.(input as any, output as any);

      // #then
      const q1opts = (output.args as any).questions[0].options;
      const q2opts = (output.args as any).questions[1].options;
      
      expect(q1opts[0].label).toBe("Very long label number one ...");
      expect(q1opts[0].label.length).toBeLessThanOrEqual(30);
      expect(q1opts[1].label).toBe("Short");
      expect(q2opts[0].label).toBe("Another extremely long labe...");
      expect(q2opts[0].label.length).toBeLessThanOrEqual(30);
    });
  });
});
