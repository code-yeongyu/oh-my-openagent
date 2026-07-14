---
name: wp-deployment
description: "WordPress deployment and operations for KLC: Docker + Traefik stack, migration, Elementor, Gutenberg, SEO, monitoring, backup. ACTIVATES on explicit WordPress implementation tasks — deploy, migrate, configure, optimize, or maintain a KLC WordPress site."
---

# WordPress Deployment — KLC Operations

> Usage réservé à **Neo** (exécution) et **Morpheus** (supervision).
> Contient les commandes exactes pour déployer, migrer, et maintenir les sites WordPress KLC.

---

## 🚀 Deployment (Stack Complet)

### Pre-flight

```bash
DOMAIN="${WORDPRESS_DOMAIN:?ERROR: WORDPRESS_DOMAIN not set}"
DB_PASS="${WORDPRESS_DB_PASSWORD:?ERROR: WORDPRESS_DB_PASSWORD not set}"

# Verify Docker/Traefik running
docker ps | grep -q traefik || echo "ERROR: Traefik not running. Run infra first."

# Verify no collision
docker ps --format '{{.Names}}' | grep -q "wp-${DOMAIN}" \
  && echo "ERROR: Stack already exists for ${DOMAIN}" && exit 1

# Create project dir
PROJECT_DIR="${HOME}/projects/${DOMAIN}"
mkdir -p "${PROJECT_DIR}"
cd "${PROJECT_DIR}"
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  db:
    image: mariadb:10.11
    volumes:
      - db_data:/var/lib/mysql
    environment:
      MYSQL_ROOT_PASSWORD: ${WORDPRESS_DB_ROOT_PASSWORD}
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wpuser
      MYSQL_PASSWORD: ${WORDPRESS_DB_PASSWORD}
    restart: always
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "--silent"]
      interval: 10s
      timeout: 5s
      retries: 5

  wordpress:
    image: wordpress:6.7-php8.2-apache
    volumes:
      - wp_data:/var/www/html
      - ./uploads.ini:/usr/local/etc/php/conf.d/uploads.ini
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: wpuser
      WORDPRESS_DB_PASSWORD: ${WORDPRESS_DB_PASSWORD}
      WORDPRESS_DB_NAME: wordpress
      WORDPRESS_CONFIG_EXTRA: |
        define('WP_HOME','https://${DOMAIN}');
        define('WP_SITEURL','https://${DOMAIN}');
        define('WP_AUTO_UPDATE_CORE', false);
        define('DISALLOW_FILE_EDIT', true);
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.wp-${DOMAIN}.rule=Host(`${DOMAIN}`)"
      - "traefik.http.routers.wp-${DOMAIN}.entrypoints=websecure"
      - "traefik.http.routers.wp-${DOMAIN}.tls.certresolver=letsencrypt"
      - "traefik.http.services.wp-${DOMAIN}.loadbalancer.server.port=80"
    depends_on:
      db:
        condition: service_healthy
    restart: always

  wpcli:
    image: wordpress:cli-php8.2
    user: 33:33
    volumes:
      - wp_data:/var/www/html
    entrypoint: ["wp"]
    profiles: ["cli"]

volumes:
  db_data:
  wp_data:
```

### Post-Install WP-CLI

```bash
# Generate salts
curl -s https://api.wordpress.org/secret-key/1.1/salt/ > salts.txt

# Universal WP-CLI alias
dwp() { docker compose run --rm wpcli "$@"; }

# Install WordPress
dwp core install \
  --url="https://${DOMAIN}" \
  --title="${WORDPRESS_TITLE:-KL-Consulting Site}" \
  --admin_user="${WORDPRESS_ADMIN_USER:-admin_klc}" \
  --admin_password="${WORDPRESS_ADMIN_PASS:?ERROR}" \
  --admin_email="${WORDPRESS_ADMIN_EMAIL:-admin@klconsult.com}" \
  --skip-email

# Configure
dwp rewrite structure '/%postname%/' --hard
dwp plugin delete hello akismet 2>/dev/null || true
dwp option update blog_public 0
dwp theme install twentytwentyfive --activate 2>/dev/null || true

# Disable comments globally
dwp option update default_comment_status closed
dwp option update close_comments_for_old_posts 1
```

### uploads.ini

```ini
upload_max_filesize = 64M
post_max_size = 64M
max_execution_time = 300
max_input_time = 300
memory_limit = 256M
```

---

## 🔄 Migration (Hébergement Externe → KLC)

### Assessment Source

```bash
SOURCE="${SOURCE_DOMAIN:?ERROR}"
TARGET="${TARGET_DOMAIN:?ERROR}"
SSH_HOST="${SOURCE_SSH_HOST:?ERROR}"
SSH_USER="${SOURCE_SSH_USER:?ERROR}"
PROJECT_DIR="${HOME}/projects/${TARGET}"
mkdir -p "${PROJECT_DIR}/migration"

# Source assessment
ssh "${SSH_USER}@${SSH_HOST}" "
    wp core version --allow-root
    wp db size --allow-root
    du -sh wp-content/uploads/
    wp plugin list --status=active --fields=name,version --allow-root
    wp theme list --status=active --fields=name,version --allow-root
" > "${PROJECT_DIR}/migration/source-assessment.txt"
```

### Database Export

```bash
# Method A (preferred): WP-CLI
ssh "${SSH_USER}@${SSH_HOST}" "wp db export /tmp/db-export.sql --allow-root"
scp "${SSH_USER}@${SSH_HOST}:/tmp/db-export.sql" "${PROJECT_DIR}/migration/"
```

### Files Export

```bash
rsync -avz --progress \
  "${SSH_USER}@${SSH_HOST}:/var/www/html/wp-content/uploads/" \
  "${PROJECT_DIR}/migration/uploads/"
rsync -avz --progress \
  "${SSH_USER}@${SSH_HOST}:/var/www/html/wp-content/themes/" \
  "${PROJECT_DIR}/migration/themes/"
rsync -avz --progress \
  "${SSH_USER}@${SSH_HOST}:/var/www/html/wp-content/plugins/" \
  "${PROJECT_DIR}/migration/plugins/"
```

### Deploy Target + Import

1. Deploy target stack (see Deployment section above)
2. Import DB: `dwp db import "${PROJECT_DIR}/migration/db-export.sql"`
3. Copy uploads: `cp -r "${PROJECT_DIR}/migration/uploads/" "${PROJECT_DIR}/wp-content/"`
4. Copy themes/plugins as needed
5. Replace URLs: `dwp search-replace "${SOURCE}" "${TARGET}" --all-tables`
6. Regenerate permalinks: `dwp rewrite flush`
7. Verify: `dwp eval 'echo home_url();'`

### Rollback Plan
- Keep source stack running
- DNS rollback script ready: revert A record to source IP
- Keep source DB export as backup

---

## 🎨 Elementor

### Installation
```bash
dwp plugin install elementor --activate
# Elementor Pro (zip téléchargé du site elemetal)
dwp plugin install /path/to/elementor-pro.zip --activate
```

### Performance
```bash
# Local Google Fonts
dwp plugin install local-google-fonts --activate
# CSS minification
dwp option update elementor_css_print_method 'internal'
dwp option update elementor_optimized_css_loading 1
# Disponent unused widgets
dwp elementor library sync
```

### Security Hardening
```bash
# Disable editor access for non-admins
dwp role list --format=csv
dwp cap list 'editor' | grep -q edit_theme_options && \
  dwp cap remove 'editor' 'edit_theme_options'
```

---

## 🧩 Gutenberg / FSE Design System

### theme.json
```json
{
  "version": 2,
  "settings": {
    "color": {
      "palette": [
        { "slug": "klc-green", "name": "KLC Green", "color": "#1B4332" },
        { "slug": "klc-green-light", "name": "KLC Green Light", "color": "#2D6A4F" },
        { "slug": "klc-gold", "name": "KLC Gold", "color": "#FFB703" },
        { "slug": "klc-dark", "name": "KLC Dark", "color": "#0B1D18" },
        { "slug": "klc-white", "name": "KLC White", "color": "#F8FAF9" }
      ]
    },
    "typography": {
      "fontFamilies": [
        { "slug": "inter", "name": "Inter", "fontFamily": "'Inter', sans-serif" },
        { "slug": "jetbrains", "name": "JetBrains Mono", "fontFamily": "'JetBrains Mono', monospace" }
      ]
    }
  }
}
```

### Theme CI/CD
```bash
# deploy-theme.sh
rsync -avz --delete theme/ "${PROJECT_DIR}/wp-content/themes/klc-theme/"
dwp theme activate klc-theme
```

---

## 📊 Monitoring

### Health Check Script
```bash
#!/bin/bash
DOMAIN="$1"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}")
[ "${STATUS}" = "200" ] && echo "OK" || echo "DOWN: HTTP ${STATUS}"

# Check SSL expiry
SSL_EXPIRY=$(openssl s_client -connect "${DOMAIN}:443" -servername "${DOMAIN}" </dev/null 2>/dev/null \
  | openssl x509 -noout -enddate | cut -d= -f2)
DAYS_LEFT=$(($(date -d "${SSL_EXPIRY}" +%s) - $(date +%s)))
echo "SSL: $((${DAYS_LEFT} / 86400)) days left"

# Check container health
docker ps --filter "name=wp-${DOMAIN}" --format '{{.Status}}'
```

### Alert Priority Matrix

| Issue | Priority | Action |
|-------|----------|--------|
| Site down (HTTP ≠ 200) | Critical | Auto-restart + escalation |
| Container down | Critical | Auto-restart |
| SSL < 7 days | Warning | Notification |
| TTFB > 2s | Warning | Log for analysis |
| Disk > 90% | Warning | Cleanup |

---

## 🔍 SEO

### RankMath Setup
```bash
dwp plugin install seo-by-rank-math --activate
dwp option update rankmath_connect_config \
  '{"site_url":"'https://${DOMAIN}'","connection_id":"","token":"","status":"new"}'
```

### Yoast Alternative
```bash
dwp plugin install wordpress-seo --activate
```

### Post-Install SEO
```bash
dwp option update blog_public 1
dwp rewrite flush
dwp sitemap generate 2>/dev/null || true
```

---

## 🔷 Staging & Blue-Green

### Deploy Staging
```bash
export WORDPRESS_DOMAIN="staging.${DOMAIN}"
# Follow standard deployment workflow
```

### Prod → Staging Sync
```bash
dwp db export /tmp/prod-db.sql
wp_import_db /tmp/prod-db.sql
rsync -avz --delete wp-content/uploads/ "${STAGING_DIR}/wp-content/uploads/"
```

### Rollback
```bash
# DNS rollback
# composer down sur la stack cible
# composer up sur la stack précédente
```

---

## 🛡️ Règles KLC Non-Négociables

- **NEVER** install WordPress outside Docker
- **NEVER** run analytics/live-chat plugins on staging
- **ALWAYS** verify SSL on staging (Traefik handles auto)
- **ALWAYS** export DB before any modification
- **ALWAYS** keep staging noindex (`blog_public = 0`)
- **NEVER** sync staging → production DB
- **NEVER** install both Yoast and RankMath simultaneously
- **DEPLOY_REPORT.md** must exist before marking deployment complete
