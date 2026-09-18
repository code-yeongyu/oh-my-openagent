import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentFactory } from "./types";
import type { CategoriesConfig } from "../config/schema";
export type AgentSource = AgentFactory | AgentConfig;
export declare function isFactory(source: AgentSource): source is AgentFactory;
export declare function buildAgent(source: AgentSource, model: string, categories?: CategoriesConfig): AgentConfig;
