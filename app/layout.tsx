import type { Metadata, Viewport } from "next";
import { Manrope, Baloo_2, Nunito } from "next/font/google";
import "./globals.css";
import { NAME, brandCss } from "@/lib/whitelabel";

const manrope = Manrope({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-manrope", display: "swap" });
const baloo = Baloo_2({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-baloo", display: "swap" });
const nunito = Nunito({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-nunito", display: "swap" });

export const metadata: Metadata = {
  title: NAME,
  description: `${NAME} gets local service businesses more Google reviews.`,
  icons: { icon: "/favicon.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${baloo.variable} ${nunito.variable}`}>
      <body className="min-h-dvh">
        <style>{brandCss()}</style>
        {children}
      </body>
    </html>
  );
}
