import type { ModelCapabilitiesSnapshotEntry } from "./types"

// All Moonshot Kimi reasoning models (k2.6, k2-thinking, k2-thinking-turbo,
// k2.5-free, k2-5) reject any `temperature` other than 1 with the OpenAI
// o-series-style error: `invalid temperature: only 1 is allowed for this
// model`. The bundled `model-capabilities.generated.json` snapshot inherits
// `temperature: true` for these from upstream `anomalyco/models.dev`, which
// is wrong for reasoning models. Until that's fixed upstream (#4717 has been
// blocking the snapshot refresh for 10+ weeks, so a fix there can't reach
// users), we override here so the capability resolver returns
// `supportsTemperature: false` and the chat-params layer strips temperature
// before the request hits Moonshot.
export const SUPPLEMENTAL_MODEL_CAPABILITIES: Record<string, ModelCapabilitiesSnapshotEntry> = {
	"kimi-k2.6": {
		id: "kimi-k2.6",
		family: "kimi",
		reasoning: true,
		temperature: false,
		toolCall: true,
		modalities: {
			input: ["text", "image", "video"],
			output: ["text"],
		},
		limit: {
			context: 262144,
			output: 262144,
		},
	},
	"kimi-k2-thinking": {
		id: "kimi-k2-thinking",
		family: "kimi-thinking",
		reasoning: true,
		temperature: false,
		toolCall: true,
		modalities: {
			input: ["text"],
			output: ["text"],
		},
		limit: {
			context: 262144,
			output: 262144,
		},
	},
	"kimi-k2-thinking-turbo": {
		id: "kimi-k2-thinking-turbo",
		family: "kimi-thinking",
		reasoning: true,
		temperature: false,
		toolCall: true,
		modalities: {
			input: ["text"],
			output: ["text"],
		},
		limit: {
			context: 262144,
			output: 262144,
		},
	},
	"kimi-k2.5-free": {
		id: "kimi-k2.5-free",
		family: "kimi-free",
		reasoning: true,
		temperature: false,
		toolCall: true,
		modalities: {
			input: ["text", "image", "video"],
			output: ["text"],
		},
		limit: {
			context: 262144,
			output: 262144,
		},
	},
	"kimi-k2-5": {
		id: "kimi-k2-5",
		family: "kimi",
		reasoning: true,
		temperature: false,
		toolCall: true,
		modalities: {
			input: ["text", "image"],
			output: ["text"],
		},
		limit: {
			context: 256000,
			output: 65536,
		},
	},
	"gpt-5.5": {
		id: "gpt-5.5",
		family: "gpt",
		reasoning: true,
		temperature: false,
		toolCall: true,
		modalities: {
			input: ["text", "image", "pdf"],
			output: ["text"],
		},
		limit: {
			context: 400000,
			input: 272000,
			output: 128000,
		},
	},
	"gpt-5.4-mini-fast": {
		id: "gpt-5.4-mini-fast",
		family: "gpt-mini",
		reasoning: true,
		temperature: false,
		toolCall: true,
		modalities: {
			input: ["text", "image"],
			output: ["text"],
		},
		limit: {
			context: 400000,
			input: 272000,
			output: 128000,
		},
	},
}
