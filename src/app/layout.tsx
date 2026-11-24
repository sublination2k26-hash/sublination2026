import type { Metadata } from "next";
import "./globals.css";
import "./theme.css";
import "./responsive.css";
import { AppDialogProvider } from "@/components/ui/app-dialog-provider";
import { RegisterServiceWorker } from "@/components/pwa/register-service-worker";

export const metadata: Metadata = {
  title: "Subli-nation Printing System",
  description: "Manage sublimation orders, payments, and production in one place.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/logo.jpg", apple: "/logo.jpg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AppDialogProvider><RegisterServiceWorker/>{children}</AppDialogProvider></body></html>;
}
