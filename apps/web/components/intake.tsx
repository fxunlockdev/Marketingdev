"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Notice } from "./primitives";
import {BrandReferences} from "./brand-references";
import { PrivateVisual } from "./private-visual";
const active = (j: any) => ["queued", "running", "retrying"].includes(j.status);
const messages: Record<string, string> = {
  MONTHLY_GENERATION_BUDGET_EXHAUSTED: "You’ve used this month’s generation allowance. Your work is saved.",
  AI_RESEARCH_NO_SOURCES: "We couldn’t find enough cited information on your website. Add brand documents or details to continue.",
  AI_RESEARCH_SUBMISSION_UNKNOWN: "We couldn’t confirm the research response. We won’t repeat a potentially charged request automatically. Your business is saved.",
  AI_RESEARCH_LEGACY_CAPTURE: "This request belongs to the previous website service. Start a new research request after the existing request has been resolved.",
  AI_PROVIDER_AUTH_FAILED: "The OpenAI key was rejected. Update the server API key, then try again.",
  AI_PROVIDER_ACCESS_DENIED: "The OpenAI project does not have access to website research. Check its model and tool permissions.",
  AI_MODEL_UNAVAILABLE: "The configured research model is unavailable to this OpenAI project. Check model access before retrying.",
  AI_PROVIDER_QUOTA_EXHAUSTED: "Your OpenAI API account has no available credit or has reached its spending limit. Update billing, then try again.",
  AI_PROVIDER_RATE_LIMITED: "OpenAI is temporarily limiting requests. Wait a moment, then try again. Your business is saved.",
  AI_RESEARCH_REQUEST_REJECTED: "OpenAI could not accept the website research request. Your business is saved; the request configuration needs checking.",
  AI_PROVIDER_REJECTED: "OpenAI declined this request. Check the account’s API access, billing and limits before trying again.",
  WEBSITE_PREREQUISITE_TIMEOUT:
    "Website capture did not finish in time, so AI analysis has not started. Check the capture status before retrying.",
  WEBSITE_PREREQUISITE_FAILED:
    "Brand analysis did not start because website capture failed or was canceled. Review the website error and retry capture when ready.",
  AI_OUTPUT_INVALID:
    "Your website was captured, but AI returned details we could not verify. Your sources are saved. Choose Prepare AI brand & goals to try the analysis again; you do not need to reread the website.",
  AI_RESPONSE_INCOMPLETE:
    "Your website was captured, but AI stopped before finishing your brand profile. Your sources are saved. Try Prepare AI brand & goals again.",
  MAXUN_NOT_CONFIGURED:
    "Website capture is not configured yet. Your business is saved; please contact the workspace owner.",
  MAXUN_AUTH_FAILED:
    "The website capture service could not authenticate. The workspace owner needs to check its saved credential.",
  MAXUN_ACCESS_DENIED:
    "Maxun declined this capture. The workspace owner needs to check the account’s plan and API permissions before retrying.",
  MAXUN_CREDITS_EXHAUSTED:
    "The website capture service has no available credits. Your business is saved; the workspace owner needs to replenish them.",
  MAXUN_SUBMISSION_UNKNOWN:
    "We could not confirm whether website capture started. We will not submit a duplicate request. Please share the reference below for recovery.",
  MAXUN_RATE_LIMITED:
    "The website capture service is busy. Please try again shortly.",
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
  WEBSITE_ENCODING_UNSUPPORTED:
    "The website returned a compression format we could not read. Try Read website again; if it fails again, share the error details below.",
  WEBSITE_COMPRESSION_INVALID:
    "The website returned an incomplete or damaged compressed page. Try Read website again.",
  WEBSITE_PAGE_TOO_LARGE:
    "This page exceeds our safe processing size. Try a smaller public page, such as your About or product page.",
  WEBSITE_FETCH_TIMEOUT:
    "The website took too long to respond. Try Read website again shortly.",
  WEBSITE_DNS_TIMEOUT:
    "The website address took too long to resolve. Check the address and try again shortly.",
  WEBSITE_FETCH_FAILED:
    "We could not establish a secure connection to the website. Check that it opens publicly, then try again.",
  WEBSITE_ROBOTS_UNAVAILABLE:
    "We could not check this website’s crawler permissions. Try again shortly; analysis cannot proceed until that check succeeds.",
  WEBSITE_HTTP_ERROR:
    "The website refused the request or returned a server error. Check that the page is public and does not require login.",
  WEBSITE_NOT_HTML:
    "This address did not return a web page. Use a public website page or upload your document below.",
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
  onboarding = false,
  onState,
  onManual,
  profileReady=true,
}: {
  business: {
    id: string;
    website: string | null;
    role: string;
    revision: number;
  };
  onComplete: () => void;
  onboarding?: boolean;
  onState?: (state:any) => void;
  onManual?: () => void;
  profileReady?:boolean;
}) {
  const [state, setState] = useState<any>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const latest = useRef(onComplete),
    completed = useRef(""),
    requestKey = useRef(""),
    requestKind = useRef("");
  latest.current = onComplete;
  const stateListener=useRef(onState);stateListener.current=onState;
  useEffect(()=>{if(state)stateListener.current?.(state);},[state]);
  const path = `/api/v1/businesses/${business.id}/intake`,
    writable = ['owner','admin','editor'].includes(business.role),
    watch = !state || state.jobs.some(active);
  useEffect(() => {
    let live = true,
      inflight = false;
    async function poll() {
      if(document.hidden)return;
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
            { kind: "website.extract", autoAnalyze: true },
            "POST",
            `initial-website-${business.id}-${business.revision}`,
          );
          if (live) setState(await api(path));
        } else if (
          writable &&
          website?.status === "succeeded" &&
          !website.auto_analysis_job_id &&
          !website.recovery_of &&
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
  async function start(kind: string, recoverJobId?:string) {
    const requestType=recoverJobId?`${kind}:recover:${recoverJobId}`:kind;
    setBusy(true);
    setError(undefined);
    // Keep the same key after a lost response; a confirmed response permits a new explicit request.
    if (!requestKey.current || requestKind.current !== requestType) {
      requestKey.current = crypto.randomUUID();
      requestKind.current = requestType;
    }
    try {
      await api(path, { kind, ...(recoverJobId ? {recoverJobId} : kind === "website.extract" ? {autoAnalyze: true} : {}) }, "POST", requestKey.current);
      requestKey.current = "";
      setState(await api(path));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const recoverable=state?.jobs.find((j:any)=>j.can_recover);
  const pending = state?.jobs.find((j:any) => active(j) && j.kind === "website.extract") ?? state?.jobs.find(active),
    newest = state?.jobs[0],
    recent = newest?.error_code?.startsWith('WEBSITE_PREREQUISITE_')
      ? state.jobs.find((j:any)=>j.kind==='website.extract'&&j.auto_analysis_job_id===newest.id) ?? newest
      : newest,
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
  const capture=state?.jobs.find((j:any)=>j.kind==='website.extract');
  const analysis=state?.jobs.find((j:any)=>j.kind==='brand.analyze');
  const pageCount=capture?.result?.pages?.length ?? 0;
  const discoveries:{label:string;value:string}[]=[];
  if(business.website){try{discoveries.push({label:'Your website',value:new URL(business.website).hostname});}catch{/* Invalid URLs are handled by the API. */}}
  if(capture?.status==='succeeded')discoveries.push({label:capture.result?.method==='web_research'?'Sources found':'Website captured',value:pageCount?`${pageCount} cited pages ready for your brand profile`:'Website research saved'});
  if(state?.visuals?.length)discoveries.push({label:'Visual references',value:`${state.visuals.length} images saved for your brand profile`});
  if(analysis?.status==='running')discoveries.push({label:'Understanding your business',value:''});
  if(analysis?.status==='succeeded')discoveries.push({label:'Brand profile prepared',value:'Your suggested details are ready for review.'});
  if(onboarding && (business.website||state?.jobs.some((j:any)=>j.kind==='brand.analyze'))){
    const analyzed=state?.jobs.find((j:any)=>j.kind==='brand.analyze')?.status==='succeeded';

    if(analyzed&&!pending&&!profileReady)return <section className="brand-preparing"><h2>We need a little more about your business</h2><p>Your website was read, but we couldn’t identify enough reliable brand details to prepare your profile.</p><Notice error={error}/><div className="actions"><button disabled={busy} onClick={()=>void start('brand.analyze')}>Try analysis again</button><button onClick={onManual}>Add the missing details</button></div></section>;
    if(analyzed&&!pending&&recoverable)return <div className="onboarding-image-recovery"><p>Your website images need to be restored.</p><Notice error={error}/><button disabled={busy} onClick={()=>void start('website.extract',recoverable.id)}>Restore website images</button></div>;
    if(!analyzed||pending){
    const failed=!pending&&recent?.error_code;
    return <section className="brand-preparing" data-failed={!!failed} aria-busy={!!pending||busy}>
      <div className="brand-preparing-orbit" aria-hidden="true"><span>d<span>·</span></span><i className="brand-orbit-satellite" /></div>
      <h2>{failed?'Let’s finish your brand setup':'Getting to know your business'}</h2>
      <p role="status">{failed?(messages[recent.error_code]??'We couldn’t finish this step. Your business is saved.'):pending?.kind==='brand.analyze'?'Preparing your brand profile and first recommendations.':'Researching your website and gathering reliable business information.'}</p>
      {!failed&&<ol className="capture-progress"><li data-complete={state?.jobs.some((j:any)=>j.kind==='website.extract'&&j.status==='succeeded')}>Research your website</li><li data-complete={!!analyzed}>Build your brand profile</li><li>Ready for your review</li></ol>}
      {!!discoveries.length&&<ul className="brand-discoveries" aria-label="What we’ve found" aria-live="polite" aria-relevant="additions text">{discoveries.map(item=><li key={item.label}><span aria-hidden="true">{item.label==='Understanding your business'?'·':'✓'}</span><div><strong>{item.label}</strong>{item.value&&<p>{item.value}</p>}</div></li>)}</ul>}
      <Notice error={error}/>
      {!!error&&!failed&&<button onClick={()=>{setError(undefined);void api(path).then(setState).catch(setError);}}>Check progress</button>}
      {failed&&<><div className="actions">{recoverable?<button disabled={busy} onClick={()=>void start('website.extract',recoverable.id)}>Check saved capture</button>:<button disabled={busy} onClick={()=>void start(recent.kind==='brand.analyze'?'brand.analyze':'website.extract')}>Try again</button>}<button onClick={onManual}>Use documents or add details</button></div><details><summary>Error details</summary><p>{recent.error_code} · {recent.id}</p></details></>}
      {!failed&&<p className="hint">You can leave this page. We’ll keep working and save your progress.</p>}
    </section>;
    }
  }
  const panel = (
    <section className="v5-panel" aria-busy={busy || !!pending}>
      <h2>Let Desvio get to know your business.</h2>
      <p>
        {business.website
          ? "We research your website, then prepare a simple brand profile and suggested goals for your review."
          : "Add your brand documents or a few facts, then let AI prepare your direction."}
      </p>
      <Notice error={error} />
      {writable && recoverable && !pending && (
        <div>
          <p>Check the existing capture without starting another paid crawl. This can restore missing screenshots. Your saved brand details remain unchanged; running AI analysis again is a separate action.</p>
          <button type="button" disabled={busy} onClick={()=>void start("website.extract",recoverable.id)}>Check existing capture</button>
        </div>
      )}
      {recent?.error_code && !pending && recent.status !== "succeeded" && (
        <div role="alert">
          <strong>{recent.kind === "website.extract" ? "Website reading failed" : "Brand analysis failed"}</strong>
          <p>{messages[recent.error_code] ?? "We could not complete this step. Your saved work is safe. Share the error details below so we can investigate before you retry."}</p>
          <details>
            <summary>Error details</summary>
            <p>Code: {/^[A-Z][A-Z0-9_]{0,99}$/.test(recent.error_code) ? recent.error_code : "ANALYSIS_FAILED"}</p>
            <p>Reference: {recent.id}</p>
          </details>
        </div>
      )}
      <p role="status">
        {pending
          ? pending.kind === "website.extract" ? "Reading your website and capturing its visual design…" : "Filling your brand details and suggested goals from the captured evidence…"
          : recent?.status === "succeeded"
            ? recent.kind === "brand.analyze" ? "Your brand details are ready below. Edit anything you need, then confirm." : "Website captured. Preparing your brand details next…"
            : recent?.error_code
              ? "Your saved work is safe."
              : business.website
                ? "Preparing to read your website…"
                : "Ready when your evidence is added."}
      </p>
      <details>
        <summary>View sources and website captures</summary>
      {state?.jobs
        .filter((j: any) => j.kind === "website.extract" && j.result)
        .slice(0, 1)
        .map((j: any) => (
          <details key={j.id}>
            <summary>
              Website coverage · {j.result.pages?.length ?? 0} pages
            </summary>
            <p>
              {["rendered_desktop_mobile","rendered_provider"].includes(j.result.coverage)
                ? "Website pages and visual references captured for your review. These become brand rules only after you confirm them."
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
                {v.viewport === "photo" ? "Website photo" : v.viewport === "upload" ? "Product photo" : v.document_page ? `Document page ${v.document_page}` : v.viewport === "desktop" ? "Desktop" : v.viewport === "fullpage" ? "Full page" : v.viewport === "visible" ? "Visible page" : "Mobile"} ·{" "}
                {v.viewport === "upload" ? "Private upload" : v.document_page ? "Uploaded guideline" : v.observations?.title || v.observations?.label || "Website reference"}
              </h3>
              {!v.document_page && v.viewport!=="upload" && <a href={v.website_url} target="_blank" rel="noopener noreferrer">
                Open source page
              </a>}
              <p>
                {v.width} × {v.height} pixels
                {v.coverage?.truncated ? " · height capped" : ""}.{" "}
                {!v.document_page && v.viewport!=="upload" && v.viewport!=="photo" && Array.isArray(v.coverage?.resourceFailures) && <>{v.coverage.resourceFailures.length} resources could not be captured.</>}
              </p>
              {!v.document_page && v.viewport!=="upload" && v.viewport!=="photo" && <>{Array.isArray(v.observations?.typography) && <p>
                Observed fonts:{" "}
                {[
                  ...new Set(
                    v.observations.typography.map((f: any) => f.family),
                  ),
                ]
                  .slice(0, 5)
                  .join(", ")}
              </p>}
              {Array.isArray(v.observations?.images) && <p>
                Image references:{" "}
                {v.observations.images.filter((i: any) => i.loaded).length}{" "}
                loaded;{" "}
                {
                  v.observations.images.filter(
                    (i: any) => i.role === "logo_candidate",
                  ).length
                }{" "}
                logo candidates.
              </p>}</>}
              <PrivateVisual businessId={business.id} visualId={v.id}
                label={`View ${v.document_page ? `document page ${v.document_page}` : `${v.viewport} capture`}`}
                alt={v.viewport === "photo" ? "Website photo" : v.viewport === "upload" ? "Uploaded product photo" : v.document_page ? `Uploaded guideline page ${v.document_page}` : `${v.viewport} capture of ${v.website_url}`}/>
            </article>
          ))}
        </details>
      )}
      <button type="button" disabled={busy} onClick={()=>{setError(undefined);void api(path).then(setState).catch(setError);}}>Refresh image sources</button>
      {!!state?.visuals?.length && <BrandReferences businessId={business.id} writable={writable} sources={state.visuals}/>}
      </details>
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
  return onboarding ? <details className="onboarding-source-details"><summary>Sources & advanced options</summary>{panel}</details> : panel;
}
