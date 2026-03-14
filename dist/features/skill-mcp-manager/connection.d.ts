import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types";
import type { SkillMcpClientInfo, SkillMcpManagerState } from "./types";
export declare function getOrCreateClient(params: {
    state: SkillMcpManagerState;
    clientKey: string;
    info: SkillMcpClientInfo;
    config: ClaudeCodeMcpServer;
}): Promise<Client>;
export declare function getOrCreateClientWithRetryImpl(params: {
    state: SkillMcpManagerState;
    clientKey: string;
    info: SkillMcpClientInfo;
    config: ClaudeCodeMcpServer;
}): Promise<Client>;
