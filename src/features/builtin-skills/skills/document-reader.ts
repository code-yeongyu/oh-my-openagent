import type { BuiltinSkill } from "../types"

const DOCUMENT_READER_SKILL_NAME = "document-reader"

const DOCUMENT_READER_SKILL_DESCRIPTION =
  "Read and extract content from local or remote documents (PDF, DOCX, XLSX, PPTX, HTML, images). Use the document_reader MCP tool `convert_to_markdown` with a file: or https: URI. Triggers: 'read the PDF', 'analyze the document', 'extract from .docx', 'summarize the file', 'look at the spreadsheet'."

export const documentReaderSkill: BuiltinSkill = {
  name: DOCUMENT_READER_SKILL_NAME,
  description: DOCUMENT_READER_SKILL_DESCRIPTION,
  template: `# Document Reader Skill

Read and extract content from documents using the \`document_reader\` MCP (Microsoft MarkItDown).

## Supported Formats

| Format | Extensions |
|--------|-----------|
| PDF | .pdf |
| Word | .docx, .doc |
| Excel | .xlsx, .xls |
| PowerPoint | .pptx, .ppt |
| HTML | .html, .htm |
| Images | .jpg, .png, .gif, .webp |
| Text | .txt, .md, .csv, .json, .xml |
| Audio | .mp3, .wav (transcription) |

## Tool Usage

**Tool**: \`document_reader__convert_to_markdown\`
**Input**: \`uri\` — must be a \`file:\`, \`https:\`, \`http:\`, or \`data:\` URI

### Local files
\`\`\`
uri: "file:///absolute/path/to/document.pdf"
uri: "file:///home/user/report.docx"
\`\`\`

### Remote files
\`\`\`
uri: "https://example.com/paper.pdf"
uri: "https://example.com/data.xlsx"
\`\`\`

## MUST DO

- ALWAYS use absolute paths for local files (resolve relative paths first)
- Convert the returned Markdown to answer the user's question — do not dump the raw output unless asked
- For large documents, summarize key sections rather than returning everything
- If the file path is relative, resolve it against the current working directory before constructing the URI

## MUST NOT DO

- Do NOT guess file contents — always call \`convert_to_markdown\` first
- Do NOT use the Read tool for PDFs or Office files — it cannot parse binary formats
- Do NOT pass a relative path like \`file://./report.pdf\` — always use absolute paths
`,
}
