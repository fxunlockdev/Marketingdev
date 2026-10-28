export type WebsitePage = {
  parserVersion: string;
  url: string;
  sha256: string;
  chunks: { text: string; anchor: string }[];
  links: string[];
  truncated: boolean;
  coverage: "ai_web_research" | "server_html_only" | "rendered_desktop_mobile" | "rendered_provider";
};
export type VisualCapture = {
  version: string;
  url: string;
  coverage: string;
  requests: number;
  failures: { url: string; reason: string }[];
  snapshots: {
    label?: "visible" | "fullpage" | "photo";
    viewport: { width: number; height: number };
    height: number;
    truncated: boolean;
    sha256: string;
    screenshot: string;
    observations: any;
  }[];
};
