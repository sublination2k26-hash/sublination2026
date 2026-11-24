import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard",
    name: "Subli-Nation Printing System",
    short_name: "Subli-Nation",
    description: "Manage sublimation orders, payments, and production in one place.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f6f8fc",
    theme_color: "#2563eb",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/logo.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
