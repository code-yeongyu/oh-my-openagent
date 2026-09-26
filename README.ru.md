> [!NOTE]
> **OmO Бета: OmO ❤️ Pi**
> Установите `bun add -g omo-ai`: система памяти, CodeMode, подписки Anthropic. Всё включено.
> [![OmO Herdr DAG - live OmO workflow DAGs in a Herdr side pane](./.github/assets/omo-herdr-dag.png)](https://github.com/jc01rho/omo-herdr-dag)
> *Просто добавьте "mass ulw" в свой промпт - и вы мастер графовой инженерии. Мультимодельный ultracode с улучшенной системой памяти. (Правая панель - [omo-herdr-dag](https://github.com/jc01rho/omo-herdr-dag))*


> **Sponsors**
> Ниже представлены наши спонсоры. Они помогают проекту существовать как личному сайд-проекту.
> | [<img alt="OpenGateway" src="./.github/assets/opengateway-logo.svg" width="156px" />](https://opengateway.ai/) | **[OpenGateway](https://opengateway.ai/)** спонсирует OmO. Это OpenAI-совместимый шлюз, который объединяет множество провайдеров моделей под одним API. Спасибо за поддержку open source. |
> | :-----| :----- |


> [!NOTE]
>
> [![Sisyphus Labs - Meet Dori. Not a demo. Subscribes to everything.](./.github/assets/sisyphuslabs.png?v=4)](https://sisyphuslabs.ai)
>
> > **OmO поддерживается Jobdori, ИИ-ассистентом, показанным выше. Познакомьтесь со своим Jobdori, Dori. <br />Присоединяйтесь к листу ожидания [здесь](https://sisyphuslabs.ai).**

> [!TIP] Будьте с нами!
>
> | [<img alt="Discord link" src="https://img.shields.io/discord/1452487457085063218?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=flat-square" width="156px" />](https://discord.gg/PUwSMR9XNk) | Вступайте в наш [Discord](https://discord.gg/PUwSMR9XNk), чтобы общаться с контрибьюторами и пользователями OmO. |
> | :-----| :----- |
> | [<img alt="X link" src="https://img.shields.io/badge/Follow-%40justsisyphus-00CED1?style=flat-square&logo=x&labelColor=black" width="156px" />](https://x.com/justsisyphus) | Обновления OmO раньше публиковались на моём аккаунте X. <br /> После ошибочной блокировки [@justsisyphus](https://x.com/justsisyphus) публикует обновления вместо меня. |
> | [<img alt="GitHub Follow" src="https://img.shields.io/github/followers/code-yeongyu?style=flat-square&logo=github&labelColor=black&color=24292f" width="156px" />](https://github.com/code-yeongyu) | Подпишитесь на [@code-yeongyu](https://github.com/code-yeongyu) на GitHub, чтобы следить за другими проектами. |

<!-- <CENTERED SECTION FOR GITHUB DISPLAY> -->

<div align="center">

<a href="https://omo.dev"><img src="./.github/assets/omo-icon-light.svg" alt="OmO" width="200" /></a>

# OmO

**Your tool for real work. But it's an agent.**

[![GitHub Release](https://img.shields.io/github/v/release/code-yeongyu/oh-my-openagent?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/releases)
[![npm downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fomo.dev%2Fapi%2Fnpm-downloads&style=flat-square)](https://www.npmjs.com/package/omo-ai)
[![GitHub Contributors](https://img.shields.io/github/contributors/code-yeongyu/oh-my-openagent?color=c4f042&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/graphs/contributors)
[![GitHub Stars](https://img.shields.io/github/stars/code-yeongyu/oh-my-openagent?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/stargazers)
[![License](https://img.shields.io/badge/license-SUL--1.0-white?labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/LICENSE.md)
[![Docs](https://img.shields.io/badge/docs-omo.dev-369eff?labelColor=black&logo=readthedocs&logoColor=white&style=flat-square)](https://omo.dev/docs)

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-cn.md) | [Русский](README.ru.md)

</div>

<!-- </CENTERED SECTION FOR GITHUB DISPLAY> -->

OmO это одна команда `omo`, которая превращает ваши токены в готовую работу: исследование по десяти тысячам источников, презентацию, которую действительно понимают, бэкенды, фронтенды, код. Она работает на senpi, нашем форке [pi](https://github.com/badlogic/pi-mono), и всё описанное ниже уже встроено.

## Установка

```bash
bun add -g omo-ai
omo
```

Нет bun? Подойдёт и `npm i -g omo-ai`. Пакет называется `omo-ai`, а пакет `omo` в npm не имеет к нам отношения.

Откройте проект, запустите `omo` и опишите задачу. На этом настройка закончена.

Переходите с OpenCode-версии или с LazyCodex? Один раз запустите `omo setup`. Команда перенесёт ключи провайдеров, пользовательских провайдеров, MCP-серверы, навыки и выбранные модели.

Затем `omo doctor` покажет, какие категории задач могут выполнять ваши провайдеры и что осталось от старой установки. Подробная инструкция: [Миграция с OpenCode](docs/guide/migrating-from-opencode.md).

`omo update` обновляет установку на месте. `bun remove -g omo-ai` (или `npm uninstall -g omo-ai`) удаляет её.

## Почему OmO

**ultrawork.** Не нужно ничего изучать. Если задача кажется сложной, добавьте в промпт `ultrawork` (или `ulw`).

Агент прочитает кодовую базу, прежде чем менять хоть строку, составит план и проверит каждый шаг, прежде чем идти дальше. Он проверит результат в реальной среде и остановится, когда всё готово.

**Сотни агентов, одно ключевое слово.** Напишите `mass ulw`, и вся задача превратится в граф агентов: глубокое исследование по тысячам источников, полный пайплайн машинного обучения, миграция, за которую никто не хочет браться.

Каждая часть выполняется параллельно на подходящей для неё модели и проверяется, прежде чем что-либо будет считаться готовым.

**Kibitzer. Агент не забывает ни вас, ни вашу работу.** Память хранится в git-репозитории из markdown-файлов.

Небольшая дешёвая модель работает рядом с дорогим основным агентом, читает, что вы делали раньше, и подсказывает ему, прежде чем он повторит ошибку. Вам больше не придётся объяснять всё заново.

**Смешивайте модели, не задумываясь.** Используйте любимые передовые модели вместе с дешёвыми. Просто войдите: `/login` поддерживает подписки Claude, ChatGPT, Kimi и GLM.

У каждой модели есть системный промпт, настроенный специально под неё, так что вы никогда не выберете не ту.

**Качественные навыки, и только нужные.** Ваша модель умна, но всё ещё мало знает о решении реальных задач.

OmO поставляет недостающие знания в виде навыков, включая работу с браузером, и загружает только то, что нужно для задачи.

**Всё остальное тоже продумано.** Независимые вызовы инструментов выполняются вместе в одной небольшой программе, так что двадцать чтений занимают один цикл запроса. Некорректные аргументы инструментов исправляются до запуска.

Ожидание сборки или деплоя работает через подписку, а не через опрос. Долгая работа ведёт журнал проверенного, поэтому перезапущенная сессия продолжает с того места, где остановилась. Конфигурация, навыки и промпты перезагружаются на лету.

## Настройка

Продуманные настройки по умолчанию, которые можно изменить, если очень хочется. Ваши настройки хранятся в `~/.omo/omo.jsonc`, а проект может добавить свой `.omo/omo.jsonc`. Приоритет у ближайшего файла.

Все ключи описаны в [справочнике по конфигурации](docs/reference/configuration.md).

## Документация

- [omo.dev/docs](https://omo.dev/docs)
- [Миграция с OpenCode](docs/guide/migrating-from-opencode.md)
- [Справочник по конфигурации](docs/reference/configuration.md)
- [Возможности](docs/reference/features.md)
- [Манифест Ultrawork](docs/manifesto.md)

## Отзывы

> "It made me cancel my Cursor subscription. Unbelievable things are happening in the open source community." - [Arthur Guiot](https://x.com/arthur_guiot/status/2008736347092382053?s=20)

> "If Claude Code does in 7 days what a human does in 3 months, OmO does it in 1 hour." <br/>- B, Quant Researcher

> "You guys should pull this into core and recruit him. Seriously. It's really, really, really good." <br/>- Henning Kilset

## От автора

Когда мне приходится забирать руль у агента, это не командная работа. Это сбой системы. На этой идее построен OmO.

Вы говорите, что вам нужно. Агент исследует, планирует, пишет код, который не отличить от кода senior-инженера, проверяет его и продолжает, пока не закончит. Он тратит токены, когда это действительно ускоряет работу, а простые части отдаёт дешёвым моделям.

Я самый одержимый пользователь этого проекта. У какой модели самая острая логика? Кто пишет лучшие тексты? Что выпустили другие на этой неделе? Ответы на эти вопросы попадают в OmO. Знаете способ лучше? PR приветствуются.

Цель в том, чтобы агента просто перестаёшь замечать. Щёлкаешь выключателем, и загорается свет. Подробнее об этом в [Манифесте Ultrawork](docs/manifesto.md).

Проект не связан ни с одним из упомянутых проектов или моделей. Идеи Ultragoal и UltraQA взяты из [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) и реализованы для OmO заново, на уровне концепции.

## Пользуются специалисты из

[Indent](https://indentcorp.com), makers of Spray (influencer marketing solution), vovushop (cross-border commerce platform) and vreview (AI commerce review marketing solution). [Google](https://google.com). [Microsoft](https://microsoft.com). [Vercel](https://vercel.com). [ELESTYLE](https://elestyle.jp), makers of elepay (multi-mobile payment gateway) and OneQR (mobile application SaaS for cashless solutions). [Deepgram](https://deepgram.com).
