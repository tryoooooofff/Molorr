import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Petalia.io — canvas florr-like arena",
  description: "Garden, Desert and Ocean arenas rendered entirely in canvas2d.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, overflow: "hidden", background: "#0b1016" }}>{children}</body>
    </html>
  );
}
