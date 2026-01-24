"use client"

import { usePathname } from "next/navigation"
import { Link } from "@/i18n/routing"
import { docsConfig } from "@/config/navigation"

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden md:block w-64 border-r bg-background/50">
      <nav className="p-4 space-y-6">
        {docsConfig.sidebarNav.map((section) => (
          <div key={section.title} className="space-y-3">
            <h4 className="font-semibold text-sm text-foreground/80">
              {section.title}
            </h4>
            <ul className="space-y-2">
              {section.items?.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href!}
                    className={`text-sm transition-colors block py-1 px-2 rounded ${
                      pathname === item.href
                        ? "font-semibold text-foreground bg-accent/10"
                        : "text-foreground/60 hover:text-foreground/80"
                    }`}
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
