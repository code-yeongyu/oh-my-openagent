import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Prompt, Resource, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types";
import type { SkillMcpClientInfo, SkillMcpServerContext } from "./types";
export declare class SkillMcpManager {
    private readonly state;
    private getClientKey;
    getOrCreateClient(info: SkillMcpClientInfo, config: ClaudeCodeMcpServer): Promise<Client>;
    disconnectSession(sessionID: string): Promise<void>;
    disconnectAll(): Promise<void>;
    listTools(info: SkillMcpClientInfo, context: SkillMcpServerContext): Promise<Tool[]>;
    listResources(info: SkillMcpClientInfo, context: SkillMcpServerContext): Promise<Resource[]>;
    listPrompts(info: SkillMcpClientInfo, context: SkillMcpServerContext): Promise<Prompt[]>;
    callTool(info: SkillMcpClientInfo, context: SkillMcpServerContext, name: string, args: Record<string, unknown>): Promise<unknown>;
    readResource(info: SkillMcpClientInfo, context: SkillMcpServerContext, uri: string): Promise<unknown>;
    getPrompt(info: SkillMcpClientInfo, context: SkillMcpServerContext, name: string, args: Record<string, string>): Promise<unknown>;
    private withOperationRetry;
    private getOrCreateClientWithRetry;
    getConnectedServers(): string[];
    isConnected(info: SkillMcpClientInfo): boolean;
}
