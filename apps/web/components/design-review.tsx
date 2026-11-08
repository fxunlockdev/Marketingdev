"use client";

import dynamic from "next/dynamic";

// Loaded only by the explicitly enabled local development layout. No remote sync.
const Agentation = dynamic(
  () => import("agentation").then((module) => module.Agentation),
  { ssr: false },
);

export function DesignReview() {
  return <Agentation appName="Desvio design review" enableKeyboardShortcuts={false} />;
}
