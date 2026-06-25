export interface CartesiaTtsConfig {
  apiKey: string;
  model?: "sonic-3" | "sonic";
  voice: string;
  language?: "it" | "en";
  container?: "raw" | "mp3" | "wav";
  encoding?: "pcm_f32le" | "pcm_s16le";
  sampleRate?: number;
}

export type ClauseBoundary = "sentence-end" | "comma-pause";
