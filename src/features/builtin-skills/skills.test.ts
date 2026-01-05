import { describe, test, expect } from "bun:test";
import { createBuiltinSkills } from "./skills";

describe("createBuiltinSkills", () => {
  test("returns array of builtin skills", () => {
    const skills = createBuiltinSkills();
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);
  });

  test("includes playwright skill", () => {
    const skills = createBuiltinSkills();
    const playwright = skills.find((s) => s.name === "playwright");

    expect(playwright).toBeDefined();
    expect(playwright?.description).toContain("Browser automation");
    expect(playwright?.mcpConfig).toBeDefined();
    expect(playwright?.mcpConfig?.playwright).toBeDefined();
  });

  test("includes continuity_ledger skill", () => {
    const skills = createBuiltinSkills();
    const ledger = skills.find((s) => s.name === "continuity_ledger");

    expect(ledger).toBeDefined();
    expect(ledger?.description).toContain("continuity ledger");
    expect(ledger?.template).toContain("## Goal");
    expect(ledger?.template).toContain("## State");
    expect(ledger?.template).toContain("## Working Set");
  });

  test("includes create_handoff skill", () => {
    const skills = createBuiltinSkills();
    const handoff = skills.find((s) => s.name === "create_handoff");

    expect(handoff).toBeDefined();
    expect(handoff?.description).toContain("handoff document");
    expect(handoff?.template).toContain("Current State");
    expect(handoff?.template).toContain("Next Steps");
    expect(handoff?.template).toContain("Files Modified");
  });

  test("includes resume_handoff skill", () => {
    const skills = createBuiltinSkills();
    const resume = skills.find((s) => s.name === "resume_handoff");

    expect(resume).toBeDefined();
    expect(resume?.description).toContain("restore context");
    expect(resume?.template).toContain("Locate Handoff");
    expect(resume?.template).toContain("Parse and Validate");
    expect(resume?.template).toContain("Report to User");
  });

  test("all skills have required fields", () => {
    const skills = createBuiltinSkills();

    for (const skill of skills) {
      expect(skill.name).toBeDefined();
      expect(skill.name.length).toBeGreaterThan(0);
      expect(skill.description).toBeDefined();
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.template).toBeDefined();
      expect(skill.template.length).toBeGreaterThan(0);
    }
  });

  test("continuity skills follow expected structure", () => {
    const skills = createBuiltinSkills();
    const continuitySkills = skills.filter((s) =>
      ["continuity_ledger", "create_handoff", "resume_handoff"].includes(
        s.name,
      ),
    );

    expect(continuitySkills.length).toBe(3);

    for (const skill of continuitySkills) {
      expect(skill.template).toContain("#");
      expect(skill.template).toContain("##");
    }
  });
});
