import { describe, expect, it } from "bun:test";
import { SlopDetector, type SlopConfig } from "./slop-detector";

describe("SlopDetector", () => {
  const defaultConfig: SlopConfig = {
    commentThreshold: 0.5, // 50% lines are comments
    verboseLengthThreshold: 500, // explanations over 500 chars
    repetitionThreshold: 0.3, // 30% lines are repetitive
    refreshInterval: 5,
    guidelines: "BE BRIEF. NO SLOP. FOLLOW THE RULES."
  };

  //#given
  const detector = new SlopDetector(defaultConfig);

  describe("detecting excessive comments", () => {
    it("should detect excessive comments as slop", () => {
      //#when
      const content = `
        // This is a comment
        // This is another comment
        // Too many comments
        const x = 1;
      `;
      const result = detector.detect(content, 1);

      //#then
      expect(result.isSlop).toBe(true);
      expect(result.reasons).toContain("excessive_comments");
      expect(result.injectedGuidelines).toContain(defaultConfig.guidelines);
    });
  });

  describe("detecting verbose explanations", () => {
    it("should detect verbose explanations as slop", () => {
      //#when
      const content = "A".repeat(600) + "\n```typescript\nconst x = 1;\n```";
      const result = detector.detect(content, 1);

      //#then
      expect(result.isSlop).toBe(true);
      expect(result.reasons).toContain("verbose_explanation");
    });
  });

  describe("detecting repetitive code", () => {
    it("should detect repetitive code as slop", () => {
      //#when
      const content = `
        const a = 1;
        const a = 1;
        const a = 1;
        const a = 1;
        const a = 1;
      `;
      const result = detector.detect(content, 1);

      //#then
      expect(result.isSlop).toBe(true);
      expect(result.reasons).toContain("repetitive_code");
    });
  });

  describe("periodic guideline anchoring", () => {
    it("should refresh guidelines every N rounds even without slop", () => {
      //#when
      const cleanContent = "const x = 1;";
      
      // Round 1 - No guidelines
      const result1 = detector.detect(cleanContent, 1);
      expect(result1.injectedGuidelines).toBeUndefined();

      // Round 5 - Should inject
      const result5 = detector.detect(cleanContent, 5);
      
      //#then
      expect(result5.injectedGuidelines).toBe(defaultConfig.guidelines);
    });
  });

  describe("sensitivity configuration", () => {
    it("should support custom thresholds", () => {
      //#given
      const strictDetector = new SlopDetector({
        ...defaultConfig,
        commentThreshold: 0.1
      });

      //#when
      const content = `
        // One comment
        const x = 1;
        const y = 2;
      `;
      const result = strictDetector.detect(content, 1);

      //#then
      expect(result.isSlop).toBe(true);
    });
  });
});
