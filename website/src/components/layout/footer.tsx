export function Footer() {
  return (
    <footer className="border-t bg-background/50">
      <div className="container py-8 px-4 md:px-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-sm text-foreground/60">
            © 2026 Oh My OpenCode. All rights reserved.
          </div>
          <div className="text-sm text-foreground/60">
            Built with ❤️ for developers
          </div>
        </div>
      </div>
    </footer>
  )
}
