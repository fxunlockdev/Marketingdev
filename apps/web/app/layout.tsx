import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Desvio · Your brand workspace",
  description: "A focused home for your clients, brands and creative work.",
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
        {children}
      </body>
    </html>
  );
}
