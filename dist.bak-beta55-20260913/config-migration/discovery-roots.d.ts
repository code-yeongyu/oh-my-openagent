import type { ConfigMigrationDiscoveryOptions } from "./types";
export type ConfigRoot = {
    readonly activeProfile?: string;
    readonly path: string;
    readonly precedence: number;
};
export declare function configRoots(options: ConfigMigrationDiscoveryOptions): readonly ConfigRoot[];
