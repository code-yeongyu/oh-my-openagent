FROM oven/bun:latest

WORKDIR /app

# Copy the entire monorepo
COPY . /app

# Install dependencies
RUN bun install

# Build the project
RUN bun run build

# Verify the modified file is included in the build
RUN grep -q "STOP_ERROR_NAMES: Set<string> = new Set(\[\])" /app/packages/model-core/src/model-error-classifier.ts
RUN grep -q "STOP_MESSAGE_PATTERNS: string\[\] = \[\]" /app/packages/model-core/src/model-error-classifier.ts

CMD ["echo", "Build successful. Quota/billing errors no longer block cross-provider fallback."]
