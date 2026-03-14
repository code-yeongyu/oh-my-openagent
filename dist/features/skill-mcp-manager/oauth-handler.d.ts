import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types";
import { McpOAuthProvider } from "../mcp-oauth/provider";
export declare function getOrCreateAuthProvider(authProviders: Map<string, McpOAuthProvider>, serverUrl: string, oauth: NonNullable<ClaudeCodeMcpServer["oauth"]>): McpOAuthProvider;
export declare function buildHttpRequestInit(config: ClaudeCodeMcpServer, authProviders: Map<string, McpOAuthProvider>): Promise<RequestInit | undefined>;
export declare function handleStepUpIfNeeded(params: {
    error: Error;
    config: ClaudeCodeMcpServer;
    authProviders: Map<string, McpOAuthProvider>;
}): Promise<boolean>;
