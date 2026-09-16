import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Caddy Stack",
    short_name: "Caddy Stack",
    description: "A voice-friendly golf round tracker and personal performance dashboard.",
    start_url: "/",
    display: "standalone",
    background_color: "#08110c",
    theme_color: "#0b1711",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
