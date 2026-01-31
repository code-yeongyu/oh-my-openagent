import { describe, it, expect, mock } from "bun:test";
import { CriticVerifier } from "./critic-verifier";

describe("CriticVerifier", () => {
  //#given: a critic verifier with medium strictness
  const verifier = new CriticVerifier({ strictness: "medium" });

  it("should call critic model for verification", async () => {
    //#when: verifying code
    const code = "const x = 1;";
    const result = await verifier.verify(code);

    //#then: it should return a verification result
    expect(result).toBeDefined();
    expect(typeof result.passed).toBe("boolean");
    expect(Array.isArray(result.issues)).toBe(true);
  });

  it("should perform semantic code review", async () => {
    //#given: code with semantic issues (e.g., potential memory leak or race condition)
    const code = `
      async function getData() {
        let data;
        fetch('/api').then(res => data = res);
        return data;
      }
    `;

    //#when: verifying the code
    const result = await verifier.verify(code);

    //#then: it should detect the semantic issue (returning data before fetch completes)
    // Note: In a real implementation, this would call an LLM. 
    // For TDD purposes, we expect the logic to handle semantic analysis.
    expect(result.passed).toBe(false);
    expect(result.issues.some((i: { message: string }) => i.message.toLowerCase().includes("async") || i.message.toLowerCase().includes("race"))).toBe(true);
  });

  it("should return specific issues on failure", async () => {
    //#given: code with multiple issues
    const code = "eval('console.log(1)'); var x = 1;";
    
    //#when: verifying
    const result = await verifier.verify(code);

    //#then: it should return specific issue details
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]).toHaveProperty("message");
    expect(result.issues[0]).toHaveProperty("type");
  });

  it("should respect strictness configuration", async () => {
    //#given: code with a minor warning (e.g., missing semicolon if that's a warning)
    const code = "const x = 1";
    
    //#when: verifying with low strictness
    const lowVerifier = new CriticVerifier({ strictness: "low" });
    const lowResult = await lowVerifier.verify(code);
    
    //#and: verifying with high strictness
    const highVerifier = new CriticVerifier({ strictness: "high" });
    const highResult = await highVerifier.verify(code);

    //#then: high strictness should be more likely to fail or return more issues
    if (!lowResult.passed && highResult.passed) {
      // This would be unexpected
      throw new Error("High strictness should not be more lenient than low strictness");
    }
    
    expect(highResult.issues.length).toBeGreaterThanOrEqual(lowResult.issues.length);
  });
});
