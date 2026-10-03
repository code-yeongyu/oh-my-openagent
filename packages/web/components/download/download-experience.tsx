"use client"

import type { JSX } from "react"
import { useState } from "react"
import { useFormatter, useLocale, useTranslations } from "next-intl"

import { InstallerList } from "@/components/download/installer-list"
import { PrimaryDownload } from "@/components/download/primary-download"
import { useDesktopVisitor } from "@/components/download/use-desktop-visitor"
import { VerifyDownload } from "@/components/download/verify-download"
import { Eyebrow } from "@/components/ledger/eyebrow"
import { Frame } from "@/components/ledger/frame"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import {
  chooseInstallers,
  type ChannelState,
  type DesktopChannel,
  type DesktopOs,
  type DesktopRelease,
  type InstallerChoice,
} from "@/lib/desktop-download"
import { cn } from "@/lib/utils"

export interface DownloadExperienceProps {
  readonly channels: Readonly<Record<DesktopChannel, ChannelState>>
  readonly initialChannel: DesktopChannel
}

const CHANNELS: readonly DesktopChannel[] = ["stable", "beta"]

function CommandLineFallback({ kind }: { readonly kind: "coming" | "unavailable" }): JSX.Element {
  const t = useTranslations(`download.${kind}`)
  return (
    <Link href="/docs/install" className="text-accent underline-grow inline-block">
      {t("cli")}
    </Link>
  )
}

function ChannelSwitch({
  channel,
  onSelect,
}: {
  readonly channel: DesktopChannel
  readonly onSelect: (channel: DesktopChannel) => void
}): JSX.Element {
  const t = useTranslations("download.channel")
  return (
    <div role="group" aria-label={t("label")} className="border-line inline-flex border">
      {CHANNELS.map((option) => (
        <Button
          key={option}
          variant="ghost"
          size="sm"
          aria-pressed={channel === option}
          onClick={() => onSelect(option)}
          className={cn("rounded-none", channel === option && "bg-accent-8 text-accent")}
        >
          {t(option)}
        </Button>
      ))}
    </div>
  )
}

function fileNameFor(
  os: DesktopOs,
  release: DesktopRelease,
  choice: InstallerChoice | null,
): string {
  const installer =
    choice?.primary?.os === os
      ? choice.primary
      : chooseInstallers(release, { os, arch: null, device: "computer" }).primary
  return installer?.fileName ?? "<installer>"
}

function ReleaseBody({ release }: { readonly release: DesktopRelease }): JSX.Element {
  const t = useTranslations("download")
  const visitor = useDesktopVisitor()
  const choice = visitor === null ? null : chooseInstallers(release, visitor)
  const listed = release.installers
  const fileNames = {
    macos: fileNameFor("macos", release, choice),
    windows: fileNameFor("windows", release, choice),
    linux: fileNameFor("linux", release, choice),
  }

  return (
    <>
      <PrimaryDownload release={release} visitor={visitor} choice={choice} />
      <section aria-labelledby="all-downloads" className="mt-16">
        <h2 id="all-downloads" className="type-heading text-text-hi mb-6">
          {t("all.title")}
        </h2>
        <InstallerList installers={listed} />
      </section>
      <section className="mt-16">
        <VerifyDownload fileNames={fileNames} checksumsUrl={release.checksumsUrl} />
      </section>
    </>
  )
}

export function DownloadExperience({
  channels,
  initialChannel,
}: DownloadExperienceProps): JSX.Element {
  const t = useTranslations("download")
  const locale = useLocale()
  const format = useFormatter()
  const [channel, setChannel] = useState<DesktopChannel>(initialChannel)
  const state = channels[channel]
  const launched = channels.stable.status === "ready" && channels.beta.status === "ready"

  return (
    <Frame as="section" aria-labelledby="download-title" innerClassName="py-16 lg:py-24">
      <Eyebrow rule dot={state.status === "ready" ? "ok" : undefined}>
        {t("eyebrow")}
      </Eyebrow>
      <h1 id="download-title" className="type-title text-text-hi mt-5 max-w-3xl">
        {t("title")}
      </h1>
      <p className="text-text-mid prose-cjk mt-5 max-w-2xl text-lg leading-[1.7]">{t("lead")}</p>
      {launched ? (
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <ChannelSwitch channel={channel} onSelect={setChannel} />
          {channel === "beta" ? (
            <p className="text-text-lo text-sm">{t("channel.betaNote")}</p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-10" lang={locale} data-state={state.status}>
        {state.status === "ready" ? <ReleaseBody release={state.release} /> : null}
        {state.status === "coming" ? (
          <div className="border-line bg-ink-1 border p-6 lg:p-8">
            <h2 className="type-heading text-text-hi">
              {t("coming.title", {
                date: format.dateTime(new Date(state.launchAt), {
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                }),
              })}
            </h2>
            <p className="text-text-mid mt-3 max-w-xl leading-[1.6]">{t("coming.body")}</p>
            <div className="mt-6">
              <CommandLineFallback kind="coming" />
            </div>
          </div>
        ) : null}
        {state.status === "unavailable" ? (
          <div className="border-line bg-ink-1 border p-6 lg:p-8">
            <h2 className="type-heading text-text-hi">{t("unavailable.title")}</h2>
            <p className="text-text-mid mt-3 max-w-xl leading-[1.6]">{t("unavailable.body")}</p>
            <div className="mt-6">
              <CommandLineFallback kind="unavailable" />
            </div>
          </div>
        ) : null}
      </div>
      <section className="mt-16">
        <h2 className="type-heading text-text-hi">{t("supported.title")}</h2>
        <ul className="text-text-mid mt-4 space-y-2">
          <li>{t("supported.macos")}</li>
          <li>{t("supported.windows")}</li>
          <li>{t("supported.linux")}</li>
        </ul>
      </section>
    </Frame>
  )
}
