#!/bin/bash
# WordPress Health Check — monitors HTTP, SSL, containers, disk, WP API
# Usage: ./health-check.sh <domain>

DOMAIN="${1:?ERROR: Domain required}"
PROJECT_DIR="${HOME}/hermes/projects/${DOMAIN}"
DISCORD="${DISCORD_WEBHOOK_URL:-}"
LOGFILE="${PROJECT_DIR}/monitoring/health.log"
ALERT_COUNT="${PROJECT_DIR}/monitoring/alert_count"

touch "${ALERT_COUNT}"

check_http() {
    local url="https://${DOMAIN}/"
    local status=$(curl -sf -o /dev/null -w "%{http_code}" "${url}" 2>/dev/null || echo "000")
    local ttfb=$(curl -sf -o /dev/null -w "%{time_starttransfer}" "${url}" 2>/dev/null || echo "999")
    echo "HTTP_STATUS=${status}"
    echo "TTFB=${ttfb}"
    [ "${status}" != "200" ] && return 1
    (( $(echo "${ttfb} > 2.0" | bc -l 2>/dev/null || echo "0") )) && echo "SLOW_TTFB=${ttfb}" && return 2
    return 0
}

check_ssl() {
    local expiry=$(echo | openssl s_client -servername "${DOMAIN}" -connect "${DOMAIN}:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
    [ -z "${expiry}" ] && echo "SSL_STATUS=ERROR" && return 1
    local days=$(( ($(date -d "${expiry}" +%s) - $(date +%s)) / 86400 ))
    echo "SSL_DAYS=${days}" && echo "SSL_STATUS=OK"
    [ "${days}" -lt 7 ] && return 2
    return 0
}

check_container() {
    docker ps --format '{{.Names}}' | grep -q "^wp-${DOMAIN}$" && echo "CONTAINER_STATUS=UP" || { echo "CONTAINER_STATUS=DOWN"; return 1; }
    docker ps --format '{{.Names}}' | grep -q "^wp-db-${DOMAIN}$" && echo "DB_STATUS=UP" || { echo "DB_STATUS=DOWN"; return 1; }
    return 0
}

check_disk() {
    local usage=$(df "${PROJECT_DIR}" | tail -1 | awk '{print $5}' | tr -d '%')
    echo "DISK_USAGE=${usage}%"
    [ "${usage}" -gt 90 ] && return 2
    return 0
}

check_wp_api() {
    local api_status=$(curl -sf -o /dev/null -w "%{http_code}" "https://${DOMAIN}/wp-json/wp/v2/" 2>/dev/null || echo "000")
    echo "API_STATUS=${api_status}"
    [ "${api_status}" != "200" ] && return 2
    return 0
}

send_discord_alert() {
    [ -z "${DISCORD}" ] && return
    local color="${3:-3447003}"
    curl -sf "${DISCORD}" -H "Content-Type: application/json" \
      -d "{\"username\":\"WP Monitor\",\"embeds\":[{\"title\":\"WordPress Alert — ${DOMAIN}\",\"description\":\"$1\",\"color\":${color},\"timestamp\":\"$(date -Iseconds)\"}]}" > /dev/null 2>&1 || true
}

# Run checks
TIMESTAMP=$(date -Iseconds)
ERRORS=0; WARNINGS=0; REPORT="--- ${TIMESTAMP} ---\n"

check_http; rc=$?
[ $rc -eq 1 ] && ERRORS=$((ERRORS+1)) && REPORT+="  HTTP FAIL\n" && send_discord_alert "Site DOWN" 15158332
[ $rc -eq 2 ] && WARNINGS=$((WARNINGS+1)) && REPORT+="  Slow TTFB\n"

check_ssl; rc=$?
[ $rc -eq 1 ] && ERRORS=$((ERRORS+1)) && REPORT+="  SSL ERROR\n" && send_discord_alert "SSL error" 15158332
[ $rc -eq 2 ] && WARNINGS=$((WARNINGS+1)) && REPORT+="  SSL expiring\n" && send_discord_alert "SSL expiring < 7 days" 16776960

check_container; [ $? -ne 0 ] && ERRORS=$((ERRORS+1)) && REPORT+="  Container DOWN\n" && send_discord_alert "Container/Database DOWN" 15158332

check_disk; [ $? -eq 2 ] && WARNINGS=$((WARNINGS+1)) && REPORT+="  Disk > 90%\n" && send_discord_alert "Disk space critical" 16776960

check_wp_api; [ $? -eq 2 ] && WARNINGS=$((WARNINGS+1)) && REPORT+="  WP API down\n" && send_discord_alert "WP API not responding" 16776960

echo -e "${REPORT}" | tee -a "${LOGFILE}"
echo "Errors: ${ERRORS}, Warnings: ${WARNINGS}"

# Escalation
CURRENT=$(cat "${ALERT_COUNT}" 2>/dev/null || echo "0")
[ ${ERRORS} -gt 0 ] && echo $((CURRENT + 1)) > "${ALERT_COUNT}" || echo "0" > "${ALERT_COUNT}"
[ "$(cat "${ALERT_COUNT}")" -ge 3 ] && send_discord_alert "ESCALATION: 3 consecutive failures. Shiro needed." 15158332 && echo "0" > "${ALERT_COUNT}"

exit ${ERRORS}
