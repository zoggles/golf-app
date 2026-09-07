"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartLineUp, FlagPennant, WifiSlash } from "@phosphor-icons/react";

const navItems = [
  { href: "/play", label: "Play", icon: FlagPennant },
  { href: "/progress", label: "Progress", icon: ChartLineUp },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-frame">
      <header className="topbar">
        <Link className="brand" href="/play" aria-label="Fairway Log home">
          <span className="brand-mark"><FlagPennant size={18} weight="fill" /></span>
          <span>Fairway Log</span>
        </Link>
        <div className="local-pill" title="Your round history is stored in this browser">
          <WifiSlash size={14} />
          <span>Local-first</span>
        </div>
      </header>
      <main>{children}</main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} className={active ? "nav-item active" : "nav-item"} aria-current={active ? "page" : undefined}>
              <Icon size={22} weight={active ? "fill" : "regular"} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
