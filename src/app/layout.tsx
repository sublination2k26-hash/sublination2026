import type { Metadata } from "next";
import "./globals.css";
import "./theme.css";
import "./responsive.css";

export const metadata: Metadata = {
  title: "Subli-nation Printing System",
  description: "Manage sublimation orders, payments, and production in one place.",
  icons: { icon: "/logo.jpg", apple: "/logo.jpg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
