import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Matchwinners Composer",
  description:
    "Editor für LED-Banden: Quellen, Playlists und Overlays visuell konfigurieren – mit automatischem Placement.",
  icons: {
    icon: [
      { url: "/favicon.ico" },                     // Fallback / Standard
      { url: "/icon.png", type: "image/png", sizes: "32x32" }, // PNG
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180" },      // optional
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}