[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [Русский](README.ru.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-br.md) | [Italiano](README.it.md)

> [!NOTE]
> **OmO 5.0: OmO ❤️ Pi**
> Installiere es mit `curl -fsSL https://get.omo.dev/install.sh | bash`. Memory-System, CodeMode, Anthropic-Abos – alles abgedeckt.
> [![OmO Herdr DAG - Live-OmO-Workflow-DAGs in einer Herdr-Seitenleiste](./.github/assets/omo-herdr-dag.png)](https://github.com/jc01rho/omo-herdr-dag)
> *Gib einfach "mass ulw" mit deinem Prompt ein - jetzt bist du der Meister des Graph-Engineerings. Multi-Modell-ultracode, zusammen mit einem besseren Memory-System. (Das rechte Panel ist [omo-herdr-dag](https://github.com/jc01rho/omo-herdr-dag).)*

> **Sponsoren**
> Das sind unsere Sponsoren. Sie helfen dabei, OmO als persönliches Nebenprojekt am Laufen zu halten.
> | [<img alt="OpenGateway" src="./.github/assets/opengateway-logo.svg" width="156px" />](https://opengateway.ai/) | **[OpenGateway](https://opengateway.ai/)** sponsert OmO. Ein OpenAI-kompatibles Gateway, das viele Modellanbieter hinter einer einzigen API vereint. Danke für die Unterstützung von Open Source. |
> | :-----| :----- |


> [!NOTE]
>
> [![Sisyphus Labs - Lerne Dori kennen. Keine Demo. Abonniert einfach alles.](./.github/assets/sisyphuslabs.png?v=4)](https://sisyphuslabs.ai)
> > **OmO wird von Jobdori betreut, dem oben gezeigten KI-Assistenten. Lerne deinen eigenen Jobdori kennen: Dori. <br />Trag dich [hier](https://sisyphuslabs.ai) auf die Warteliste ein.**

> [!TIP]
> Sei dabei!
>
> | [<img alt="Discord link" src="https://img.shields.io/discord/1452487457085063218?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=flat-square" width="156px" />](https://discord.gg/PUwSMR9XNk) | Tritt unserer [Discord-Community](https://discord.gg/PUwSMR9XNk) bei, um dich mit Mitwirkenden und anderen OmO-Nutzern auszutauschen. |
> | :-----| :----- |
> | [<img alt="X link" src="https://img.shields.io/badge/Follow-%40justsisyphus-00CED1?style=flat-square&logo=x&labelColor=black" width="156px" />](https://x.com/justsisyphus) | Updates zu OmO wurden früher über meinen X-Account gepostet. <br /> Da dieser versehentlich gesperrt wurde, postet jetzt [@justsisyphus](https://x.com/justsisyphus) Updates in meinem Namen. |
> | [<img alt="GitHub Follow" src="https://img.shields.io/github/followers/code-yeongyu?style=flat-square&logo=github&labelColor=black&color=24292f" width="156px" />](https://github.com/code-yeongyu) | Folge [@code-yeongyu](https://github.com/code-yeongyu) auf GitHub für weitere Projekte. |

<!-- <CENTERED SECTION FOR GITHUB DISPLAY> -->

<div align="center">

<a href="https://omo.dev"><img src="./.github/assets/omo-icon-light.svg" alt="OmO" width="200" /></a>

# OmO

**Dein Werkzeug für echte Arbeit. Aber es ist ein Agent.**

[![GitHub Release](https://img.shields.io/github/v/release/code-yeongyu/oh-my-openagent?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/releases)
[![downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fomo.dev%2Fapi%2Fdownloads&style=flat-square)](https://omo.dev)
[![GitHub Contributors](https://img.shields.io/github/contributors/code-yeongyu/oh-my-openagent?color=c4f042&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/graphs/contributors)
[![GitHub Stars](https://img.shields.io/github/stars/code-yeongyu/oh-my-openagent?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/stargazers)
[![License](https://img.shields.io/badge/license-SUL--1.0-white?labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/LICENSE.md)
[![Docs](https://img.shields.io/badge/docs-omo.dev-369eff?labelColor=black&logo=readthedocs&logoColor=white&style=flat-square)](https://omo.dev/docs)


</div>

<!-- </CENTERED SECTION FOR GITHUB DISPLAY> -->

OmO ist ein einziger `omo`-Befehl, der deine Tokens in fertige Arbeit verwandelt: Recherche über zehntausend Quellen hinweg, eine Präsentation, die man wirklich versteht, Backends, Frontends, Code. Es läuft auf senpi, unserem Fork von [pi](https://github.com/badlogic/pi-mono), und bringt alles Folgende direkt mit.

## Installation

```bash
curl -fsSL https://get.omo.dev/install.sh | bash
omo
```

Unter Windows in PowerShell: `irm https://get.omo.dev/install.ps1 | iex`. Das Skript installiert die native `omo`-Binärdatei für dein Betriebssystem und deine CPU unter `~/.local/bin`, prüft sie anhand der Release-Prüfsummen und weicht auf GitHub Releases aus, falls der Mirror nicht erreichbar ist. Füge nach `bash` noch `-s -- beta` (oder eine Version wie `-s -- 5.1.1`) hinzu, um einen anderen Kanal zu wählen. Windows CMD, das Anpassen deines `PATH`, Updates und die Deinstallation werden unter [omo.dev/docs/install](https://omo.dev/docs/install) behandelt.

Lieber über einen Paketmanager? `bun add -g omo-ai` (oder `npm i -g omo-ai`) installiert dasselbe OmO. Das Paket heißt `omo-ai`; das davon unabhängige Paket `omo` auf npm gehört jemand anderem.

Öffne dein Projekt, führe `omo` aus, beschreibe die Aufgabe. Das ist das gesamte Setup.

In einer Session legt `/thinking <level>` fest, wie intensiv das Modell nachdenkt (`/thinking` allein öffnet eine Auswahl), `Shift+Tab` wechselt durch die Stufen und `/efforts <level>` setzt den Reasoning-Aufwand direkt bei Modellen mit Aufwandsstufen. Um frühere Arbeit wieder aufzunehmen, öffnet `/resume` (oder `/sessions`) deine bisherigen Sessions; aus der Shell setzt `omo -c` die letzte fort und `omo -r` öffnet die Auswahl. `/help` listet alles Weitere auf.

Kommst du von der OpenCode-Edition oder von LazyCodex? Führe einmalig `omo setup` aus. Dabei werden deine Provider-Keys, eigenen Provider, MCP-Server, Skills und deine Modellauswahl übernommen. `omo doctor` zeigt anschließend, welche Aufgabenkategorien deine Provider ausführen können und was von der alten Installation übrig geblieben ist. Die vollständige Anleitung findest du unter [Migration von OpenCode](docs/guide/migrating-from-opencode.md).

Zum Aktualisieren führst du den Installationsbefehl einfach erneut aus (eine Installation per Paketmanager aktualisierst du mit `omo update`). `rm ~/.local/bin/omo` entfernt die Binärinstallation; `bun remove -g omo-ai` (oder `npm uninstall -g omo-ai`) entfernt die Paketinstallation.

## Warum OmO

**ultrawork.** Spar dir das Einlesen. Wenn eine Aufgabe schwierig wirkt, füg einfach `ultrawork` (oder `ulw`) zu deinem Prompt hinzu. Der Agent liest die Codebase, bevor er eine Zeile anfasst, plant, verifiziert jeden Schritt vor dem nächsten, prüft das Ergebnis an der echten Oberfläche und hört auf, wenn er fertig ist.

**Hunderte Agenten, ein Keyword.** Tipp `mass ulw` ein und die gesamte Aufgabe wird zu einem Graphen aus Agenten: tiefgehende Recherche über tausende Quellen, eine komplette Machine-Learning-Pipeline, eine Migration, die niemand machen will. Jeder Teil läuft parallel auf dem passenden Modell und wird geprüft, bevor irgendetwas als erledigt gilt.

**Kibitzer. Dein Agent vergisst weder dich noch deine Arbeit.** Das Gedächtnis liegt in einem Git-Repository aus Markdown-Dateien. Ein kleines, günstiges Modell sitzt neben dem teuren Haupt-Agenten, liest, was du bisher gemacht hast, und stupst den Haupt-Agenten an, bevor er einen Fehler wiederholt. Du musst dich nicht mehr ständig neu erklären.

**Modelle mischen, ohne darüber nachzudenken.** Nutze die Frontier-Modelle, die du liebst, zusammen mit den günstigen. Melde dich einfach an: `/login` deckt Abos für Claude, ChatGPT, Kimi und GLM ab. Jedes Modell wird mit einem genau darauf abgestimmten System-Prompt ausgeliefert, sodass du nie das falsche wählst.

**Hochwertige Skills, nur die, die du brauchst.** Dein Modell ist schlau, weiß aber trotzdem nicht viel darüber, wie man Probleme in der echten Welt löst. OmO liefert das fehlende Wissen als Skills mit, inklusive Browser-Nutzung, und lädt nur das, was für die Aufgabe nötig ist.

**Alles andere ist sauber durchdacht.** Unabhängige Tool-Aufrufe laufen gebündelt in einem kleinen Programm, sodass zwanzig Lesezugriffe nur ein einziger Round-Trip sind. Fehlerhafte Tool-Argumente werden vor der Ausführung repariert. Das Warten auf einen Build oder ein Deployment läuft über eine Subscription statt über Polling. Bei längeren Aufgaben wird festgehalten, was bereits geprüft wurde, sodass eine neu gestartete Session genau dort weitermacht, wo sie aufgehört hat. Konfiguration, Skills und Prompts laden live neu.

## Konfiguration

Meinungsstarke Standardwerte, anpassbar, wenn du darauf bestehst. Deine Einstellungen liegen in `~/.omo/omo.jsonc`, und ein Projekt kann eine eigene `.omo/omo.jsonc` hinzufügen; die nächstgelegene Datei gewinnt. Alle Schlüssel stehen in der [Konfigurationsreferenz](docs/reference/configuration.md).

## Dokumentation

- [omo.dev/docs](https://omo.dev/docs)
- [Migration von OpenCode](docs/guide/migrating-from-opencode.md)
- [Konfigurationsreferenz](docs/reference/configuration.md)
- [Funktionen](docs/reference/features.md)
- [Computernutzung](docs/guide/computer-use.md) (experimentell)
- [Ultrawork-Manifest](docs/manifesto.md)

## Bewertungen

> "Deswegen habe ich mein Cursor-Abo gekündigt. In der Open-Source-Community passieren unglaubliche Dinge." - [Arthur Guiot](https://x.com/arthur_guiot/status/2008736347092382053?s=20)

> "Wenn Claude Code in 7 Tagen schafft, wofür ein Mensch 3 Monate braucht, schafft OmO es in 1 Stunde." <br/>- B, Quant Researcher

> "Ihr solltet das in den Core übernehmen und ihn einstellen. Ernsthaft. Es ist wirklich, wirklich, wirklich gut." <br/>- Henning Kilset

## Anmerkung des Autors

Wenn ich einem Agenten das Steuer wieder aus der Hand nehmen muss, ist das kein Teamwork. Das System hat versagt. OmO basiert auf dieser Idee. Du sagst, was du willst; der Agent recherchiert, plant, schreibt Code, den du nicht von dem eines Senior-Entwicklers unterscheiden könntest, verifiziert ihn und macht weiter, bis er fertig ist. Er gibt Tokens aus, wenn sie echte Geschwindigkeit bringen, und leitet die einfachen Teile an günstige Modelle weiter.

Ich bin der besessenste Nutzer dieses Projekts. Welches Modell hat die schärfste Logik? Wer schreibt die beste Prosa? Was haben alle anderen diese Woche ausgeliefert? In OmO landen diese Antworten. Du hast einen besseren Weg? PRs sind willkommen.

Das Ziel ist ein Agent, den du nicht mehr bemerkst. Du legst den Schalter um, das Licht geht an. Die Langfassung ist das [Ultrawork-Manifest](docs/manifesto.md).

Keine Verbindung zu den genannten Projekten oder Modellen. Die Ideen zu Ultragoal und UltraQA stammen von [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) und wurden ausgehend vom Konzept für OmO neu implementiert.

## Geschätzt von Profis bei

[Indent](https://indentcorp.com), den Machern von Spray (Influencer-Marketing-Lösung), vovushop (Plattform für grenzüberschreitenden Handel) und vreview (KI-Review-Marketing-Lösung für den Handel). [Google](https://google.com). [Microsoft](https://microsoft.com). [Vercel](https://vercel.com). [ELESTYLE](https://elestyle.jp), den Machern von elepay (Multi-Mobile-Payment-Gateway) und OneQR (Mobile-App-SaaS für bargeldlose Lösungen). [Deepgram](https://deepgram.com).
