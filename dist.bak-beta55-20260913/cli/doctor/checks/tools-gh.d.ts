import { spawnWithTimeout } from "../framework/spawn-with-timeout";
import { bunWhich } from "../../../shared/bun-which-shim";
export interface GhCliInfo {
    installed: boolean;
    version: string | null;
    path: string | null;
    authenticated: boolean;
    username: string | null;
    scopes: string[];
    error: string | null;
}
type GhCliDependencies = {
    readonly which?: typeof bunWhich;
    readonly spawn?: typeof spawnWithTimeout;
};
export declare function getGhCliInfo(dependencies?: GhCliDependencies): Promise<GhCliInfo>;
export {};
