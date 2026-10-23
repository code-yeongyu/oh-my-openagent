[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [Русский](README.ru.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-br.md) | [Italiano](README.it.md)

> [!NOTE]
> **OmO 5.0 : OmO ❤️ Pi**
> Installez-le avec `curl -fsSL https://get.omo.dev/install.sh | bash`. Système de mémoire, CodeMode, abonnements Anthropic, tout est inclus.
> [![OmO Herdr DAG - DAG de workflows OmO en direct dans un panneau latéral Herdr](./.github/assets/omo-herdr-dag.png)](https://github.com/jc01rho/omo-herdr-dag)
> *Tapez simplement "mass ulw" avec votre prompt - vous voilà maître de l'ingénierie de graphes. De l'ultracode multi-modèle, associé à un meilleur système de mémoire. (Le panneau de droite est [omo-herdr-dag](https://github.com/jc01rho/omo-herdr-dag).)*

> **Sponsors**
> Voici nos sponsors. Ils permettent à OmO de continuer en tant que projet personnel.
> | [<img alt="OpenGateway" src="./.github/assets/opengateway-logo.svg" width="156px" />](https://opengateway.ai/) | **[OpenGateway](https://opengateway.ai/)** sponsorise OmO. Une passerelle compatible OpenAI qui regroupe de nombreux fournisseurs de modèles derrière une seule API. Merci de soutenir l'open source. |
> | :-----| :----- |


> [!NOTE]
>
> [![Sisyphus Labs - Découvrez Dori. Pas une démo. S'abonne à tout.](./.github/assets/sisyphuslabs.png?v=4)](https://sisyphuslabs.ai)
> > **OmO est maintenu par Jobdori, l'assistant IA présenté ci-dessus. Découvrez votre propre Jobdori, Dori. <br />Rejoignez la liste d'attente [ici](https://sisyphuslabs.ai).**

> [!TIP]
> Rejoignez-nous !
>
> | [<img alt="Discord link" src="https://img.shields.io/discord/1452487457085063218?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=flat-square" width="156px" />](https://discord.gg/PUwSMR9XNk) | Rejoignez notre [communauté Discord](https://discord.gg/PUwSMR9XNk) pour échanger avec les contributeurs et les autres utilisateurs d'OmO. |
> | :-----| :----- |
> | [<img alt="X link" src="https://img.shields.io/badge/Follow-%40justsisyphus-00CED1?style=flat-square&logo=x&labelColor=black" width="156px" />](https://x.com/justsisyphus) | Les actualités d'OmO étaient auparavant publiées sur mon compte X. <br /> Depuis qu'il a été suspendu par erreur, [@justsisyphus](https://x.com/justsisyphus) publie désormais les mises à jour en mon nom. |
> | [<img alt="GitHub Follow" src="https://img.shields.io/github/followers/code-yeongyu?style=flat-square&logo=github&labelColor=black&color=24292f" width="156px" />](https://github.com/code-yeongyu) | Suivez [@code-yeongyu](https://github.com/code-yeongyu) sur GitHub pour découvrir d'autres projets. |

<!-- <CENTERED SECTION FOR GITHUB DISPLAY> -->

<div align="center">

<a href="https://omo.dev"><img src="./.github/assets/omo-icon-light.svg" alt="OmO" width="200" /></a>

# OmO

**Votre outil pour du vrai travail. Mais c'est un agent.**

[![GitHub Release](https://img.shields.io/github/v/release/code-yeongyu/oh-my-openagent?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/releases)
[![downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fomo.dev%2Fapi%2Fdownloads&style=flat-square)](https://omo.dev)
[![GitHub Contributors](https://img.shields.io/github/contributors/code-yeongyu/oh-my-openagent?color=c4f042&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/graphs/contributors)
[![GitHub Stars](https://img.shields.io/github/stars/code-yeongyu/oh-my-openagent?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/stargazers)
[![License](https://img.shields.io/badge/license-SUL--1.0-white?labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/LICENSE.md)
[![Docs](https://img.shields.io/badge/docs-omo.dev-369eff?labelColor=black&logo=readthedocs&logoColor=white&style=flat-square)](https://omo.dev/docs)


</div>

<!-- </CENTERED SECTION FOR GITHUB DISPLAY> -->

OmO est une unique commande `omo` qui transforme vos tokens en travail fini : des recherches sur dix mille sources, une présentation que les gens comprennent vraiment, des backends, des frontends, du code. Il tourne sur senpi, notre fork de [pi](https://github.com/badlogic/pi-mono), avec tout ce qui suit intégré.

## Installation

```bash
curl -fsSL https://get.omo.dev/install.sh | bash
omo
```

Sous Windows, dans PowerShell : `irm https://get.omo.dev/install.ps1 | iex`. Le script installe le binaire natif `omo` adapté à votre OS et votre CPU dans `~/.local/bin`, le vérifie par rapport aux sommes de contrôle de la release et bascule sur GitHub Releases si le miroir est injoignable. Ajoutez `-s -- beta` (ou une version comme `-s -- 5.1.1`) après `bash` pour choisir un autre canal. Windows CMD, la configuration du `PATH`, la mise à jour et la désinstallation sont détaillés sur [omo.dev/docs/install](https://omo.dev/docs/install).

Vous préférez un gestionnaire de paquets ? `bun add -g omo-ai` (ou `npm i -g omo-ai`) installe le même OmO. Le paquet s'appelle `omo-ai` ; le paquet `omo` sur npm n'a aucun rapport et appartient à quelqu'un d'autre.

Ouvrez votre projet, lancez `omo`, décrivez la tâche. C'est tout pour la configuration.

Dans une session, `/thinking <level>` définit le niveau de réflexion du modèle (`/thinking` seul ouvre un sélecteur), `Shift+Tab` fait défiler les niveaux et `/efforts <level>` règle directement l'effort de raisonnement sur les modèles dotés de niveaux d'effort. Pour reprendre un travail précédent, `/resume` (ou `/sessions`) ouvre vos sessions passées ; depuis le shell, `omo -c` reprend la dernière et `omo -r` ouvre le sélecteur. `/help` affiche tout le reste.

Vous venez de l'édition OpenCode ou de LazyCodex ? Lancez `omo setup` une fois. Cette commande transfère vos clés de fournisseurs, vos fournisseurs personnalisés, vos serveurs MCP, vos skills et vos choix de modèles. `omo doctor` indique ensuite quelles catégories de tâches vos fournisseurs peuvent exécuter et ce qu'il reste de l'ancienne installation. Le guide complet se trouve dans [Migrer depuis OpenCode](docs/guide/migrating-from-opencode.md).

Pour mettre à jour, relancez la commande d'installation (une installation via gestionnaire de paquets se met à jour avec `omo update`). `rm ~/.local/bin/omo` supprime l'installation binaire ; `bun remove -g omo-ai` (ou `npm uninstall -g omo-ai`) supprime l'installation par paquet.

## Pourquoi OmO

**ultrawork.** Oubliez la phase d'étude. Si une tâche vous semble difficile, ajoutez `ultrawork` (ou `ulw`) à votre prompt. L'agent lit la base de code avant de toucher à une seule ligne, planifie, prouve chaque étape avant d'avancer, vérifie le résultat sur la surface réelle et s'arrête quand c'est terminé.

**Des centaines d'agents, un seul mot-clé.** Tapez `mass ulw` et toute la tâche devient un graphe d'agents : recherche approfondie sur des milliers de sources, pipeline complet de machine learning, ou cette migration que personne ne veut faire. Chaque partie tourne en parallèle sur le modèle qui lui correspond, et tout est vérifié avant d'être considéré comme terminé.

**Kibitzer. Votre agent ne vous oublie pas, ni votre travail.** La mémoire vit dans un dépôt git de fichiers Markdown. Un petit modèle économique accompagne l'agent principal plus coûteux, lit ce que vous avez déjà fait et aiguille l'agent principal avant qu'il ne répète une erreur. Vous arrêtez de tout réexpliquer.

**Combinez les modèles sans y penser.** Utilisez les modèles de pointe que vous aimez aux côtés de modèles économiques. Connectez-vous simplement : `/login` prend en charge les abonnements Claude, ChatGPT, Kimi et GLM. Chaque modèle est livré avec un prompt système calibré sur mesure, pour que vous ne fassiez jamais le mauvais choix.

**Des skills de haute qualité, uniquement ceux dont vous avez besoin.** Votre modèle est intelligent, mais il ignore encore beaucoup de choses sur la résolution de problèmes concrets. OmO fournit ces connaissances manquantes sous forme de skills, utilisation du navigateur comprise, et ne charge que ce dont la tâche a besoin.

**Tout le reste est conçu avec soin.** Les appels d'outils indépendants s'exécutent ensemble dans un petit programme unique : vingt lectures ne font qu'un seul aller-retour. Les arguments d'outils mal formés sont réparés avant leur exécution. L'attente d'un build ou d'un déploiement fonctionne par abonnement, pas par polling. Les tâches longues gardent une trace de ce qui a été vérifié, pour qu'une session redémarrée reprenne exactement là où elle s'était arrêtée. La configuration, les skills et les prompts se rechargent à chaud.

## Configuration

Des valeurs par défaut assumées, ajustables si vous insistez. Vos paramètres se trouvent dans `~/.omo/omo.jsonc`, et un projet peut ajouter son propre `.omo/omo.jsonc` ; le fichier le plus proche l'emporte. Toutes les clés sont dans la [référence de configuration](docs/reference/configuration.md).

## Documentation

- [omo.dev/docs](https://omo.dev/docs)
- [Migrer depuis OpenCode](docs/guide/migrating-from-opencode.md)
- [Référence de configuration](docs/reference/configuration.md)
- [Fonctionnalités](docs/reference/features.md)
- [Utilisation de l'ordinateur](docs/guide/computer-use.md) (expérimental)
- [Manifeste Ultrawork](docs/manifesto.md)

## Avis

> "Ça m'a fait résilier mon abonnement Cursor. Des choses incroyables se passent dans la communauté open source." - [Arthur Guiot](https://x.com/arthur_guiot/status/2008736347092382053?s=20)

> "Si Claude Code fait en 7 jours ce qu'un humain fait en 3 mois, OmO le fait en 1 heure." <br/>- B, Chercheur quantitatif

> "Vous devriez intégrer ça au core et le recruter. Sérieusement. C'est vraiment, vraiment, vraiment bon." <br/>- Henning Kilset

## Note de l'auteur

Quand je dois reprendre la main sur un agent, ce n'est pas du travail d'équipe. Le système a échoué. OmO est construit sur cette idée. Vous dites ce que vous voulez ; l'agent fait les recherches, planifie, écrit un code impossible à distinguer de celui d'un ingénieur senior, le vérifie et continue jusqu'à ce que ce soit terminé. Il dépense des tokens quand ils apportent un vrai gain de vitesse et redirige les parties simples vers des modèles économiques.

Je suis l'utilisateur le plus obsessionnel de ce projet. Quel modèle a la logique la plus affûtée ? Qui écrit la meilleure prose ? Qu'est-ce que les autres ont sorti cette semaine ? C'est dans OmO que ces réponses atterrissent. Vous avez une meilleure approche ? Les PR sont les bienvenues.

L'objectif est un agent que vous ne remarquez même plus. Vous appuyez sur l'interrupteur, la lumière s'allume. La version longue est dans le [Manifeste Ultrawork](docs/manifesto.md).

Aucune affiliation avec les projets ou modèles mentionnés. Les idées d'Ultragoal et d'UltraQA viennent de [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex), réimplémentées à partir du concept pour OmO.

## Apprécié par les professionnels chez

[Indent](https://indentcorp.com), créateurs de Spray (solution de marketing d'influence), vovushop (plateforme de commerce transfrontalier) et vreview (solution IA de marketing par avis pour le commerce). [Google](https://google.com). [Microsoft](https://microsoft.com). [Vercel](https://vercel.com). [ELESTYLE](https://elestyle.jp), créateurs d'elepay (passerelle de paiement multi-mobile) et OneQR (application mobile SaaS pour solutions sans espèces). [Deepgram](https://deepgram.com).
