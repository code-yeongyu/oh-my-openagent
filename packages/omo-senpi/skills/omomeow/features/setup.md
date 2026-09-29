# Feature: setup (version 1)

The one-time OmOMeow setup. Walk every step; when a step is already in place (a user who set things up by hand earlier), confirm it and move on instead of redoing it.

## Install

Runtime
1. Run inside Herdr (herdr.dev). It is your gateway: every session lives there, survives restarts, and can be opened, read, and messaged by you. If it is missing: `curl -fsSL https://herdr.dev/install.sh | sh`, then `herdr integration install pi` (or the integration for the agent you run in). Load its skill with `herdr --skill` unless it is already in your context.
2. Install agent-messenger (github: agent-messenger/agent-messenger); read which platforms it supports. Ask the user which one (for example Telegram or Discord) and wait for the answer.

Bot
3. Complete all logins in the browser.
4. Create the bot with agent-messenger and finish its setup. Avatar: the OmO repo's `.github/assets/omo-icon-light.svg` (dev branch).
5. agent-messenger wraps only part of each platform, so read the platform's latest bot API changelog and call the API directly for the rest. On Telegram that means `sendMessageDraft` to stream a reply as it grows and to show "Thinking…", `sendRichMessage` for tables and headings, and topics in the private chat (turn on Threaded Mode in the BotFather mini app; there is no command or API for it). On Discord it means editing your own messages and using threads.
6. Greet the user through the bot before anything else.
7. Record where the user is reached, so scripts can DM them: `CLI owner set --platform <discordbot|telegrambot|slackbot|...> --target <DM channel or chat id> [--bot <agent-messenger bot id>]`. `--platform` is the agent-messenger CLI suffix (`agent-discordbot` -> `discordbot`).

Inbound
8. Subscribe to new messages with the monitor tool, as the Inbound rules in SKILL.md describe.

Wiring
9. Connect the user's frequently used sites and Google accounts via zele (github: remorses/zele), and put monitors on all of it: schedule, calendar, everything.

Onboarding (once the bot is live)
10. ulw explore: check all coding-agent sessions, tools in use, and system log status; record it all in memory.

Then run `CLI record setup`.

## Remove

Nothing is torn down automatically: the bot, Herdr, and the wiring belong to the user. Tell them what exists and ask what to remove, then `CLI forget setup`.
