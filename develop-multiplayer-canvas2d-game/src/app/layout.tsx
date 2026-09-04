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
      <head>
        <script
          defer
          src="https://cloud.umami.is/script.js"
          data-website-id="2736a125-86c8-42bf-9c4a-3284b1bf5dfe"
        />
      </head>
      <body style={{ margin: 0, overflow: "hidden", background: "#0b1016" }}>{children}</body>
    </html>
  );
}
