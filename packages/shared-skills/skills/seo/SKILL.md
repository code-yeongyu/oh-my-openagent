---
name: seo
description: "KLC SEO optimization: RankMath/Yoast config, Core Web Vitals, schema.org, meta tags, sitemaps, Open Graph. ACTIVATES on any SEO-related task — configuration, audit, optimization, or content optimization for KLC sites."
---

# SEO — Optimization KLC

> Usage réservé à **Cypher** (copywriting & SEO).
> Contient les configurations SEO précises pour les sites WordPress KLC.

---

## 🔧 Configuration SEO

### RankMath (recommandé KLC)

```bash
dwp plugin install seo-by-rank-math --activate
```

**Configuration post-install :**
```bash
# Générer le sitemap XML
dwp option update rankmath_sitemap_index '1'

# Configurer les modules
dwp option update rankmath_modules '["sitemap", "rich-snippet", "404-monitor", "local-seo", "analytics"]'

# Définir le type de site (organization/local/person)
dwp option update rankmath_site_type 'organization'
dwp option update rankmath_organization_name 'KL-Consulting'
dwp option update rankmath_organization_logo 'https://${DOMAIN}/wp-content/uploads/klc-logo.png'

# Désactiver les pages d'archives inutiles
dwp option update rankmath_titles_archive_author 'off'
dwp option update rankmath_titles_archive_date 'off'
```

### Yoast (alternative)

```bash
dwp plugin install wordpress-seo --activate

# Configuration de base
dwp option update wpseo_titles "{'title-home-wpseo': '%%sitename%% — %%sitedesc%%'}"
dwp option update wpseo_social '{"opengraph": true, "twitter": true}'
```

---

## 📄 Meta Tags Structure

### Template Title

```text
Page principale : {Brand} — {Tagline}
Article        : {Titre} | {Brand}
Catégorie      : {Catégorie} — {Brand}
Service        : {Service} — KL-Consulting
```

### Open Graph (vérifier)

```html
<meta property="og:title" content="..." />
<meta property="og:description" content="..." />
<meta property="og:image" content="https://{domain}/wp-content/uploads/og-image.jpg" />
<meta property="og:url" content="https://{domain}/" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="KL-Consulting" />
```

### Twitter Cards

```html
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="@klconsulting" />
<meta name="twitter:title" content="..." />
<meta name="twitter:description" content="..." />
<meta name="twitter:image" content="..." />
```

---

## 🏗️ Schema.org / Rich Snippets

### Organization (template JSON-LD)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "KL-Consulting",
  "url": "https://{domain}",
  "logo": "https://{domain}/wp-content/uploads/klc-logo.png",
  "description": "Groupe franco-africain augmenté par l'IA",
  "sameAs": [
    "https://linkedin.com/company/klconsulting",
    "https://twitter.com/klconsulting"
  ],
  "address": {
    "@type": "PostalAddress",
    "addressCountry": "FR/CG"
  }
}
</script>
```

### BreadcrumbList

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [{
    "@type": "ListItem",
    "position": 1,
    "name": "Accueil",
    "item": "https://{domain}"
  }, {
    "@type": "ListItem",
    "position": 2,
    "name": "{Page}",
    "item": "https://{domain}/{slug}"
  }]
}
</script>
```

### LocalBusiness (pour clients avec adresse physique)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "{Client Name}",
  "image": "https://{domain}/logo.png",
  "telephone": "+XXX",
  "email": "contact@{domain}",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "...",
    "addressLocality": "...",
    "addressCountry": "..."
  },
  "openingHoursSpecification": [{
    "@type": "OpeningHoursSpecification",
    "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"],
    "opens": "09:00",
    "closes": "18:00"
  }]
}
</script>
```

---

## 🚀 Core Web Vitals — Checklist Optimisation

### Images
```text
- [ ] WebP/AVIF format (dwp plugin install webp-express --activate)
- [ ] Lazy loading natif (loading="lazy")
- [ ] Images responsives (srcset)
- [ ] Dimensions explicites (width/height)
- [ ] Compression: 60-80% qualité
```

### Performance
```bash
# Cache (si serveur dédié)
dwp plugin install w3-total-cache --activate

# Optimisation base de données
dwp db optimize
dwp transient delete --expired

# Minification CSS/JS via RankMath
dwp option update rankmath_module_analytics 'false'
```

### Polices
```text
- [ ] Google Fonts en local (dwp plugin install local-google-fonts --activate)
- [ ] font-display: swap
- [ ] Preconnect aux CDN fonts
```

---

## 📊 Audit Checklist KLC

Avant mise en production d'un site :

```text
## SEO Pré-lancement
- [ ] XML Sitemap accessible (/sitemap.xml → HTTP 200)
- [ ] robots.txt correct (pas de blocage意外)
- [ ] Meta description unique par page
- [ ] Canonical URLs configurées
- [ ] Open Graph + Twitter Cards présents
- [ ] Schema.org Organization (ou LocalBusiness) présent
- [ ] Pages 404 personnalisée
- [ ] Redirections 301 des anciennes URLs

## Performance
- [ ] GTmetrix / Lighthouse ≥ 80 sur Mobile
- [ ] Core Web Vitals : LCP < 2.5s, FID < 100ms, CLS < 0.1
- [ ] Pagespeed ≥ 90 sur Desktop

## Contenu
- [ ] Pas de contenu dupliqué
- [ ] Balises heading (H1-H3) bien structurées
- [ ] Alt texts sur toutes les images
- [ ] Internal linking cohérent
```

---

## 📝 Copywriting SEO KLC

### Tone of Voice
```text
- Ton : professionnel, confiant, humain
- Pas de jargon technique inutile
- "Nous" plutôt que "Je"
- Phrases courtes, idées claires
- Call-to-action explicites
```

### Structure d'article
```text
1. H1 : Titre accrocheur (mot-clé principal)
2. Intro : 2-3 phrases, problème + solution
3. H2 : Sous-sections avec mots-clés secondaires
4. Corps : Listes, tableaux, exemples concrets
5. CTA : Action souhaitée (contact, demo, téléchargement)
```

### Mots-clés KLC
```text
- Groupe franco-africain
- Augmenté par l'IA
- Copy trading Afrique
- Hébergement WordPress
- Consulting IA
- Transformation digitale Afrique
```

---

## ⚠️ Règles KLC

### NEVER
- Installer Yoast ET RankMath simultanément
- Laisser `blog_public = 0` sur production
- Utiliser des plugins SEO crackés
- Négliger les meta descriptions (même sur les vieux articles)
- Copier-coller le même contenu sur plusieurs pages

### ALWAYS
- Vérifier le sitemap après déploiement
- Mettre à jour les redirections après migration
- Faire un audit Lighthouse avant livraison
- Vérifier l'indexation Google (Search Console)
- Adapter le ton de voix au client (pas de template unique)
