export const MULTIMODAL_LOOKER_AGENT = "multimodal-looker" as const

export const LOOK_AT_DESCRIPTION = `Analyze media files (PDFs, images, diagrams) that require visual interpretation.

Parameters:
- file_path: Absolute path to the file to analyze
- goal: What specific information to extract (be specific for better results)

This tool uses a separate context window with Gemini 2.5 Flash for multimodal analysis,
saving tokens in the main conversation while providing accurate visual interpretation.`
