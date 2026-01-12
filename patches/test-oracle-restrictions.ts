// Test Oracle Agent Restrictions
import { createOracleAgent } from "../src/agents/oracle";

console.log("=== Oracle Agent Restrictions Test ===\n");

// Create Oracle agent
const oracleAgent = createOracleAgent();

console.log("1. Agent created:", !!oracleAgent);
console.log("2. Agent model:", oracleAgent.model);
console.log("3. Agent mode:", oracleAgent.mode);
console.log("4. Agent has restrictions:", !!oracleAgent.permission || !!oracleAgent.tools);

// Check restrictions
if (oracleAgent.permission) {
  console.log("\n5. New permission format detected:");
  const permission = oracleAgent.permission as Record<string, string>;
  console.log("   - write:", permission.write);
  console.log("   - edit:", permission.edit);
  console.log("   - task:", permission.task);
  console.log("   - background_task:", permission.background_task);
} else if (oracleAgent.tools) {
  console.log("\n5. Old tools format detected:");
  const tools = oracleAgent.tools as Record<string, boolean>;
  console.log("   - write:", tools.write);
  console.log("   - edit:", tools.edit);
  console.log("   - task:", tools.task);
  console.log("   - background_task:", tools.background_task);
} else {
  console.log("\n5. No restrictions detected! This is a problem.");
}

console.log("\n6. Checking prompt contains restrictions:");
const prompt = oracleAgent.prompt as string;
const hasRestrictions = prompt.includes("PROHIBITED") && prompt.includes("Agent Responsibility Restrictions");
console.log("   - Has restrictions section:", hasRestrictions);
console.log("   - Prompt length:", prompt.length);

// Verify denied tools
const hasDeniedTools =
  prompt.includes("Do NOT write") &&
  prompt.includes("Do NOT use write()") &&
  prompt.includes("Do NOT use bash()");

console.log("\n7. Prompt denies implementation tools:", hasDeniedTools);
console.log();

console.log("=== Test Complete ===");
