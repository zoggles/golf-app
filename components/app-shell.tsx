"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartLineUp, FlagPennant } from "@phosphor-icons/react";
import { useSelectedGolfer } from "@/hooks/use-selected-golfer";
import { GolferGate, GolferSwitcher } from "./golfer-switcher";

const navItems = [
  { href: "/play", label: "Play", icon: FlagPennant },
  { href: "/progress", label: "Progress", icon: ChartLineUp },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The selection lives in the browser, so the server render cannot know it and
  // reads `undefined`. Holding that frame avoids flashing "Who is playing?" at
  // someone who has already chosen.
  const golfer = useSelectedGolfer();

  return (
    <div className="app-frame">
      <header className="topbar">
        <Link className="brand" href="/play" aria-label="Fairway Log home">
          <span className="brand-mark"><FlagPennant size={18} weight="fill" /></span>
          <span>Fairway Log</span>
        </Link>
        <GolferSwitcher />
      </header>
      <main>{golfer === undefined ? null : golfer ? children : <GolferGate />}</main>
      {golfer ? (
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
      ) : null}
    </div>
  );
}
