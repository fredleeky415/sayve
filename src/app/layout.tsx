import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sayve",
  description: "Sayve is an AI Native Family Financial Memory"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
