import { describe, expect, it } from "bun:test";

import { AGENTS_FILENAME } from "@oh-my-opencode/agents-md-core";

describe("agents-md-core constants", () => {
  it("#given the public package barrel #when AGENTS_FILENAME is imported #then the AGENTS.md contract is stable", () => {
    // given
    const expectedAgentsFilename = "AGENTS.md";

    // when
    const agentsFilename: "AGENTS.md" = AGENTS_FILENAME;

    // then
    expect(agentsFilename).toBe(expectedAgentsFilename);
  });
});
