export interface DecodedLine {
    text: string;
    rawText: string;
    truncated?: boolean;
    binary?: boolean;
}
export type LineStreamResult = {
    lines: DecodedLine[];
    binarySuppressedBytes: number;
};
export declare function stripAnsi(text: string): string;
export declare class LineStream {
    private readonly lineMaxBytes;
    private readonly binaryThreshold;
    private readonly decoder;
    private pending;
    private truncating;
    constructor(opts: {
        lineMaxBytes: number;
        binaryThreshold?: number;
    });
    feed(chunk: Uint8Array): LineStreamResult;
    flush(): LineStreamResult;
    private isBinaryChunk;
    private consumeChunk;
    private consumeBytes;
    private emitPendingLine;
    private createLine;
}
