export const BUILD_FIX_TEMPLATE = `
# /build-fix Command

## Purpose
Incrementally fix TypeScript build errors.

## Instructions
1. Run \`bun run build\` to get initial errors
2. Parse error output to extract:
   - File path
   - Line number
   - Error message
   - Error code (TS####)
3. Group errors by file
4. For each file:
   - Read file content
   - Analyze errors in context
   - Apply fixes
   - Run \`lsp_diagnostics\` to verify
5. Repeat until no errors or max iterations

## Usage
/build-fix                    # Fix all build errors
/build-fix --max-iterations 5 # Limit iterations
/build-fix --file src/foo.ts  # Fix specific file

## Loop Protection
- Max 10 iterations by default
- Stop if same error persists 3 times
- Report unfixable errors at end
`
