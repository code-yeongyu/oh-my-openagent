export interface PngIhdr {
    readonly width: number;
    readonly height: number;
    readonly bitDepth: number;
    readonly colorType: number;
    readonly compressionMethod: number;
    readonly filterMethod: number;
    readonly interlaceMethod: number;
}
export declare function parseIhdr(data: Buffer): PngIhdr | null;
export declare function getBytesPerPixel(colorType: number, bitDepth: number): number | null;
