export interface DeepgramSttConfig {
  apiKey: string;
  model?: "nova-3";
  language?: "multi" | "it" | "en";
  endpointingMs?: number;
  sampleRate?: number;
  encoding?: "linear16" | "opus" | "mulaw";
}
