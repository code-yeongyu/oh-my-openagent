type TimerHandleWithOptionalUnref = ReturnType<typeof setTimeout> & {
    readonly unref?: () => unknown;
};
export declare function unrefTimerHandle(handle: TimerHandleWithOptionalUnref): void;
export {};
