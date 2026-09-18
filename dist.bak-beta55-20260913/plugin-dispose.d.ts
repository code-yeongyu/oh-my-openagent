export type PluginDispose = () => Promise<void>;
export declare function createPluginDispose(args: {
    backgroundManager: {
        shutdown: () => void | Promise<void>;
    };
    skillMcpManager: {
        disconnectAll: () => Promise<void>;
    };
    tuiStateMirror?: {
        stop: () => void;
    };
    disposeHooks: () => void;
}): PluginDispose;
