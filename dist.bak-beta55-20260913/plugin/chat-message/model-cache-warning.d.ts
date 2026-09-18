type TuiClient = {
    readonly showToast: (input: {
        readonly body: {
            readonly title: string;
            readonly message: string;
            readonly variant: "warning";
            readonly duration: number;
        };
    }) => Promise<unknown>;
};
export declare function notifyWhenModelCacheIsMissing(tui: TuiClient): void;
export {};
