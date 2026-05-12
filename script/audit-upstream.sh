#!/bin/bash

# [PID-SENTINEL] Sovereign Upstream Audit Script
# Purpose: Prevent leakage of personal/architectural documentation to public upstream.

BASE_BRANCH=${1:-"upstream/dev"}
FORBIDDEN_PATTERNS=(
    "docs/process/sentinel-log.md"
    "docs/superpowers/specs/"
    ".sisyphus/"
    "implementation_plan.md"
    ".gemini/"
    "graphify-out/"
    "task.md"
    "walkthrough.md"
)

echo "🛡️  Iniciando Auditoria Soberana contra $BASE_BRANCH..."

# Get list of changed files
CHANGED_FILES=$(git diff "$BASE_BRANCH"...HEAD --name-only)

if [ -z "$CHANGED_FILES" ]; then
    echo "✅ Nenhuma mudança detectada em relação a $BASE_BRANCH."
    exit 0
fi

FOUND_LEAKS=()

for FILE in $CHANGED_FILES; do
    for PATTERN in "${FORBIDDEN_PATTERNS[@]}"; do
        if [[ "$FILE" == *"$PATTERN"* ]]; then
            FOUND_LEAKS+=("$FILE")
            break
        fi
    done
done

if [ ${#FOUND_LEAKS[@]} -gt 0 ]; then
    echo "❌ ALERTA DE VAZAMENTO DETECTADO!"
    echo "Os seguintes arquivos soberanos foram encontrados na sua branch:"
    for LEAK in "${FOUND_LEAKS[@]}"; do
        echo "  - $LEAK"
    done
    echo ""
    echo "⚠️  Abortando push. Remova estes arquivos da sua branch antes de prosseguir para o upstream."
    exit 1
else
    echo "✅ Auditoria concluída. Nenhum arquivo proibido encontrado."
    exit 0
fi
