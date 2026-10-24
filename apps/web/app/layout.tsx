import {Desvio} from "../components/desvio";
import type { Metadata } from "next";
import "./globals.css";
import "./v5.css";
import "./studio.css";
export const metadata: Metadata = {
  title: "Desvio · Your businesses, beautifully connected",
  description: "Your businesses, brand knowledge and creative work in one place.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Desvio />
        {children}
      </body>
    </html>
  );
}
