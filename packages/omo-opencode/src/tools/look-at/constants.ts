export const MULTIMODAL_LOOKER_AGENT = "multimodal-looker" as const

export const LOOK_AT_DESCRIPTION = `Extract basic information from media files (PDFs, images, diagrams) when a quick summary suffices over precise reading. Good for simple text-based content extraction without using the Read tool. NEVER use for visual precision, aesthetic evaluation, or exact accuracy - use Read tool instead for those cases.`

export const LOOK_AT_PROVIDER_DESCRIPTION = ` Pass provider ("openai" or "anthropic") to run on that provider's configured multimodal-looker model instead of default routing; the call fails if none is configured for it.`
