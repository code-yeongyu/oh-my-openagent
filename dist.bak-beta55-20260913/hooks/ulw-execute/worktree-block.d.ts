export declare function createWorktreeActiveBlock(worktreePath: string): string;
export interface PrDeliveryFlags {
    readonly makePr: boolean;
    readonly ship: boolean;
}
export declare function createPrDeliveryBlock(flags: PrDeliveryFlags, worktreePath: string | undefined): string;
