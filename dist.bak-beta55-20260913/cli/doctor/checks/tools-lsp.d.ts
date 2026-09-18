type InstalledLspServersOptions = {
    readonly cwd?: string;
    readonly homeDir?: string;
};
export declare function getInstalledLspServers(options?: InstalledLspServersOptions): Array<{
    id: string;
    extensions: string[];
}>;
export {};
