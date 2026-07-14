#!/bin/bash
# CI/CD Theme Deployment Hook
# Pulls latest theme from Git and syncs to WordPress container
# Usage: ./deploy-theme.sh <domain> [theme-name]

DOMAIN="${1:?ERROR: Domain required}"
THEME="${2:-${THEME_NAME}}"
PROJECT_DIR="${HOME}/hermes/projects/${DOMAIN}"

if [ -z "${THEME}" ]; then
    echo "ERROR: THEME_NAME not set. Pass as second arg or set env."
    exit 1
fi

THEME_DIR="${PROJECT_DIR}/wp-content/themes/${THEME}"

if [ -d "${THEME_DIR}/.git" ]; then
    cd "${THEME_DIR}"
    git pull origin main
    echo "Git pull complete for ${THEME}"
fi

# Build blocks if present
BLOCKS_DIR="${PROJECT_DIR}/${THEME}-blocks"
if [ -d "${BLOCKS_DIR}" ]; then
    cd "${BLOCKS_DIR}"
    npm run build 2>/dev/null && echo "Blocks rebuilt" || echo "No blocks to build"
fi

# Sync to container
docker cp "${THEME_DIR}/." "wp-${DOMAIN}:/var/www/html/wp-content/themes/${THEME}/"
echo "Theme synced to container"

# Sync blocks plugin
if [ -d "${BLOCKS_DIR}/build" ]; then
    docker cp "${BLOCKS_DIR}/build/." "wp-${DOMAIN}:/var/www/html/wp-content/plugins/${THEME}-blocks/"
    echo "Blocks plugin synced"
fi

# Clear cache
if command -v dwp &>/dev/null; then
    dwp cache flush 2>/dev/null || true
    dwp rewrite flush 2>/dev/null || true
fi

echo "Theme deployed at $(date)"
