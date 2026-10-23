[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [Русский](README.ru.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-br.md) | [Italiano](README.it.md)

> [!NOTE]
> **OmO 5.0: OmO ❤️ Pi**
> Instálalo con `curl -fsSL https://get.omo.dev/install.sh | bash`. Sistema de memoria, CodeMode, suscripciones de Anthropic, todo incluido.
> [![OmO Herdr DAG - DAGs de flujo de trabajo de OmO en vivo en un panel lateral de Herdr](./.github/assets/omo-herdr-dag.png)](https://github.com/jc01rho/omo-herdr-dag)
> *Solo escribe "mass ulw" con tu prompt - ahora eres el maestro de la ingeniería de grafos. ultracode multimodelo, junto con un mejor sistema de memoria. (El panel derecho es [omo-herdr-dag](https://github.com/jc01rho/omo-herdr-dag).)*

> **Patrocinadores**
> Estos son nuestros patrocinadores. Ayudan a mantener OmO en marcha como un proyecto personal paralelo.
> | [<img alt="OpenGateway" src="./.github/assets/opengateway-logo.svg" width="156px" />](https://opengateway.ai/) | **[OpenGateway](https://opengateway.ai/)** patrocina a OmO. Un gateway compatible con OpenAI que reúne a muchos proveedores de modelos detrás de una sola API. Gracias por apoyar el código abierto. |
> | :-----| :----- |


> [!NOTE]
>
> [![Sisyphus Labs - Conoce a Dori. No es una demo. Se suscribe a todo.](./.github/assets/sisyphuslabs.png?v=4)](https://sisyphuslabs.ai)
> > **OmO es mantenido por Jobdori, el asistente de IA que se muestra arriba. Conoce a tu propio Jobdori, Dori. <br />Únete a la lista de espera [aquí](https://sisyphuslabs.ai).**

> [!TIP]
> ¡Acompáñanos!
>
> | [<img alt="Discord link" src="https://img.shields.io/discord/1452487457085063218?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=flat-square" width="156px" />](https://discord.gg/PUwSMR9XNk) | Únete a nuestra [comunidad de Discord](https://discord.gg/PUwSMR9XNk) para conectar con colaboradores y otros usuarios de OmO. |
> | :-----| :----- |
> | [<img alt="X link" src="https://img.shields.io/badge/Follow-%40justsisyphus-00CED1?style=flat-square&logo=x&labelColor=black" width="156px" />](https://x.com/justsisyphus) | Las novedades de OmO solían publicarse en mi cuenta de X. <br /> Como fue suspendida por error, ahora [@justsisyphus](https://x.com/justsisyphus) publica las novedades en mi nombre. |
> | [<img alt="GitHub Follow" src="https://img.shields.io/github/followers/code-yeongyu?style=flat-square&logo=github&labelColor=black&color=24292f" width="156px" />](https://github.com/code-yeongyu) | Sigue a [@code-yeongyu](https://github.com/code-yeongyu) en GitHub para ver más proyectos. |

<!-- <CENTERED SECTION FOR GITHUB DISPLAY> -->

<div align="center">

<a href="https://omo.dev"><img src="./.github/assets/omo-icon-light.svg" alt="OmO" width="200" /></a>

# OmO

**Tu herramienta para el trabajo real. Pero es un agente.**

[![GitHub Release](https://img.shields.io/github/v/release/code-yeongyu/oh-my-openagent?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/releases)
[![downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fomo.dev%2Fapi%2Fdownloads&style=flat-square)](https://omo.dev)
[![GitHub Contributors](https://img.shields.io/github/contributors/code-yeongyu/oh-my-openagent?color=c4f042&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/graphs/contributors)
[![GitHub Stars](https://img.shields.io/github/stars/code-yeongyu/oh-my-openagent?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/stargazers)
[![License](https://img.shields.io/badge/license-SUL--1.0-white?labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/LICENSE.md)
[![Docs](https://img.shields.io/badge/docs-omo.dev-369eff?labelColor=black&logo=readthedocs&logoColor=white&style=flat-square)](https://omo.dev/docs)


</div>

<!-- </CENTERED SECTION FOR GITHUB DISPLAY> -->

OmO es un único comando `omo` que convierte tus tokens en trabajo terminado: investigación en diez mil fuentes, una presentación que la gente realmente entiende, backends, frontends, código. Funciona sobre senpi, nuestro fork de [pi](https://github.com/badlogic/pi-mono), con todo lo que sigue integrado.

## Instalación

```bash
curl -fsSL https://get.omo.dev/install.sh | bash
omo
```

En Windows, en PowerShell: `irm https://get.omo.dev/install.ps1 | iex`. El script instala el binario nativo de `omo` para tu sistema operativo y CPU en `~/.local/bin`, lo verifica contra las sumas de comprobación de la versión y recurre a GitHub Releases cuando el espejo no está disponible. Agrega `-s -- beta` (o una versión como `-s -- 5.1.1`) después de `bash` para elegir otro canal. El uso de CMD en Windows, cómo corregir tu `PATH`, la actualización y la desinstalación se explican en [omo.dev/docs/install](https://omo.dev/docs/install).

¿Prefieres un gestor de paquetes? `bun add -g omo-ai` (o `npm i -g omo-ai`) instala el mismo OmO. El paquete es `omo-ai`; el paquete `omo` en npm no tiene relación y pertenece a otra persona.

Abre tu proyecto, ejecuta `omo` y describe la tarea. Esa es toda la configuración.

En una sesión, `/thinking <level>` define qué tanto piensa el modelo (`/thinking` por sí solo abre un selector), `Shift+Tab` alterna entre los niveles y `/efforts <level>` ajusta directamente el esfuerzo de razonamiento en los modelos con grados de esfuerzo. Para retomar un trabajo anterior, `/resume` (o `/sessions`) abre tus sesiones pasadas; desde la terminal, `omo -c` continúa la última y `omo -r` abre el selector. `/help` muestra todo lo demás.

¿Vienes de la edición de OpenCode o de LazyCodex? Ejecuta `omo setup` una vez. Transfiere tus claves de proveedor, proveedores personalizados, servidores MCP, skills y selecciones de modelos. Luego, `omo doctor` muestra qué categorías de tareas pueden ejecutar tus proveedores y qué quedó de la instalación anterior. La guía completa está en [Migración desde OpenCode](docs/guide/migrating-from-opencode.md).

Para actualizar, vuelve a ejecutar la línea de instalación (una instalación mediante gestor de paquetes se actualiza con `omo update`). `rm ~/.local/bin/omo` elimina la instalación del binario; `bun remove -g omo-ai` (o `npm uninstall -g omo-ai`) elimina la instalación del paquete.

## Por qué OmO

**ultrawork.** Olvídate de estudiar. Si una tarea parece difícil, añade `ultrawork` (o `ulw`) a tu prompt. El agente lee el código base antes de tocar una sola línea, planifica, comprueba cada paso antes de avanzar, verifica el resultado en la superficie real y se detiene cuando termina.

**Cientos de agentes, una palabra clave.** Escribe `mass ulw` y todo el trabajo se convierte en un grafo de agentes: investigación profunda sobre miles de fuentes, un pipeline completo de machine learning, una migración que nadie quiere hacer. Cada parte se ejecuta en el modelo que mejor se adapta, en paralelo, y se verifica antes de dar algo por terminado.

**Kibitzer. Tu agente no se olvida de ti ni de tu trabajo.** La memoria vive en un repositorio git de archivos markdown. Un modelo pequeño y económico acompaña al costoso agente principal, lee lo que has hecho antes y avisa al agente principal antes de que repita un error. Dejas de explicarte una y otra vez.

**Combina modelos sin pensarlo.** Usa los modelos de frontera que te encantan junto con los económicos. Solo inicia sesión: `/login` cubre las suscripciones de Claude, ChatGPT, Kimi y GLM. Cada modelo viene con un prompt de sistema ajustado a su medida, para que nunca elijas el equivocado.

**Skills de alta calidad, solo las que necesitas.** Tu modelo es inteligente, pero aún no sabe mucho sobre cómo resolver problemas del mundo real. OmO incluye ese conocimiento faltante en forma de skills, incluido el uso del navegador, y carga solo lo que la tarea necesita.

**Todo lo demás está cuidado al detalle.** Las llamadas independientes a herramientas se ejecutan juntas en un pequeño programa, por lo que veinte lecturas son un solo viaje de ida y vuelta. Los argumentos mal formados de las herramientas se reparan antes de ejecutarse. Esperar una compilación o un despliegue es una suscripción, no polling. Los trabajos largos guardan un registro de lo que se verificó, para que una sesión reiniciada retome donde se quedó. La configuración, las skills y los prompts se recargan en vivo.

## Configuración

Valores por defecto con criterio propio, ajustables si insistes. Tus ajustes viven en `~/.omo/omo.jsonc`, y un proyecto puede agregar su propio `.omo/omo.jsonc`; el archivo más cercano gana. Todas las claves están en la [referencia de configuración](docs/reference/configuration.md).

## Documentación

- [omo.dev/docs](https://omo.dev/docs)
- [Migración desde OpenCode](docs/guide/migrating-from-opencode.md)
- [Referencia de configuración](docs/reference/configuration.md)
- [Características](docs/reference/features.md)
- [Uso de la computadora](docs/guide/computer-use.md) (experimental)
- [Manifiesto Ultrawork](docs/manifesto.md)

## Reseñas

> "Me hizo cancelar mi suscripción a Cursor. Están pasando cosas increíbles en la comunidad de código abierto." - [Arthur Guiot](https://x.com/arthur_guiot/status/2008736347092382053?s=20)

> "Si Claude Code hace en 7 días lo que un humano hace en 3 meses, OmO lo hace en 1 hora." <br/>- B, Investigador cuantitativo

> "Deberían integrar esto en el core y contratarlo. En serio. Es muy, muy, muy bueno." <br/>- Henning Kilset

## Nota del autor

Cuando tengo que quitarle el volante a un agente, eso no es trabajo en equipo. El sistema falló. OmO se construyó sobre esa idea. Dices lo que quieres; el agente investiga, planifica, escribe código que no podrías distinguir del de un ingeniero sénior, lo verifica y sigue adelante hasta terminar. Gasta tokens cuando compran velocidad real y dirige las partes fáciles a modelos baratos.

Soy el usuario más obsesivo de este proyecto. ¿Qué modelo tiene la lógica más aguda? ¿Quién escribe la mejor prosa? ¿Qué lanzaron los demás esta semana? OmO es donde aterrizan esas respuestas. ¿Tienes una mejor manera? Los PRs son bienvenidos.

El objetivo es un agente que dejas de notar. Accionas el interruptor, la luz se enciende. La versión larga es el [Manifiesto Ultrawork](docs/manifesto.md).

Sin afiliación con ningún proyecto o modelo mencionado. Las ideas de Ultragoal y UltraQA vienen de [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex), reimplementadas desde el concepto para OmO.

## Preferido por profesionales en

[Indent](https://indentcorp.com), creadores de Spray (solución de marketing de influencers), vovushop (plataforma de comercio transfronterizo) y vreview (solución de marketing de reseñas con IA para comercio). [Google](https://google.com). [Microsoft](https://microsoft.com). [Vercel](https://vercel.com). [ELESTYLE](https://elestyle.jp), creadores de elepay (pasarela de pagos multimóvil) y OneQR (SaaS de aplicaciones móviles para soluciones sin efectivo). [Deepgram](https://deepgram.com).
