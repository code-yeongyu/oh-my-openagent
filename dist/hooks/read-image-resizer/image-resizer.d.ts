import type { ImageDimensions, ResizeResult } from "./types";
export declare function calculateTargetDimensions(width: number, height: number, maxLongEdge?: number): ImageDimensions | null;
export declare function resizeImage(base64DataUrl: string, mimeType: string, target: ImageDimensions): Promise<ResizeResult | null>;
