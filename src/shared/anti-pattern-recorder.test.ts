import { describe, it, expect, beforeEach } from "bun:test";
import { AntiPatternRecorder } from "./anti-pattern-recorder";

describe("AntiPatternRecorder", () => {
  let recorder: AntiPatternRecorder;

  beforeEach(() => {
    recorder = new AntiPatternRecorder();
  });

  it("should record failed solution attempt", () => {
    //#given
    const attempt = "Using regex to parse HTML";
    const reason = "Regex is not suitable for nested structures";

    //#when
    recorder.recordFailure(attempt, reason);

    //#then
    const patterns = recorder.getFailures();
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toEqual({ attempt, reason });
  });

  it("should preserve failure patterns during compression", () => {
    //#given
    recorder.recordFailure("Attempt 1", "Reason 1");
    recorder.recordFailure("Attempt 2", "Reason 2");

    //#when
    const summary = recorder.summarizeForCompression();

    //#then
    expect(summary).toContain("Attempt 1: Reason 1");
    expect(summary).toContain("Attempt 2: Reason 2");
    expect(recorder.getFailures()).toHaveLength(2);
  });

  it("should inject patterns into next context", () => {
    //#given
    recorder.recordFailure("Old approach", "Didn't work because X");

    //#when
    const prompt = recorder.injectIntoPrompt("Try to solve Y");

    //#then
    expect(prompt).toContain("Avoid these failed approaches:");
    expect(prompt).toContain("Old approach: Didn't work because X");
    expect(prompt).toContain("Try to solve Y");
  });

  it("should limit to 10 recent failures", () => {
    //#given
    for (let i = 1; i <= 15; i++) {
      recorder.recordFailure(`Attempt ${i}`, `Reason ${i}`);
    }

    //#when
    const patterns = recorder.getFailures();

    //#then
    expect(patterns).toHaveLength(10);
    expect(patterns[0].attempt).toBe("Attempt 6");
    expect(patterns[9].attempt).toBe("Attempt 15");
  });
});
