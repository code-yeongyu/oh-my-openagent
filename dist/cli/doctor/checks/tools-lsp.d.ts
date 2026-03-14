import type { LspServerInfo } from "../types";
export declare function getLspServersInfo(): LspServerInfo[];
export declare function getLspServerStats(servers: LspServerInfo[]): {
    installed: number;
    total: number;
};
