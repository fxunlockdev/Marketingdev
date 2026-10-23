"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Notice } from "./primitives";
import {BrandReferences} from "./brand-references";
import { PrivateVisual } from "./private-visual";
const active = (j: any) => ["queued", "running", "retrying"].includes(j.status);
const messages: Record<string, string> = {
  AI_NOT_CONFIGURED:
    "AI setup is still needed. Your website evidence is saved; you can review it or add facts below.",
  AI_STAGING_APPROVAL_REQUIRED:
    "AI testing has not been enabled for this business yet. Your evidence is saved.",
  AI_VISION_APPROVAL_REQUIRED:
    "Your website captures are saved. Visual AI analysis still needs an approved model and image budget.",
  AI_BUDGET_EXHAUSTED:
    "The approved AI budget has been reached. Your saved work is safe.",
  AI_EVIDENCE_CHANGED:
    "Your brand changed during analysis. Review your latest evidence before running it again.",
  AI_SUBMISSION_UNKNOWN:
    "We could not confirm the model response. This request will not be repeated automatically.",
  AI_SUBMISSION_REQUIRES_REVIEW:
    "This model request needs an operator check before it can be safely repeated.",
  WEBSITE_ROBOTS_DISALLOWED:
    "This website asks crawlers not to read this page. You can upload brand documents instead.",
  WEBSITE_ADDRESS_BLOCKED:
    "This address cannot be safely accessed. Use your public business website.",
  WEBSITE_PARSER_NOT_CONFIGURED:
    "Website processing still needs to be configured.",
  WEBSITE_NO_CONTENT:
    "We could not find readable page text. Upload guidelines or add the missing facts below.",
};
export function BrandIntake({
  business,
  onComplete,
}: {
  business: {
    id: string;
    website: string | null;
    role: string;
    revision: number;
  };
  onComplete: () => void;
}) {
  const [state, setState] = useState<any>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const latest = useRef(onComplete),
    completed = useRef(""),
    requestKey = useRef(""),
    requestKind = useRef("");
  latest.current = onComplete;
  const path = `/api/v1/businesses/${business.id}/intake`,
    writable = ['owner','admin','editor'].includes(business.role),
    watch = !state || state.jobs.some(active);
  useEffect(() => {
    let live = true,
      inflight = false;
    async function poll() {
      if (inflight) return;
      inflight = true;
      try {
        const next = await api(path);
        if (!live) return;
        setState(next);
        const website = next.jobs.find(
          (j: any) => j.kind === "website.extract",
        );
        if (
          writable &&
          business.website &&
          !website &&
          !next.jobs.some(active)
        ) {
          await api(
            path,
            { kind: "website.extract" },
            "POST",
            `initial-website-${business.id}-${business.revision}`,
          );
          if (live) setState(await api(path));
        } else if (
          writable &&
          website?.status === "succeeded" &&
          !next.jobs.some(active) &&
          !next.jobs.some(
            (j: any) =>
              j.kind === "brand.analyze" && j.created_at >= website.created_at,
          )
        ) {
          await api(
            path,
            { kind: "brand.analyze" },
            "POST",
            `analyze-website-${website.id}`,
          );
          if (live) setState(await api(path));
        }
        const done = next.jobs
          .filter((j: any) => !active(j))
          .map((j: any) => `${j.id}:${j.status}`)
          .join(",");
        if (done !== completed.current) {
          completed.current = done;
          latest.current();
        }
      } catch (e) {
        if (live) setError(e);
      } finally {
        inflight = false;
      }
    }
    void poll();
    const timer = watch ? setInterval(poll, 2500) : undefined;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [business.id, business.website, business.revision, writable, path, watch]);
  async function start(kind: string) {
    setBusy(true);
    setError(undefined);
    // Keep the same key after a lost response; a confirmed response permits a new explicit request.
    if (!requestKey.current || requestKind.current !== kind) {
      requestKey.current = crypto.randomUUID();
      requestKind.current = kind;
    }
    try {
      await api(path, { kind }, "POST", requestKey.current);
      requestKey.current = "";
      setState(await api(path));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const pending = state?.jobs.some(active),
    recent = state?.jobs[0],
    visualAnalysis = state?.jobs.find(
      (j: any) =>
        j.kind === "brand.analyze" &&
        j.status === "succeeded" &&
        j.result?.visual_guidance?.length,
    ),
    visualAnalysisStale =
      visualAnalysis &&
      (state.visuals.some((v:any)=>v.captured_at > visualAnalysis.updated_at) || state.jobs.some(
        (j: any) =>
          j.kind === "website.extract" &&
          j.status === "succeeded" &&
          j.updated_at > visualAnalysis.updated_at,
      ));
  return (
    <section className="v5-panel" aria-busy={busy || !!pending}>
      <h2>Let Desvio get to know your business.</h2>
      <p>
        {business.website
          ? "We study your website’s content and visual design, then prepare brand facts and suggested goals for your review."
          : "Add your brand documents or a few facts, then let AI prepare your direction."}
      </p>
      <Notice error={error} />
      <p role="status">
        {pending
          ? "Reading your evidence and preparing your brand…"
          : recent?.status === "succeeded"
            ? "Your latest analysis is saved. Review the evidence below."
            : recent?.error_code
              ? (messages[recent.error_code] ??
                "This analysis could not finish. Your saved work is safe; you can use documents or manual facts.")
              : business.website
                ? "Preparing to read your website…"
                : "Ready when your evidence is added."}
      </p>
      {state?.jobs
        .filter((j: any) => j.kind === "website.extract" && j.result)
        .slice(0, 1)
        .map((j: any) => (
          <details key={j.id}>
            <summary>
              Website coverage · {j.result.pages?.length ?? 0} pages
            </summary>
            <p>
              {j.result.coverage === "rendered_desktop_mobile"
                ? "Desktop and mobile pages rendered. Visual references are observations for your review, not approved brand rules."
                : "Visual capture is incomplete. Available text is saved; some design references still need review."}
            </p>
            <ul>
              {j.result.pages?.map((url: string) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
            {j.result.skipped?.length > 0 && (
              <p>{j.result.skipped.length} pages could not be read.</p>
            )}
          </details>
        ))}
      {state?.visuals?.length > 0 && (
        <details>
          <summary>
            Explore your brand’s visual sources · {state.visuals.length}{" "}
            captures
          </summary>
          <p>
            Use these as source references for brand identity and creative
            inspiration. Logo and image matches are candidates until you confirm
            them.
          </p>
          {state.visuals.map((v: any) => (
            <article key={v.id} id={"visual-" + v.id} className="v5-panel">
              <h3>
                {v.viewport === "upload" ? "Product photo" : v.document_page ? `Document page ${v.document_page}` : v.viewport === "desktop" ? "Desktop" : "Mobile"} ·{" "}
                {v.viewport === "upload" ? "Private upload" : v.document_page ? "Uploaded guideline" : v.observations.title || "Website reference"}
              </h3>
              {!v.document_page && v.viewport!=="upload" && <a href={v.website_url} target="_blank" rel="noopener noreferrer">
                Open source page
              </a>}
              <p>
                {v.width} × {v.height} pixels
                {v.coverage.truncated ? " · height capped" : ""}.{" "}
                {!v.document_page && v.viewport!=="upload" && <>{v.coverage.resourceFailures.length} resources could not be captured.</>}
              </p>
              {!v.document_page && v.viewport!=="upload" && <><p>
                Observed fonts:{" "}
                {[
                  ...new Set(
                    v.observations.typography.map((f: any) => f.family),
                  ),
                ]
                  .slice(0, 5)
                  .join(", ")}
              </p>
              <p>
                Image references:{" "}
                {v.observations.images.filter((i: any) => i.loaded).length}{" "}
                loaded;{" "}
                {
                  v.observations.images.filter(
                    (i: any) => i.role === "logo_candidate",
                  ).length
                }{" "}
                logo candidates.
              </p></>}
              <PrivateVisual businessId={business.id} visualId={v.id}
                label={`View ${v.document_page ? `document page ${v.document_page}` : `${v.viewport} capture`}`}
                alt={v.viewport === "upload" ? "Uploaded product photo" : v.document_page ? `Uploaded guideline page ${v.document_page}` : `${v.viewport} capture of ${v.website_url}`}/>
            </article>
          ))}
        </details>
      )}
      <button type="button" disabled={busy} onClick={()=>{setError(undefined);void api(path).then(setState).catch(setError);}}>Refresh image sources</button>
      {!!state?.visuals?.length && <BrandReferences businessId={business.id} writable={writable} sources={state.visuals}/>}
      {visualAnalysis && (
        <details>
          <summary>Visual style & creative inspiration</summary>
          <p>
            AI suggestions based on your captured pages. These are references
            for review; they do not change your approved brand rules or approve
            images for reuse.
          </p>
          {visualAnalysisStale && (
            <p role="status">
              Your source evidence has changed since these suggestions. Run
              analysis again to update them.
            </p>
          )}
          {visualAnalysis.result.visual_coverage?.limited && <p role="status">Visual analysis covered {visualAnalysis.result.visual_coverage.document_pages_analyzed.length} of {visualAnalysis.result.visual_coverage.document_pages_available} saved document pages. The remaining page visuals have not been analyzed.</p>}
          {visualAnalysis.result.visual_guidance.map(
            (g: any, index: number) => (
              <article key={index} className="v5-panel">
                <h3>
                  {
                    (
                      {
                        composition: "Layout & composition",
                        imagery: "Photography & illustration",
                        typography: "Typography",
                        palette: "Colour relationships",
                        logo_candidate: "Possible brand marks",
                        creative_inspiration: "Creative direction",
                      } as Record<string, string>
                    )[g.category]
                  }
                </h3>
                <p>
                  <strong>Observed:</strong> {g.observation}
                </p>
                <p>
                  <strong>Suggested direction:</strong> {g.creative_direction}
                </p>
                <ul aria-label="Supporting visual references">
                  {g.image_ids.map((id: string) => {
                    const reference =
                      visualAnalysis.result.visual_manifest.find(
                        (v: any) => v.id === id,
                      );
                    if (!reference) return null;
                    return (
                      <li key={id}>
                        {state.visuals.some(
                          (v: any) => v.id === reference.visual_id,
                        ) ? (
                          <a
                            href={"#visual-" + reference.visual_id}
                            onClick={() => {
                              document
                                .getElementById("visual-" + reference.visual_id)
                                ?.closest("details")
                                ?.setAttribute("open", "");
                            }}
                          >
                            {reference.document_page ? `Document page ${reference.document_page}` : `${reference.viewport} ${reference.view}`}
                          </a>
                        ) : (
                          reference.viewport + " " + reference.view
                        )}{" "}
                        ·{" "}
                        {!reference.document_page && <a
                          href={reference.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Source page
                        </a>}
                      </li>
                    );
                  })}
                </ul>
              </article>
            ),
          )}
        </details>
      )}
      {writable && (
        <div className="actions">
          {business.website && (
            <button
              disabled={busy || pending || !state}
              onClick={() => void start("website.extract")}
            >
              Read website again
            </button>
          )}
          <button
            disabled={busy || pending || !state}
            onClick={() => void start("brand.analyze")}
          >
            Prepare AI brand & goals
          </button>
        </div>
      )}
      {recent?.result?.missing?.length > 0 && (
        <p>Still needed: {recent.result.missing.join("; ")}</p>
      )}
    </section>
  );
}
