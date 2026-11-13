/** Customer-facing names for researched brand facts (app.brand_facts.field). */
const FACT_LABELS: Readonly<Record<string, string>> = {
  brand_name: "Business name",
  offering: "What you offer",
  audience: "Who you serve",
  voice: "Brand voice",
  colors: "Brand colours",
  prohibited_claims: "Claims to avoid",
  positioning: "What makes you different",
  cta: "What people should do next",
  fonts: "Brand fonts",
  products: "Products or services",
};

/** The label for a fact field; unknown fields fall back to sentence case. */
export function factLabel(field: string): string {
  const known = FACT_LABELS[field];
  if (known) return known;
  const words = field.replaceAll("_", " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
