export interface PngChunk {
    readonly type: string;
    readonly data: Buffer;
    readonly crc: Buffer;
}
export declare function readPngChunks(buffer: Buffer): PngChunk[];
