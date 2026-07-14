#!/bin/bash
# Auto-restart WordPress containers if site is down
# Usage: ./auto-restart.sh <domain>

DOMAIN="${1:?ERROR: Domain required}"
CONTAINER="wp-${DOMAIN}"
DB_CONTAINER="wp-db-${DOMAIN}"

if ! curl -sf "https://${DOMAIN}/" > /dev/null; then
    echo "$(date): ${DOMAIN} DOWN — attempting restart"
    docker restart "${DB_CONTAINER}" && sleep 5
    docker restart "${CONTAINER}" && sleep 10
    if curl -sf "https://${DOMAIN}/" > /dev/null; then
        echo "$(date): ${DOMAIN} recovered"
        [ -n "${DISCORD_WEBHOOK_URL:-}" ] && curl -sf "${DISCORD_WEBHOOK_URL}" \
          -H "Content-Type: application/json" \
          -d "{\"content\": \"✅ ${DOMAIN} recovered after auto-restart\"}" > /dev/null 2>&1 || true
    else
        echo "$(date): ${DOMAIN} still down — escalation needed"
    fi
fi
