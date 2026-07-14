#!/bin/bash
# Analyze WordPress container logs for errors, attacks, issues
# Usage: ./analyze-logs.sh <domain>

DOMAIN="${1:?ERROR: Domain required}"
CONTAINER="wp-${DOMAIN}"
REPORT="${HOME}/hermes/projects/${DOMAIN}/monitoring/error-analysis-$(date +%Y%m%d).txt"

echo "=== Error Analysis for ${DOMAIN} — $(date) ===" > "${REPORT}"

echo -e "\n--- PHP Errors (last 100 lines) ---" >> "${REPORT}"
docker logs --tail=100 "${CONTAINER}" 2>&1 | grep -i "error\|fatal\|warning" >> "${REPORT}" || echo "None" >> "${REPORT}"

echo -e "\n--- WP Debug Log ---" >> "${REPORT}"
docker exec "${CONTAINER}" cat /var/www/html/wp-content/debug.log 2>/dev/null | tail -50 >> "${REPORT}" || echo "No debug log" >> "${REPORT}"

echo -e "\n--- Top IPs (access log) ---" >> "${REPORT}"
docker exec "${CONTAINER}" tail -1000 /var/log/apache2/access.log 2>/dev/null | \
  awk '{print $1}' | sort | uniq -c | sort -rn | head -10 >> "${REPORT}" || true

echo -e "\n--- Brute force check (wp-login.php) ---" >> "${REPORT}"
docker exec "${CONTAINER}" tail -1000 /var/log/apache2/access.log 2>/dev/null | \
  grep "wp-login.php" | awk '{print $1}' | sort | uniq -c | sort -rn | head -10 >> "${REPORT}" || echo "No login attempts" >> "${REPORT}"

echo "Report: ${REPORT}"
