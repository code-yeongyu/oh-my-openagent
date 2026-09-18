import { __getProcessCleanupSignalListenerForTesting } from "./process-cleanup";
type ProcessCleanupEvent = NodeJS.Signals | "beforeExit" | "exit" | "uncaughtException" | "unhandledRejection";
type ProcessCleanupSignal = Parameters<typeof __getProcessCleanupSignalListenerForTesting>[0];
export declare function getRegisteredProcessCleanupSignalListener(signal: ProcessCleanupSignal): () => void;
export declare function getNewListener(signal: ProcessCleanupEvent, existingListeners: Function[]): () => void;
export declare function flushMicrotasks(): Promise<void>;
export {};
