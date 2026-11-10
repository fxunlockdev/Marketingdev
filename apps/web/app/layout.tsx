import {Desvio} from "../components/desvio";
import {DesignReview} from "../components/design-review";
import type { Metadata } from "next";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import {DesignSystem} from "../components/design-system";
import "./globals.css";
import "./v5.css";
import "./studio.css";
import "./redesign.css";
import "./product-polish.css";
import "./design-system.css";
import "./website-brand.css";
export const metadata: Metadata = {
  title: "Desvio · Your businesses, beautifully connected",
  description: "Your businesses, brand knowledge and creative work in one place.",
  icons: { icon: "/site-brand/favicon.svg" },
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" data-astryx-theme="neutral">
      <body className="desvio-redesign desvio-polished">
        <DesignSystem>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Desvio />
        {children}
        {process.env.NODE_ENV === "development" && process.env.DESVIO_DESIGN_REVIEW === "true" && <DesignReview />}
        </DesignSystem>
      </body>
    </html>
  );
}
