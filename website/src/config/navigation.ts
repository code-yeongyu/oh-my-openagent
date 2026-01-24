export type NavItem = {
  title: string
  href?: string
  disabled?: boolean
  external?: boolean
  label?: string
  items?: NavItem[]
}

export type MainNavItem = NavItem

export type SidebarNavItem = NavItem

export interface DocsConfig {
  mainNav: MainNavItem[]
  sidebarNav: SidebarNavItem[]
}

export const docsConfig: DocsConfig = {
  mainNav: [
    {
      title: "Documentation",
      href: "/docs",
    },
    {
      title: "GitHub",
      href: "https://github.com/code-yeongyu/oh-my-opencode",
      external: true,
    },
  ],
  sidebarNav: [
    {
      title: "Getting Started",
      items: [
        {
          title: "Introduction",
          href: "/docs",
          items: [],
        },
        {
          title: "Installation",
          href: "/docs/installation",
          items: [],
        },
      ],
    },
    {
      title: "Configuration",
      items: [
        {
          title: "Overview",
          href: "/docs/config",
          items: [],
        },
        {
          title: "Reference",
          href: "/docs/config/reference",
          items: [],
        },
      ],
    },
    {
      title: "Core Concepts",
      items: [
        {
          title: "Agents",
          href: "/docs/agents",
          items: [],
        },
        {
          title: "Skills",
          href: "/docs/skills",
          items: [],
        },
        {
          title: "Hooks",
          href: "/docs/hooks",
          items: [],
        },
        {
          title: "Tools",
          href: "/docs/tools",
          items: [],
        },
      ],
    },
  ],
}
