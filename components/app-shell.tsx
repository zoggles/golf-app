"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartLineUp, FlagPennant } from "@phosphor-icons/react";
import { useAuth } from "@/hooks/use-auth";
import { useSelectedGolfer } from "@/hooks/use-selected-golfer";
import { AccountGate, GolferSwitcher } from "./golfer-switcher";

const navItems = [
  { href: "/play", label: "Play", icon: FlagPennant },
  { href: "/progress", label: "Progress", icon: ChartLineUp },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session } = useAuth();
  const golfer = useSelectedGolfer();
  const ready = Boolean(session && golfer && golfer.accountId === session.user.id);
  const deletionPage = pathname === "/delete-account";

  return (
    <div className="app-frame">
      <header className="topbar">
        <Link className="brand" href="/play" aria-label="Caddy Stack home">
          <span className="brand-mark"><FlagPennant size={18} weight="fill" /></span>
          <span>Caddy Stack</span>
        </Link>
        <GolferSwitcher />
      </header>
      <main>{deletionPage ? children : session === undefined || golfer === undefined ? null : ready ? children : <AccountGate />}</main>
      {ready && !deletionPage ? (
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
