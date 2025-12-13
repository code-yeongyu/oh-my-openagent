export const MULTIMODAL_LOOKER_AGENT = "multimodal-looker" as const

export const LOOK_AT_DESCRIPTION = `Analyze media files (PDFs, images, diagrams) that require visual interpretation.

Use this tool to extract specific information from files that cannot be processed as plain text:
- PDF documents: extract text, tables, structure, specific sections
- Images: describe layouts, UI elements, text content, diagrams
- Charts/Graphs: explain data, trends, relationships
- Screenshots: identify UI components, text, visual elements
- Architecture diagrams: explain flows, connections, components

Parameters:
- file_path: Absolute path to the file to analyze
- goal: What specific information to extract (be specific for better results)

Examples:
- "Extract all API endpoints from this OpenAPI spec PDF"
- "Describe the UI layout and components in this screenshot"
- "Explain the data flow in this architecture diagram"
- "List all table data from page 3 of this PDF"

This tool uses a separate context window with Gemini 2.5 Flash for multimodal analysis,
saving tokens in the main conversation while providing accurate visual interpretation.`
