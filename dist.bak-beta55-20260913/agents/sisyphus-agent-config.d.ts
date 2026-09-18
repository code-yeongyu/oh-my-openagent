import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode } from "./types";
export declare function buildGptSisyphusAgentConfig(mode: AgentMode, model: string, prompt: string): AgentConfig;
export declare function buildGlmSisyphusAgentConfig(mode: AgentMode, model: string, prompt: string): AgentConfig;
/**
 * Grok 4.5/4.6 are xAI reasoning models: they take a reasoning effort
 * (grok family caps allow low/medium/high) and reject Anthropic-style
 * thinking blocks, so this is the base config plus effort only.
 */
export declare function buildGrokSisyphusAgentConfig(mode: AgentMode, model: string, prompt: string): AgentConfig;
export declare function buildClaudeSisyphusAgentConfig(mode: AgentMode, model: string, prompt: string): AgentConfig;
