import { lazy, StrictMode, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PlayPage } from "@/components/play-page";
import "@/app/globals.css";
import "./native.css";

const ProgressPage = lazy(() =>
  import("@/components/progress-page").then((module) => ({ default: module.ProgressPage })),
);
const RoundDetailPage = lazy(() =>
  import("@/components/round-detail-page").then((module) => ({ default: module.RoundDetailPage })),
);

if (!window.location.hash) {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/play`);
}

function NativeRouter() {
  const pathname = usePathname();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener("backButton", () => {
      if (window.location.hash !== "#/play") {
        window.history.back();
      } else {
        void NativeApp.minimizeApp();
      }
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, []);

  let page = <PlayPage />;
  if (pathname === "/progress") {
    page = <ProgressPage />;
  } else if (pathname.startsWith("/rounds/")) {
    page = <RoundDetailPage roundId={decodeURIComponent(pathname.slice("/rounds/".length))} />;
  }

  return <AppShell><Suspense fallback={null}>{page}</Suspense></AppShell>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NativeRouter />
  </StrictMode>,
);
