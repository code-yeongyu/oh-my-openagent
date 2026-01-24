"use client"

import * as React from "react"
import { Link } from "@/i18n/routing"
import { docsConfig } from "@/config/navigation"
import { motion } from "framer-motion"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

interface MobileNavProps {
  open: boolean
  setOpen: (open: boolean) => void
}

export function MobileNav({ open, setOpen }: MobileNavProps) {
  const pathname = usePathname()

  React.useEffect(() => {
    if (pathname) {
      setOpen(false)
    }
  }, [pathname, setOpen])

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 top-14 z-50 grid h-[calc(100vh-3.5rem)] grid-flow-row auto-rows-max overflow-auto p-6 pb-32 shadow-md md:hidden bg-background"
    >
      <div className="relative z-20 grid gap-6 rounded-md bg-popover p-4 text-popover-foreground shadow-md">
        <Link href="/" className="flex items-center space-x-2">
          <span className="font-bold">Oh My OpenCode</span>
        </Link>
        <nav className="grid grid-flow-row auto-rows-max text-sm">
          {docsConfig.mainNav.map((item) => (
            <Link
              key={item.href}
              href={item.disabled ? "#" : item.href!}
              className={cn(
                "flex w-full items-center rounded-md p-2 text-sm font-medium hover:underline",
                item.disabled && "cursor-not-allowed opacity-60"
              )}
            >
              {item.title}
            </Link>
          ))}
          {docsConfig.sidebarNav.map((item) => (
            <div key={item.title} className="flex flex-col space-y-3 pt-6">
              <h4 className="font-medium">{item.title}</h4>
              {item.items?.map((subItem) => (
                <Link
                  key={subItem.href}
                  href={subItem.href!}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {subItem.title}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </div>
    </motion.div>
  )
}
