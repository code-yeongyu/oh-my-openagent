type MockModuleFactory = () => Record<string, unknown>;
type MockApi = {
    module: (specifier: string, factory: MockModuleFactory) => unknown;
    restore: () => unknown;
};
type ModuleLoadResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: Error;
};
type ModuleMockLifecycleOptions = {
    getCallerUrl?: () => string;
    resolveSpecifier?: (specifier: string, callerUrl: string) => string;
    loadOriginalModule?: (specifier: string, callerUrl: string) => ModuleLoadResult;
    shouldPreserveActiveMocksOnRestore?: () => boolean;
    registerGlobalRestore?: boolean;
};
export declare function normalizeStackPath(rawPath: string): string;
export declare function getCallerUrlFromStack(stack: string, fallbackUrl: string): string;
export declare function installModuleMockLifecycle(mockApi: MockApi, options?: ModuleMockLifecycleOptions): {
    preserveModuleMocksForTestFile: (callerUrl: string) => void;
    restoreModuleMocks: () => void;
    restoreModuleMocksForTestFile: (callerUrl: string) => void;
};
export declare function preserveModuleMocksForTestFile(callerUrl: string): void;
export declare function restoreModuleMocksForTestFile(callerUrl: string): void;
export {};
