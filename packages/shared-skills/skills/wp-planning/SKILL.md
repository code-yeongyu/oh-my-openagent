---
name: wp-planning
description: "KLC WordPress domain knowledge for pre-planning. Docker + Traefik stack, migration assessment, architecture decisions, common pitfalls. ACTIVATES on any WordPress-related request — migration, deployment, design, maintenance, or infrastructure planning."
---

# WordPress Planning — KLC Pre-Planning Knowledge

> Usage réservé à **Keymaker** (pre-planning consultant).
> Ce skill fournit le contexte métier et technique WordPress KLC pour poser les bonnes questions avant toute implémentation.

---

## 🏗️ Architecture WordPress KLC

### Stack standard

Tous les sites WordPress KLC suivent cette architecture :

```
Stack:
  Base: Docker Compose v1.29.2 (docker-compose avec tiret)
  Reverse proxy: Traefik v3.6.15 (ports 80/8443, Let's Encrypt)
  Database: MariaDB 10.11
  PHP: wordpress:6.7-php8.2-apache
  CLI: WP-CLI (sidecar container)
```

### Règles d'infrastructure

- **Toujours** Docker — jamais d'installation bare-metal WordPress
- **Toujours** Traefik labels pour le SSL (Let's Encrypt automatique)
- **Jamais** de plugins analytics/live-chat en staging
- **Jamais** Yoast ET RankMath simultanément
- **Toujours** exporter la DB avant modification
- **Toujours** `blog_public = 0` sur staging (noindex)

---

## 🚦 Questions de Pré-Planning

Quand on te demande un plan pour du WordPress, classe le type d'intent d'abord :

| Intent | Questions clés |
|:---|---:|
| **Déploiement** | Nouveau domaine ? Stack vierge ? Traefik déjà configuré ? |
| **Migration** | Source = shared hosting/cPanel/VPS ? Taille du site ? Plugins/theme version ? Y a-t-il un accès SSH ? |
| **Design/Elementor** | Thème existant ou nouveau ? Licence Elementor Pro ? Besoin de Theme Builder ? |
| **SEO** | Yoast ou RankMath ? Site déjà indexé ? Core Web Vitals actuels ? |
| **Monitoring** | Quel niveau de SLA ? Uptime requis ? Budget disque/RAM ? |

### Pièges courants à détecter

- ⚠️ **Scope creep**: "on ajoute juste un blog" → finit en migration complète
- ⚠️ **DNS oublié**: le client pense que le site sera en ligne immédiatement
- ⚠️ **Plugins premium**: Elementor Pro, RankMath Pro — licences nécessaires
- ⚠️ **Volume**: site avec 50K+ articles ou média lourd → impact sur la stratégie
- ⚠️ **SSL**: vérifier que le domaine pointe déjà vers le VPS (Traefik valide)

---

## 📋 Assessment Questions Standard

### Pour un déploiement neuf :

```text
1. WordPress a-t-il besoin d'un thème sur mesure ou existant ?
2. Elementor Pro ou Free ? (licence nécessaire)
3. Multilingue ? (WPML, Polylang)
4. WooCommerce ? (change le monitoring + backups)
5. Utilisateurs attendus ? (membres, abonnés)
```

### Pour une migration :

```text
1. Accès SSH au serveur source ?
2. Version PHP actuelle ? Doit être ≤ 8.2
3. Taille du répertoire uploads/
4. Plugins spécifiques au serveur source ? (page builder, cache)
5. Y a-t-il un CDN/WAF à reconfigurer ?
6. Fenêtre de maintenance acceptable ?
```

### Pour du monitoring :

```text
1. SLA attendu (99%, 99.9%) ?
2. Budget : VPS mutualisé ou ressources dédiées ?
3. Plugins de cache/page builder utilisés ?
4. Fréquence de mise à jour du contenu ?
```

---

## 📐 Directives pour Oracle Planner

Quand tu passes au Planner, inclus ces directives adaptées au type d'intent détecté :

### Déploiement
- MUST: Vérifier que Traefik est running avant de commencer
- MUST: Utiliser `docker-compose` (v1, avec tiret) — PAS `docker compose`
- MUST: Configurer wp-cli sidecar pour les opérations post-install
- MUST: Activer le monitoring santé (HTTP/SSL/container)
- MUST NOT: Ouvrir des ports WP directement — tout passe par Traefik

### Migration
- MUST: Faire un assessment complet source avant de toucher au target
- MUST: Exporter DB + fichiers avant toute action
- MUST: Prévoir un rollback plan (DNS + stack source maintenue)
- MUST: Vérifier les permissions des fichiers uploads après migration
- MUST NOT: Sync staging vers production

### Elementor
- MUST: Vérifier que Elementor Pro est installé AVANT d'importer des templates
- MUST: Optimiser les performances (CSS minifié, Google Fonts local)
- MUST: Vérifier la compatibilité PHP 8.2
- MUST NOT: Activer tous les addons Elementor par défaut
