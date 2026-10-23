[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [Русский](README.ru.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-br.md) | [Italiano](README.it.md)

> [!NOTE]
> **OmO 5.0: OmO ❤️ Pi**
> Installalo con `curl -fsSL https://get.omo.dev/install.sh | bash`. Sistema di memoria, CodeMode, abbonamenti Anthropic: tutto incluso.
> [![OmO Herdr DAG - DAG dei workflow OmO in tempo reale in un pannello laterale di Herdr](./.github/assets/omo-herdr-dag.png)](https://github.com/jc01rho/omo-herdr-dag)
> *Scrivi semplicemente "mass ulw" con il tuo prompt - ora sei il maestro del graph engineering. ultracode multi-modello, insieme a un sistema di memoria migliore. (Il pannello a destra è [omo-herdr-dag](https://github.com/jc01rho/omo-herdr-dag).)*

> **Sponsor**
> Questi sono i nostri sponsor. Aiutano a portare avanti OmO come progetto personale parallelo.
> | [<img alt="OpenGateway" src="./.github/assets/opengateway-logo.svg" width="156px" />](https://opengateway.ai/) | **[OpenGateway](https://opengateway.ai/)** sponsorizza OmO. Un gateway compatibile con OpenAI che riunisce molti provider di modelli dietro un'unica API. Grazie per sostenere l'open source. |
> | :-----| :----- |


> [!NOTE]
>
> [![Sisyphus Labs - Scopri Dori. Non è una demo. Si abbona a tutto.](./.github/assets/sisyphuslabs.png?v=4)](https://sisyphuslabs.ai)
> > **OmO è mantenuto da Jobdori, l'assistente IA mostrato qui sopra. Scopri il tuo Jobdori personale, Dori. <br />Iscriviti alla lista d'attesa [qui](https://sisyphuslabs.ai).**

> [!TIP]
> Unisciti a noi!
>
> | [<img alt="Discord link" src="https://img.shields.io/discord/1452487457085063218?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=flat-square" width="156px" />](https://discord.gg/PUwSMR9XNk) | Unisciti alla nostra [community Discord](https://discord.gg/PUwSMR9XNk) per entrare in contatto con i contributor e gli altri utenti di OmO. |
> | :-----| :----- |
> | [<img alt="X link" src="https://img.shields.io/badge/Follow-%40justsisyphus-00CED1?style=flat-square&logo=x&labelColor=black" width="156px" />](https://x.com/justsisyphus) | Gli aggiornamenti su OmO venivano pubblicati sul mio account X. <br /> Poiché è stato sospeso per errore, ora [@justsisyphus](https://x.com/justsisyphus) pubblica gli aggiornamenti per conto mio. |
> | [<img alt="GitHub Follow" src="https://img.shields.io/github/followers/code-yeongyu?style=flat-square&logo=github&labelColor=black&color=24292f" width="156px" />](https://github.com/code-yeongyu) | Segui [@code-yeongyu](https://github.com/code-yeongyu) su GitHub per altri progetti. |

<!-- <CENTERED SECTION FOR GITHUB DISPLAY> -->

<div align="center">

<a href="https://omo.dev"><img src="./.github/assets/omo-icon-light.svg" alt="OmO" width="200" /></a>

# OmO

**Il tuo strumento per il lavoro vero. Ma è un agente.**

[![GitHub Release](https://img.shields.io/github/v/release/code-yeongyu/oh-my-openagent?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/releases)
[![downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fomo.dev%2Fapi%2Fdownloads&style=flat-square)](https://omo.dev)
[![GitHub Contributors](https://img.shields.io/github/contributors/code-yeongyu/oh-my-openagent?color=c4f042&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/graphs/contributors)
[![GitHub Stars](https://img.shields.io/github/stars/code-yeongyu/oh-my-openagent?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/stargazers)
[![License](https://img.shields.io/badge/license-SUL--1.0-white?labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/LICENSE.md)
[![Docs](https://img.shields.io/badge/docs-omo.dev-369eff?labelColor=black&logo=readthedocs&logoColor=white&style=flat-square)](https://omo.dev/docs)


</div>

<!-- </CENTERED SECTION FOR GITHUB DISPLAY> -->

OmO è un unico comando `omo` che trasforma i tuoi token in lavoro finito: ricerche su diecimila fonti, presentazioni che le persone capiscono davvero, backend, frontend, codice. Gira su senpi, il nostro fork di [pi](https://github.com/badlogic/pi-mono), con tutto ciò che trovi qui sotto già integrato.

## Installazione

```bash
curl -fsSL https://get.omo.dev/install.sh | bash
omo
```

Su Windows, in PowerShell: `irm https://get.omo.dev/install.ps1 | iex`. Lo script installa il binario nativo `omo` per il tuo sistema operativo e la tua CPU in `~/.local/bin`, lo verifica rispetto ai checksum della release e ripiega su GitHub Releases quando il mirror non è raggiungibile. Aggiungi `-s -- beta` (o una versione come `-s -- 5.1.1`) dopo `bash` per scegliere un altro canale. Windows CMD, la correzione del `PATH`, l'aggiornamento e la disinstallazione sono spiegati su [omo.dev/docs/install](https://omo.dev/docs/install).

Preferisci un gestore di pacchetti? `bun add -g omo-ai` (o `npm i -g omo-ai`) installa lo stesso OmO. Il pacchetto è `omo-ai`; il pacchetto `omo` su npm non è correlato e appartiene a qualcun altro.

Apri il tuo progetto, esegui `omo`, descrivi il lavoro. Questa è tutta la configurazione.

In una sessione, `/thinking <level>` imposta quanto a fondo riflette il modello (`/thinking` da solo apre un selettore), `Shift+Tab` scorre tra i livelli e `/efforts <level>` imposta direttamente l'impegno di ragionamento sui modelli con gradi di impegno. Per riprendere un lavoro precedente, `/resume` (o `/sessions`) apre le sessioni passate; dalla shell, `omo -c` continua l'ultima e `omo -r` apre il selettore. `/help` elenca tutto il resto.

Vieni dall'edizione OpenCode o da LazyCodex? Esegui `omo setup` una sola volta. Trasferisce le chiavi dei provider, i provider personalizzati, i server MCP, le skill e le scelte dei modelli. `omo doctor` mostra poi quali categorie di attività possono eseguire i tuoi provider e cosa ha lasciato la vecchia installazione. La guida completa è in [Migrazione da OpenCode](docs/guide/migrating-from-opencode.md).

Per aggiornare, esegui di nuovo il comando di installazione (un'installazione tramite gestore di pacchetti si aggiorna con `omo update`). `rm ~/.local/bin/omo` rimuove l'installazione del binario; `bun remove -g omo-ai` (o `npm uninstall -g omo-ai`) rimuove l'installazione del pacchetto.

## Perché OmO

**ultrawork.** Salta lo studio. Se un'attività sembra difficile, aggiungi `ultrawork` (o `ulw`) al tuo prompt. L'agente legge la codebase prima di toccare una riga, pianifica, verifica ogni passaggio prima di andare avanti, controlla il risultato sulla superficie reale e si ferma quando ha finito.

**Centinaia di agenti, una sola parola chiave.** Digita `mass ulw` e l'intero lavoro diventa un grafo di agenti: ricerca approfondita su migliaia di fonti, una pipeline completa di machine learning, una migrazione che nessuno vuole fare. Ogni parte gira sul modello più adatto, in parallelo, e viene controllata prima che il lavoro sia considerato concluso.

**Kibitzer. Il tuo agente non dimentica né te, né il tuo lavoro.** La memoria vive in un repository git di file markdown. Un modello piccolo ed economico affianca il costoso agente principale, legge quello che hai fatto in precedenza e avvisa l'agente principale prima che ripeta un errore. Smetti di doverti rispiegare.

**Combina i modelli senza pensarci.** Usa i modelli di frontiera che ami insieme a quelli economici. Ti basta accedere: `/login` copre gli abbonamenti a Claude, ChatGPT, Kimi e GLM. Ogni modello include un system prompt calibrato su misura, così non scegli mai quello sbagliato.

**Skill di alta qualità, solo quelle che ti servono.** Il tuo modello è intelligente, ma ancora non sa molto su come risolvere i problemi del mondo reale. OmO fornisce le conoscenze mancanti sotto forma di skill, incluso l'uso del browser, e carica solo ciò che serve per l'attività.

**Tutto il resto è curato nei dettagli.** Le chiamate indipendenti agli strumenti vengono eseguite insieme in un piccolo programma, così venti letture richiedono un solo round trip. Gli argomenti malformati degli strumenti vengono riparati prima dell'esecuzione. Attendere una build o un deploy è una sottoscrizione, non un polling. I lavori lunghi tengono traccia di ciò che è stato controllato, così una sessione riavviata riprende da dove si era interrotta. Configurazione, skill e prompt si ricaricano in tempo reale.

## Configurazione

Valori predefiniti mirati, modificabili se insisti. Le tue impostazioni si trovano in `~/.omo/omo.jsonc`, e un progetto può aggiungere il proprio `.omo/omo.jsonc`; vince il file più vicino. Ogni chiave è nel [riferimento della configurazione](docs/reference/configuration.md).

## Documentazione

- [omo.dev/docs](https://omo.dev/docs)
- [Migrazione da OpenCode](docs/guide/migrating-from-opencode.md)
- [Riferimento per la configurazione](docs/reference/configuration.md)
- [Funzionalità](docs/reference/features.md)
- [Uso del computer](docs/guide/computer-use.md) (sperimentale)
- [Manifesto Ultrawork](docs/manifesto.md)

## Recensioni

> "Mi ha fatto disdire l'abbonamento a Cursor. Stanno accadendo cose incredibili nella community open source." - [Arthur Guiot](https://x.com/arthur_guiot/status/2008736347092382053?s=20)

> "Se Claude Code fa in 7 giorni quello che un umano fa in 3 mesi, OmO lo fa in 1 ora." <br/>- B, Ricercatore quantitativo

> "Dovreste integrarlo nel core e assumerlo. Sul serio. È davvero, davvero, davvero valido." <br/>- Henning Kilset

## Nota dell'autore

Quando devo riprendere il volante da un agente, non è lavoro di squadra. Il sistema ha fallito. OmO nasce da questa idea. Tu dici cosa vuoi; l'agente fa ricerca, pianifica, scrive codice indistinguibile da quello di un ingegnere senior, lo verifica e va avanti finché non ha finito. Spende token quando comprano vera velocità e instrada le parti facili verso modelli economici.

Sono l'utente più ossessivo di questo progetto. Quale modello ha la logica più affilata? Chi scrive la prosa migliore? Cosa hanno rilasciato gli altri questa settimana? OmO è dove atterrano queste risposte. Hai un modo migliore? Le PR sono benvenute.

L'obiettivo è un agente che smetti di notare. Premi l'interruttore, la luce si accende. La versione lunga è il [Manifesto Ultrawork](docs/manifesto.md).

Nessuna affiliazione con alcun progetto o modello menzionato. Le idee di Ultragoal e UltraQA vengono da [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex), reimplementate a partire dal concetto per OmO.

## Amato dai professionisti di

[Indent](https://indentcorp.com), creatori di Spray (soluzione di influencer marketing), vovushop (piattaforma di commercio transfrontaliero) e vreview (soluzione di marketing con IA per recensioni commerciali). [Google](https://google.com). [Microsoft](https://microsoft.com). [Vercel](https://vercel.com). [ELESTYLE](https://elestyle.jp), creatori di elepay (gateway di pagamento multi-mobile) e OneQR (applicazione mobile SaaS per soluzioni cashless). [Deepgram](https://deepgram.com).
