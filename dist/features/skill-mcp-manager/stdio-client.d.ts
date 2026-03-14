import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { SkillMcpClientConnectionParams } from "./types";
export declare function createStdioClient(params: SkillMcpClientConnectionParams): Promise<Client>;
