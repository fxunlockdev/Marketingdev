type WebsiteIntake = {capture(jobs:AssetJobs,scope:JobScope,url:string,options?:{signal?:AbortSignal}):Promise<{
 pages:WebsitePage[];captures:Map<string,{capture:VisualCapture;objects:{key:string;bytes:number;shot:VisualCapture['snapshots'][number]}[]}>;
 visualErrors:{url:string;code:string}[];coverage:Record<string,any>;
}>;
 /** Optional second step: open-web market and competitor research for a guided brief. */
 market?(jobs:AssetJobs,scope:JobScope,url:string,brief?:GuidedBrief|null,competitors?:readonly string[]):Promise<MarketResearch>;
};
import {BRAND_RESERVED_SQL,MARKET_RESEARCH_VERSION,type MarketPage,type MarketResearch} from './openai-website-research.js';
import {AGENT_REACH_VERSION,type ReachPage} from './agent-reach-contract.js';
import type {AgentReachResearch,ReachRun} from './agent-reach-research.js';
import {settledMicros} from './call-settlement.js';
import type {GuidedBrief} from './guided-campaign-contracts.js';
import {exhaustedIntakeOutcome} from "./intake-outcome.js";
import {BUSINESS_RESEARCH_AGENT_VERSION} from './guided-campaign-contracts.js';
import {exceedsAllowance,monthlyBudgetExceeded} from "./spending-allowance.js";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type {WebsitePage,VisualCapture} from "./website-evidence.js";
import { digest } from "./object-store.js";
import { AssetJobs, type JobScope } from "./jobs.js";
import { IntakeError } from "./safe-web.js";
import {
  BrandAnalyzer,
  analysisRequest,
  type AnalysisInput,
  type EvidenceChunk,
} from "./brand-analysis.js";
import { lockReview, bumpReview } from "./brand-brain.js";
import { prepareVisuals, visualManifest } from "./visual-analysis.js";
/** Website photographs sent to analysis when a capture produced no page screenshots. */
export const PHOTO_EVIDENCE_LIMIT = 6;
const EVIDENCE_CHARACTERS = 40000, MARKET_EVIDENCE_CHARACTERS = 12000;
type EvidenceRow = EvidenceChunk & { market?: boolean; agent_reach?: boolean };
/** Website capture: GPT site research, the rendered crawler and the Agent Reach page reads run side
 * by side and the capture ends within this limit. Once Agent Reach has read the site, GPT site
 * research gets only the shorter grace period. */
export const CAPTURE_DEADLINE_MS = 75000, CAPTURE_GRACE_AFTER_DIRECT_MS = 20000;
const totalLength = (list: EvidenceRow[]) => list.reduce((n, row) => n + row.text.length, 0);
/** Fit evidence to the analysis limit. The business's own evidence comes first (captured pages,
 * then Agent Reach reads of the same site) and market notes get a bounded share, so competitor
 * material can never crowd it out. Within that share, GPT market notes and Agent Reach's
 * third-party pages each get half, and either may use what the other leaves. */
export function selectEvidence(rows: EvidenceRow[]): EvidenceChunk[] {
  const take = (list: EvidenceRow[], budget: number) => {
    let length = 0;
    return list.flatMap((row) => {
      const { market, agent_reach: _reach, ...chunk } = row, text = chunk.text.slice(0, Math.max(0, budget - length));
      length += text.length;
      return text ? [{ ...chunk, text, ...(market ? { origin: "market" as const } : {}) }] : [];
    });
  };
  const own = [...rows.filter((row) => !row.market && !row.agent_reach), ...rows.filter((row) => !row.market && row.agent_reach)];
  const marketAi = rows.filter((row) => row.market && !row.agent_reach), marketReach = rows.filter((row) => row.market && row.agent_reach);
  const marketShare = Math.min(MARKET_EVIDENCE_CHARACTERS, totalLength(marketAi) + totalLength(marketReach));
  const ownChunks = take(own, EVIDENCE_CHARACTERS - marketShare);
  const used = ownChunks.reduce((n, chunk) => n + chunk.text.length, 0), budget = Math.min(MARKET_EVIDENCE_CHARACTERS, EVIDENCE_CHARACTERS - used);
  const aiChunks = take(marketAi, Math.min(totalLength(marketAi), Math.max(Math.floor(budget / 2), budget - totalLength(marketReach))));
  const aiUsed = aiChunks.reduce((n, chunk) => n + chunk.text.length, 0);
  return [...ownChunks, ...aiChunks, ...take(marketReach, budget - aiUsed)];
}
/** Agent Reach pages as stored evidence: URL, title, retrieval time and channel on the source. */
function reachCoverage(page: ReachPage) {
  return { type: page.coverage, origin: page.origin, channel: page.channel, action: page.action, provider: page.provider, purpose: page.purpose, title: page.title, retrieved_at: page.retrievedAt, truncated: page.truncated,
    warning: page.origin === "own" ? "Public page text read by Agent Reach (Jina Reader or Exa); observed website text, not approved brand identity." : "Third-party page text, search results or videos read by Agent Reach. Analysis only: not the business's own website, not an approved brand fact and never wording to copy." };
}
/** Store Agent Reach pages beside the other evidence. Stops quietly at the source limit. */
async function insertReachPages(db: any, j: any, pages: ReachPage[], room: number): Promise<number> {
  let inserted = 0;
  for (const page of pages) {
    if (inserted >= room) break;
    if ((await db.query("SELECT id FROM app.brand_sources WHERE organization_id=$1 AND brand_id=$2 AND website_url=$3 AND sha256=$4 AND parser_version=$5",[j.organization_id,j.brand_id,page.url,page.sha256,AGENT_REACH_VERSION])).rowCount) continue;
    const source = randomUUID();
    await db.query("INSERT INTO app.brand_sources(id,organization_id,brand_id,kind,sha256,parser_version,coverage,website_url) VALUES($1,$2,$3,'website',$4,$5,$6,$7)",
      [source,j.organization_id,j.brand_id,page.sha256,AGENT_REACH_VERSION,JSON.stringify(reachCoverage(page)),page.url]);
    for (const chunk of page.chunks)
      await db.query("INSERT INTO app.brand_chunks(id,organization_id,brand_id,source_id,page,anchor,text) VALUES($1,$2,$3,$4,1,$5,$6)",[randomUUID(),j.organization_id,j.brand_id,source,chunk.anchor,chunk.text]);
    inserted++;
  }
  return inserted;
}
/** Own-site Agent Reach reads as the capture's pages, when nothing else could read the site. */
function directCapture(run: ReachRun, primaryError: string) {
  return { pages: run.ownPages.map((p) => ({ parserVersion: p.parserVersion, url: p.url, sha256: p.sha256, chunks: p.chunks, links: [], truncated: p.truncated, coverage: "agent_reach_page_text" as const })),
    captures: new Map<string,{capture:VisualCapture;objects:{key:string;bytes:number;shot:VisualCapture["snapshots"][number]}[]}>(), visualErrors: [] as {url:string;code:string}[],
    coverage: { provider: "agent_reach", method: "direct_page_read", pages: run.ownPages.map((p) => p.url), screenshotsAvailable: false, photosAvailable: 0, partial: true, primaryError } };
}
const deadline = <T,>(work: Promise<T>, ms: number, code: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new IntakeError(code)), ms); })]).finally(() => clearTimeout(timer));
};
/** Store market notes beside own-site evidence, tagged by parser version and coverage so
 * no later stage can mistake them for the business's own words. Stops quietly at the
 * source limit: market evidence is never a reason to fail research. */
async function insertMarketPages(db: any, j: any, pages: MarketPage[], room: number): Promise<number> {
  let marketInserted = 0;
  for (const page of pages) {
    if (marketInserted >= room) break;
    if ((await db.query("SELECT id FROM app.brand_sources WHERE organization_id=$1 AND brand_id=$2 AND website_url=$3 AND sha256=$4 AND parser_version=$5",[j.organization_id,j.brand_id,page.url,page.sha256,MARKET_RESEARCH_VERSION])).rowCount) continue;
    const source = randomUUID();
    await db.query("INSERT INTO app.brand_sources(id,organization_id,brand_id,kind,sha256,parser_version,coverage,website_url) VALUES($1,$2,$3,'website',$4,$5,$6,$7)",
      [source,j.organization_id,j.brand_id,page.sha256,MARKET_RESEARCH_VERSION,JSON.stringify({type:"ai_market_research",origin:"market",truncated:false,warning:"AI-written market and competitor research from third-party pages. Analysis only: not the business's own website, not an approved brand fact and never wording to copy."}),page.url]);
    for (const chunk of page.chunks)
      await db.query("INSERT INTO app.brand_chunks(id,organization_id,brand_id,source_id,page,anchor,text) VALUES($1,$2,$3,$4,1,$5,$6)",[randomUUID(),j.organization_id,j.brand_id,source,chunk.anchor,chunk.text]);
    marketInserted++;
  }
  return marketInserted;
}
const terminal = new Set([
  "succeeded",
  "rejected",
  "failed",
  "canceled",
  "unknown",
]);
export class IntakeJobs {
  constructor(
    readonly jobs: AssetJobs,
    readonly analyzer: BrandAnalyzer,
    readonly websiteIntake?: WebsiteIntake,
    /** Turns a succeeded job's new sources into graph suggestions. Never throws; never changes the job. */
    readonly knowledge?: { afterSuccess(scope: JobScope): Promise<unknown> },
    /** Login-free Agent Reach research beside the capture. Absent or switched off: research is as before. */
    readonly agentReach?: Pick<AgentReachResearch,'research'|'configured'>,
    /** Capture time limits; tests shorten them. */
    readonly timing: { deadlineMs: number; graceMs: number } = { deadlineMs: CAPTURE_DEADLINE_MS, graceMs: CAPTURE_GRACE_AFTER_DIRECT_MS },
  ) {}
  private finish(
    db: any,
    job: any,
    status: string,
    code: string | null = null,
  ) {
    return db
      .query(
        "UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1",
        [job.id, status, code],
      )
      .then(() => status);
  }
  async run(scope: JobScope) {
    const job = await this.jobs.transaction(scope, async (db, j) => {
      if (!["website.extract", "brand.analyze"].includes(j.kind))
        throw new Error("JOB_KIND_DENIED");
      // A replay of a succeeded job only catches up on graph extraction, which never pays twice.
      if (terminal.has(j.status)) return j.status === "succeeded" ? { succeeded: true } : null;
      if (!(await this.jobs.permitted(db, j))) {
        await this.finish(db, j, "canceled", "ACCESS_REVOKED_OR_CANCELED");
        return null;
      }
      if (j.kind === "brand.analyze") {
        const parent = (await db.query("SELECT p.status,p.cancel_requested,(r.research_context IS NOT NULL) AS guided FROM app.intake_dependencies d JOIN app.jobs p ON p.id=d.capture_job_id JOIN app.intake_requests r ON r.job_id=$1 WHERE d.analysis_job_id=$1", [j.id])).rows[0];
        // Guided onboarding never dead-ends on its website: a capture that failed leaves the
        // analysis to run on the owner's answers and market research, noting the unread site.
        const unreadWebsite = parent && parent.guided && !parent.cancel_requested && terminal.has(parent.status) && parent.status !== "succeeded";
        if (parent && !unreadWebsite) {
          if (parent.cancel_requested || (terminal.has(parent.status) && parent.status !== "succeeded")) {
            await this.finish(db,j,"canceled","WEBSITE_PREREQUISITE_FAILED");
            return null;
          }
          if (parent.status !== "succeeded") return { waiting: true };
        }
      }
      await db.query(
        "UPDATE app.jobs SET status='running',attempt=attempt+1,updated_at=now() WHERE id=$1",
        [j.id],
      );
      return j;
    });
    if (!job) return "finished";
    if (job.succeeded) {
      await this.knowledge?.afterSuccess(scope);
      return "finished";
    }
    if (job.waiting) return "waiting";
    try {
      const status = job.kind === "website.extract"
        ? await this.crawl(scope)
        : await this.analyze(scope);
      if (status === "succeeded") await this.knowledge?.afterSuccess(scope);
      return status;
    } catch (error) {
      if(monthlyBudgetExceeded(error))error=new IntakeError('MONTHLY_GENERATION_BUDGET_EXHAUSTED');
      if (!(error instanceof IntakeError)) throw error;
      // Crawl transport/parse failures can be explicitly retried. AI submission ambiguity is handled separately below.
      return this.jobs.transaction(scope, async (db, j) => {
        if (terminal.has(j.status)) return j.status;
        return this.finish(
          db,
          j,
          ["MAXUN_SUBMISSION_UNKNOWN","AI_RESEARCH_SUBMISSION_UNKNOWN"].includes(error.code) ? "unknown" : "rejected",
          error instanceof IntakeError
            ? error.code
            : "INTAKE_SERVICE_UNAVAILABLE",
        );
      });
    }
  }
  async crawl(scope: JobScope) {
    const input = await this.jobs.transaction(
      scope,
      async (db, j) =>
        (
          await db.query(
            "SELECT website_url,research_context FROM app.intake_requests WHERE job_id=$1",
            [j.id],
          )
        ).rows[0],
    );
    if(this.websiteIntake){
      // Own-site research (GPT site research and the rendered crawler), market research and
      // Agent Reach run side by side. Each paid call reserves its budget in a transaction that
      // locks this job's row, so the reservations still see each other. Every branch is
      // awaited: the job never finishes while one is still writing its ledger. The capture
      // ends within CAPTURE_DEADLINE_MS, and once Agent Reach has read the site itself GPT
      // site research gets only the grace period.
      const websiteIntake=this.websiteIntake,controller=new AbortController();
      let grace:NodeJS.Timeout|undefined;
      const hard=setTimeout(()=>controller.abort(),this.timing.deadlineMs);
      const own=deadline(websiteIntake.capture(this.jobs,scope,input.website_url,{signal:controller.signal}),this.timing.deadlineMs+5000,"WEBSITE_CAPTURE_TIMEOUT");
      const market=websiteIntake.market?websiteIntake.market(this.jobs,scope,input.website_url,input.research_context):Promise.resolve(undefined);
      const reach=this.agentReach?.configured?this.agentReach.research(this.jobs,scope,input.website_url,input.research_context,{
        stopWhen:own.then(()=>market.catch(()=>undefined)),
        onOwnPage:()=>{grace??=setTimeout(()=>controller.abort(),this.timing.graceMs);},
      }):Promise.resolve(undefined);
      const [[ownOutcome,marketOutcome],run]=await Promise.all([Promise.allSettled([own,market]),reach.catch(()=>undefined)]);
      clearTimeout(hard);clearTimeout(grace);
      if(marketOutcome.status==="rejected")throw marketOutcome.reason;
      const marketResult=marketOutcome.value;
      if(ownOutcome.status==="rejected"){
        const reason=ownOutcome.reason;
        if(!(reason instanceof IntakeError)||reason.code==="ACCESS_REVOKED_OR_CANCELED"||!run?.ownPages.length){
          // Nothing read the site: keep the market evidence for the analysis, then fail the capture.
          if(reason instanceof IntakeError&&reason.code!=="ACCESS_REVOKED_OR_CANCELED")await this.persistSideEvidence(scope,marketResult?.pages??[],run?.marketPages??[]);
          throw reason;
        }
        const direct=directCapture(run,reason.code);
        return this.persistWebsite(scope,direct.pages,direct.captures,direct.visualErrors,{...direct.coverage,...(marketResult?{market:marketResult.summary}:{}),agent_reach:run.summary},marketResult?.pages??[],run.marketPages);
      }
      const captured=ownOutcome.value;
      // Verbatim captured text wins over a second read of the same page.
      const verbatim=new Set(captured.pages.filter(p=>p.coverage!=="ai_web_research").map(p=>p.url));
      const reachPages=run?[...run.ownPages.filter(p=>!verbatim.has(p.url)),...run.marketPages]:[];
      // The market step is best-effort, so its outcome is reported beside the capture, never instead of it.
      return this.persistWebsite(scope,captured.pages,captured.captures,captured.visualErrors,{...captured.coverage,...(marketResult?{market:marketResult.summary}:{}),...(run?{agent_reach:run.summary}:{})},marketResult?.pages??[],reachPages);
    }
    throw new IntakeError("AI_NOT_CONFIGURED");
  }
  /** A failed capture still keeps the market evidence it gathered, for the analysis that follows. */
  private async persistSideEvidence(scope:JobScope,marketPages:MarketPage[],reachPages:ReachPage[]){
    if(!marketPages.length&&!reachPages.length)return;
    await this.jobs.transaction(scope,async(db,j)=>{
      if(!(await this.jobs.permitted(db,j)))return;
      await lockReview(db,j.organization_id,j.brand_id);
      const state=(await db.query("SELECT source_count FROM app.brand_review_state WHERE organization_id=$1 AND brand_id=$2",[j.organization_id,j.brand_id])).rows[0];
      const market=await insertMarketPages(db,j,marketPages,100-state.source_count);
      const reach=await insertReachPages(db,j,reachPages,100-state.source_count-market);
      if(!market&&!reach)return;
      await db.query("UPDATE app.brand_review_state SET source_count=source_count+$3 WHERE organization_id=$1 AND brand_id=$2",[j.organization_id,j.brand_id,market+reach]);
      await bumpReview(db,j.organization_id,j.brand_id);
    });
  }
  private async persistWebsite(scope:JobScope,pages:WebsitePage[],captures:Map<string,{capture:VisualCapture;objects:{key:string;bytes:number;shot:VisualCapture["snapshots"][number]}[]}>,visualErrors:{url:string;code:string}[],coverage:any,marketPages:MarketPage[]=[],reachPages:ReachPage[]=[]){
    const newBytes = [...captures.values()].reduce(
      (n, c) =>
        n +
        c.capture.snapshots.reduce(
          (m, s) => m + Buffer.from(s.screenshot, "base64").length,
          0,
        ),
      0,
    );
    await this.jobs.transaction(scope, async (db, j) => {
      if (!(await this.jobs.permitted(db, j)))
        throw new IntakeError("ACCESS_REVOKED_OR_CANCELED");
      const used = Number(
        (
          await db.query(
            "SELECT COALESCE(sum(bytes),0) AS n FROM app.website_visuals WHERE organization_id=$1 AND brand_id=$2",
            [j.organization_id, j.brand_id],
          )
        ).rows[0].n,
      );
      if (used + newBytes > 256 * 1024 * 1024)
        throw new IntakeError("WEBSITE_VISUAL_STORAGE_LIMIT");
    });
    for (const { capture, objects } of captures.values())
      for (const shot of capture.snapshots) {
        const bytes = Buffer.from(shot.screenshot, "base64"),
          key = `evidence/${scope.organizationId}/${scope.brandId}/${scope.jobId}/${shot.viewport.width}/${shot.sha256}`;
        await this.jobs.store.persist(key, bytes, "image/jpeg", shot.sha256);
        objects.push({ key, bytes: bytes.length, shot });
      }
    if (!pages.length) throw new IntakeError("WEBSITE_NO_CONTENT");
    return this.jobs.transaction(scope, async (db, j) => {
      if (terminal.has(j.status)) return j.status;
      if (!(await this.jobs.permitted(db, j)))
        return this.finish(db, j, "canceled", "ACCESS_REVOKED_OR_CANCELED");
      await lockReview(db, j.organization_id, j.brand_id);
      const state = (
        await db.query(
          "SELECT source_count FROM app.brand_review_state WHERE organization_id=$1 AND brand_id=$2",
          [j.organization_id, j.brand_id],
        )
      ).rows[0];
      let inserted = 0;
      for (const page of pages) {
        if (
          (
            await db.query(
              "SELECT id FROM app.brand_sources WHERE organization_id=$1 AND brand_id=$2 AND website_url=$3 AND sha256=$4 AND parser_version=$5",
              [
                j.organization_id,
                j.brand_id,
                page.url,
                page.sha256,
                page.parserVersion,
              ],
            )
          ).rowCount
        )
          continue;
        if (state.source_count + inserted >= 100)
          throw new IntakeError("BRAND_EVIDENCE_LIMIT_EXCEEDED");
        const source = randomUUID();
        await db.query(
          "INSERT INTO app.brand_sources(id,organization_id,brand_id,kind,sha256,parser_version,coverage,website_url) VALUES($1,$2,$3,'website',$4,$5,$6,$7)",
          [
            source,
            j.organization_id,
            j.brand_id,
            page.sha256,
            page.parserVersion,
            JSON.stringify({
              type: page.coverage,
              truncated: page.truncated,
              warning:
                page.coverage === "agent_reach_page_text"
                  ? "Public page text read by Agent Reach (Jina Reader or Exa); observed website text, not approved brand identity."
                  : page.coverage === "ai_web_research"
                  ? "AI-written research with cited website sources; not a verbatim website capture or approved brand identity."
                  : page.coverage === "server_html_only"
                  ? "Visual capture unavailable; server HTML only."
                  : "Observed public website, not approved brand identity. Capture limitations are recorded separately.",
            }),
            page.url,
          ],
        );
        for (const chunk of page.chunks)
          await db.query(
            "INSERT INTO app.brand_chunks(id,organization_id,brand_id,source_id,page,anchor,text) VALUES($1,$2,$3,$4,1,$5,$6)",
            [
              randomUUID(),
              j.organization_id,
              j.brand_id,
              source,
              chunk.anchor,
              chunk.text,
            ],
          );
        const captured = captures.get(page.url);
        if (captured)
          for (const item of captured.objects)
            await db.query(
              "INSERT INTO app.website_visuals(id,organization_id,brand_id,source_id,job_id,viewport,parser_version,object_key,sha256,bytes,width,height,observations,coverage) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
              [
                randomUUID(),
                j.organization_id,
                j.brand_id,
                source,
                j.id,
                item.shot.label ?? (item.shot.viewport.width === 1440 ? "desktop" : "mobile"),
                captured.capture.version,
                item.key,
                item.shot.sha256,
                item.bytes,
                item.shot.viewport.width,
                item.shot.height,
                JSON.stringify(item.shot.observations),
                JSON.stringify({
                  truncated: item.shot.truncated,
                  resourceFailures: captured.capture.failures,
                  requests: captured.capture.requests,
                }),
              ],
            );
        inserted++;
      }
      // Market and competitor notes are stored beside own-site evidence but tagged by
      // parser version and coverage type, so no later stage can mistake them for the
      // business's own words. They never fail the capture: at the source limit they stop.
      const marketInserted = await insertMarketPages(db, j, marketPages, 100 - state.source_count - inserted);
      const reachInserted = await insertReachPages(db, j, reachPages, 100 - state.source_count - inserted - marketInserted);
      if (inserted + marketInserted + reachInserted) {
        await db.query(
          "UPDATE app.brand_review_state SET source_count=source_count+$3 WHERE organization_id=$1 AND brand_id=$2",
          [j.organization_id, j.brand_id, inserted + marketInserted + reachInserted],
        );
        await bumpReview(db, j.organization_id, j.brand_id);
      }
      await db.query(
        "UPDATE app.intake_requests SET result=$2 WHERE job_id=$1",
        [
          j.id,
          JSON.stringify({
            ...coverage,
            coverage:
              coverage.method === "direct_page_read" ? "agent_reach_page_text" : coverage.method === "web_research" ? "ai_web_research" : coverage.provider === "self_hosted_browser"
                ? coverage.screenshotsAvailable ? "rendered_provider" : captures.size ? "partial_visual" : "server_html_only"
                : captures.size === pages.length && !visualErrors.length
                ? coverage.provider === "maxun" ? "rendered_provider" : "rendered_desktop_mobile"
                : captures.size
                  ? "partial_visual"
                  : "server_html_only",
            visualPages: captures.size,
            visualErrors,
            newSources: inserted,
            ...(coverage.market ? {market:{...coverage.market,newSources:marketInserted}} : {}),
            ...(coverage.agent_reach ? {agent_reach:{...coverage.agent_reach,newSources:reachInserted}} : {}),
          }),
        ],
      );
      return this.finish(db, j, "succeeded");
    });
  }
  /** Competitor-only market step for names added after early research. It runs before
   * analysis reads its evidence, has its own ledger row and replays without paying twice. */
  private async marketFollowup(scope: JobScope) {
    const request = await this.jobs.transaction(scope, async (db, j) =>
      (await db.query("SELECT market_followup,research_context FROM app.intake_requests WHERE job_id=$1", [j.id])).rows[0]);
    const followup = request?.market_followup;
    if (!followup || !this.websiteIntake?.market) return null;
    const market = await this.websiteIntake.market(this.jobs, scope, followup.website, request.research_context, followup.competitors);
    if (market.pages.length)
      await this.jobs.transaction(scope, async (db, j) => {
        if (!(await this.jobs.permitted(db, j))) throw new IntakeError("ACCESS_REVOKED_OR_CANCELED");
        await lockReview(db, j.organization_id, j.brand_id);
        const state = (await db.query("SELECT source_count FROM app.brand_review_state WHERE organization_id=$1 AND brand_id=$2", [j.organization_id, j.brand_id])).rows[0];
        const inserted = await insertMarketPages(db, j, market.pages, 100 - state.source_count);
        if (!inserted) return;
        await db.query("UPDATE app.brand_review_state SET source_count=source_count+$3 WHERE organization_id=$1 AND brand_id=$2", [j.organization_id, j.brand_id, inserted]);
        await bumpReview(db, j.organization_id, j.brand_id);
      });
    return market.summary;
  }
  async analyze(scope: JobScope) {
    const followup = await this.marketFollowup(scope);
    // Read immutable references under RLS, then decode private pixels outside DB
    // locks. Recheck access, evidence revision and the operator grant before spend.
    const visualEvidence = await this.jobs.transaction(scope, async (db, j) => {
      if (!(await this.jobs.permitted(db, j)))
        throw new IntakeError("ACCESS_REVOKED_OR_CANCELED");
      if (
        (
          await db.query(
            "SELECT job_id FROM app.analysis_calls WHERE job_id=$1",
            [j.id],
          )
        ).rowCount
      )
        return null;
      if (!this.analyzer.configured) throw new IntakeError("AI_NOT_CONFIGURED");
      const rows = (
        await db.query(
          `SELECT v.*,s.website_url FROM app.website_visuals v JOIN app.brand_sources s ON s.id=v.source_id
        WHERE v.organization_id=$1 AND v.brand_id=$2 AND v.viewport<>'photo' AND v.job_id=(SELECT x.job_id FROM app.website_visuals x WHERE x.organization_id=$1 AND x.brand_id=$2 AND x.viewport<>'photo' ORDER BY x.captured_at DESC LIMIT 1)
        ORDER BY s.captured_at,v.source_id,v.viewport LIMIT 10`,
          [j.organization_id, j.brand_id],
        )
      ).rows;
      // A capture without page screenshots still has the site's own photographs. Use a
      // capped set of the largest ones so the direction is not written blind.
      const photoRows = rows.length ? [] : (
        await db.query(
          `SELECT v.*,s.website_url FROM app.website_visuals v JOIN app.brand_sources s ON s.id=v.source_id
        WHERE v.organization_id=$1 AND v.brand_id=$2 AND v.viewport='photo' AND v.job_id=(SELECT x.job_id FROM app.website_visuals x WHERE x.organization_id=$1 AND x.brand_id=$2 ORDER BY x.captured_at DESC LIMIT 1)
        ORDER BY v.width*v.height DESC,v.id LIMIT $3`,
          [j.organization_id, j.brand_id, PHOTO_EVIDENCE_LIMIT],
        )
      ).rows;
      const websiteRows = rows.length ? rows : photoRows;
      const documentRows = (await db.query(`SELECT v.*,v.page AS document_page,s.sha256 AS document_sha256,'document' AS viewport,'{}'::jsonb AS observations
        FROM app.document_visuals v JOIN app.brand_sources s ON s.id=v.source_id
        WHERE v.organization_id=$1 AND v.brand_id=$2
        ORDER BY v.captured_at DESC,v.source_id,v.page LIMIT 10`, [j.organization_id,j.brand_id])).rows;
      const documentPageCount = Number((await db.query("SELECT count(*) AS n FROM app.document_visuals WHERE organization_id=$1 AND brand_id=$2", [j.organization_id,j.brand_id])).rows[0].n);
      // Share the existing ten-source budget. Keep website evidence alongside
      // documents, and record exactly which pages reached the model manifest.
      const selectedRows = documentRows.length ? [...websiteRows.slice(0, Math.min(websiteRows.length, 4)), ...documentRows.slice(0, 10-Math.min(websiteRows.length, 4))] : websiteRows;
      if (!selectedRows.length) return null;
      const grant = (
        await db.query(
          "SELECT max_tokens_per_image FROM app.analysis_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()",
          [j.organization_id, j.brand_id],
        )
      ).rows[0];
      if (!grant?.max_tokens_per_image) {
        // Photographs are an addition to text research, not a prerequisite: a business
        // without a vision allowance keeps the text-only analysis it had before.
        if (selectedRows.every((row) => row.viewport === "photo")) return null;
        throw new IntakeError("AI_VISION_APPROVAL_REQUIRED");
      }
      return {
        rows: selectedRows,
        documentPageCount,
        revision: await lockReview(db, j.organization_id, j.brand_id),
      };
    });
    const visuals = visualEvidence
      ? await prepareVisuals(this.jobs.store, visualEvidence.rows)
      : [];
    const prepared = await this.jobs.transaction(scope, async (db, j) => {
      const previous = (
        await db.query("SELECT * FROM app.analysis_calls WHERE job_id=$1", [
          j.id,
        ])
      ).rows[0];
      if (previous) {
        if (previous.status === "succeeded") return { cached: previous };
        await db.query(
          "UPDATE app.analysis_calls SET status='unknown' WHERE job_id=$1 AND status='submitted'",
          [j.id],
        );
        await this.finish(
          db,
          j,
          previous.status === "rejected" ? "rejected" : "unknown",
          "AI_SUBMISSION_REQUIRES_REVIEW",
        );
        return null;
      }
      if (!this.analyzer.configured) throw new IntakeError("AI_NOT_CONFIGURED");
      if (!(await this.jobs.permitted(db, j)))
        throw new IntakeError("ACCESS_REVOKED_OR_CANCELED");
      const revision = await lockReview(db, j.organization_id, j.brand_id);
      if (visualEvidence && revision !== visualEvidence.revision)
        throw new IntakeError("AI_EVIDENCE_CHANGED");
      const grant = (
        await db.query(
          "SELECT * FROM app.analysis_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()",
          [j.organization_id, j.brand_id],
        )
      ).rows[0];
      if (!grant) throw new IntakeError("AI_STAGING_APPROVAL_REQUIRED");
      const researchContext=(await db.query("SELECT research_context FROM app.intake_requests WHERE job_id=$1",[j.id])).rows[0]?.research_context;
      // Keep archived questionnaires for history, but ground this run only in its submitted snapshot.
      const chunks = (
        await db.query(
          "SELECT c.id,c.source_id,c.text,c.page,s.website_url,(s.parser_version=$5 OR s.coverage->>'origin'='market') AS market,(s.parser_version=$6) AS agent_reach FROM app.brand_chunks c JOIN app.brand_sources s ON s.id=c.source_id WHERE c.organization_id=$1 AND c.brand_id=$2 AND CASE WHEN $3::jsonb IS NOT NULL AND s.parser_version=$4 THEN (c.text::jsonb - 'brand_name')=$3::jsonb ELSE true END ORDER BY s.captured_at DESC,c.page,c.anchor,c.id LIMIT 100",
          [j.organization_id, j.brand_id,researchContext?JSON.stringify(researchContext):null,BUSINESS_RESEARCH_AGENT_VERSION,MARKET_RESEARCH_VERSION,AGENT_REACH_VERSION],
        )
      ).rows;
      const selected = selectEvidence(chunks);
      const reviewed = (
        await db.query(
          "SELECT field,value,status FROM app.brand_findings WHERE organization_id=$1 AND brand_id=$2 AND status<>'unreviewed' ORDER BY field,id LIMIT 500",
          [j.organization_id, j.brand_id],
        )
      ).rows;
      // A guided brief names a website, but no page of it was read: say so instead of failing.
      const websiteUnread = !!researchContext?.details?.website && !(await db.query("SELECT 1 FROM app.brand_sources WHERE organization_id=$1 AND brand_id=$2 AND kind='website' AND parser_version<>$3 AND coalesce(coverage->>'origin','own')<>'market' LIMIT 1",[j.organization_id,j.brand_id,MARKET_RESEARCH_VERSION])).rowCount;
      const input: AnalysisInput = {
          ...(researchContext ? {guided_brief:researchContext} : {}),
          ...(websiteUnread ? {website_unread:true} : {}),
          chunks: selected,
          reviewed,
          ...(visuals.length ? { visuals } : {}),
        },
        request = analysisRequest(
          input,
          grant.model,
          grant.max_tokens_per_image,
        );
      const reserved = Math.ceil(
        request.maxInputTokens * Number(grant.input_micros_per_token) +
          request.maxOutputTokens * Number(grant.output_micros_per_token),
      );
      const used = Number(
        (
          await db.query(
            BRAND_RESERVED_SQL,
            [j.organization_id, j.brand_id],
          )
        ).rows[0].used,
      );
      if (
        !Number.isSafeInteger(reserved) ||
        reserved <= 0 ||
        exceedsAllowance(used + reserved,grant.budget_micros)
      )
        throw new IntakeError("AI_BUDGET_EXHAUSTED");
      // Mark before the external call. A crash in this window consumes a reservation but cannot duplicate spend.
      await db.query(
        "INSERT INTO app.analysis_calls(job_id,organization_id,brand_id,review_revision,model,reserved_micros,input_sha256,status) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted')",
        [
          j.id,
          j.organization_id,
          j.brand_id,
          revision,
          grant.model,
          reserved,
          request.sha256,
        ],
      );
      return {
        input,
        model: grant.model,
        maxTokensPerImage: grant.max_tokens_per_image,
        reserved,
        rates: { input_micros_per_token: grant.input_micros_per_token, output_micros_per_token: grant.output_micros_per_token },
      };
    });
    if (!prepared) return "finished";
    if (!("cached" in prepared)) {
      let response;
      try {
        response = await this.analyzer.analyze(
          prepared.input,
          prepared.model,
          prepared.maxTokensPerImage,
        );
      } catch (error) {
      if(monthlyBudgetExceeded(error))error=new IntakeError('MONTHLY_GENERATION_BUDGET_EXHAUSTED');
        const known =
          error instanceof IntakeError ||
          (error instanceof OpenAI.APIError &&
            [400, 401, 403, 404, 422, 429].includes(error.status ?? 0));
        const code =
          error instanceof IntakeError
            ? error.code
            : known
              ? "AI_PROVIDER_REJECTED"
              : "AI_SUBMISSION_UNKNOWN";
        return this.jobs.transaction(scope, async (db, j) => {
          await db.query(
            "UPDATE app.analysis_calls SET status=$2 WHERE job_id=$1",
            [j.id, known ? "rejected" : "unknown"],
          );
          return this.finish(db, j, known ? "rejected" : "unknown", code);
        });
      }
      // Persist valid provider output before applying it to the draft; retrying application never calls the provider again.
      await this.jobs.transaction(scope, async (db, j) => {
        await db.query(
          "UPDATE app.analysis_calls SET status='succeeded',response_id=$2,result=$3,usage=$4,settled_micros=$5 WHERE job_id=$1",
          [
            j.id,
            response.id,
            JSON.stringify({
              ...response.result,
              ...(prepared.input.website_unread ? { website_unread: true } : {}),
              visual_manifest: visualManifest(prepared.input.visuals ?? []),
              visual_coverage: {
                document_pages_available: visualEvidence?.documentPageCount ?? 0,
                document_pages_analyzed: (prepared.input.visuals ?? []).filter(v => v.document_page).map(v => ({source_id:v.source_id,page:v.document_page})),
                limited: (visualEvidence?.documentPageCount ?? 0) > (prepared.input.visuals ?? []).filter(v => v.document_page).length,
              },
            }),
            JSON.stringify(response.usage),
            settledMicros(response.usage, prepared.rates, prepared.reserved),
          ],
        );
      });
    }
    return this.jobs.transaction(scope, async (db, j) => {
      if (terminal.has(j.status)) return j.status;
      if (!(await this.jobs.permitted(db, j)))
        return this.finish(db, j, "canceled", "ACCESS_REVOKED_OR_CANCELED");
      const call = (
        await db.query("SELECT * FROM app.analysis_calls WHERE job_id=$1", [
          j.id,
        ])
      ).rows[0];
      const revision = await lockReview(db, j.organization_id, j.brand_id);
      if (revision !== call.review_revision)
        return this.finish(db, j, "rejected", "AI_EVIDENCE_CHANGED");
      const findings = call.result.findings;
      const existing = (
        await db.query(
          "SELECT field,value FROM app.brand_findings WHERE organization_id=$1 AND brand_id=$2",
          [j.organization_id, j.brand_id],
        )
      ).rows;
      const fresh = findings.filter(
        (f: any) =>
          !existing.some((e) => e.field === f.field && e.value === f.value),
      );
      const count = (
        await db.query(
          "SELECT finding_count FROM app.brand_review_state WHERE organization_id=$1 AND brand_id=$2",
          [j.organization_id, j.brand_id],
        )
      ).rows[0].finding_count;
      if (count + fresh.length > 500)
        throw new IntakeError("BRAND_EVIDENCE_LIMIT_EXCEEDED");
      for (const f of fresh) {
        const chunk = (
          await db.query("SELECT source_id FROM app.brand_chunks WHERE id=$1", [
            f.chunk_id,
          ])
        ).rows[0];
        await db.query(
          "INSERT INTO app.brand_findings(id,organization_id,brand_id,source_id,chunk_id,field,original_value,value,extraction_type,evidence_quote,analysis_job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$7,'ai_suggestion',$8,$9)",
          [
            randomUUID(),
            j.organization_id,
            j.brand_id,
            chunk.source_id,
            f.chunk_id,
            f.field,
            f.value,
            f.quote,
            j.id,
          ],
        );
      }
      if (fresh.length) {
        await db.query(
          "UPDATE app.brand_review_state SET finding_count=finding_count+$3 WHERE organization_id=$1 AND brand_id=$2",
          [j.organization_id, j.brand_id, fresh.length],
        );
      }
      // Even an empty new analysis supersedes earlier visual suggestions.
      await bumpReview(db, j.organization_id, j.brand_id);
      if (call.result.recommendation)
        await db.query(
          "INSERT INTO app.onboarding_recommendations(id,organization_id,brand_id,job_id,review_revision,model,recommendation) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            j.organization_id,
            j.brand_id,
            j.id,
            revision + 1,
            call.model,
            JSON.stringify(call.result.recommendation),
          ],
        );
      await db.query(
        "UPDATE app.intake_requests SET result=$2 WHERE job_id=$1",
        [
          j.id,
          JSON.stringify({
            ...(call.result.business_direction ? {business_direction:call.result.business_direction} : {}),
            findings: fresh.length,
            missing: call.result.missing,
            recommendationAvailable: !!call.result.recommendation,
            ...(call.result.website_unread ? {website_unread:true} : {}),
            visual_guidance: call.result.visual_guidance ?? [],
            visual_manifest: call.result.visual_manifest ?? [],
            ...(followup ? { market_followup: followup } : {}),
          }),
        ],
      );
      return this.finish(db, j, "succeeded");
    });
  }
  fail(scope: JobScope) {
    return this.jobs.transaction(scope, async (db, j) => {
      if (!["website.extract", "brand.analyze"].includes(j.kind))
        throw new Error("JOB_KIND_DENIED");
      if (terminal.has(j.status)) return j.status;
      if (j.kind === "brand.analyze" && j.attempt === 0 &&
          (await db.query("SELECT analysis_job_id FROM app.intake_dependencies WHERE analysis_job_id=$1", [j.id])).rowCount) {
        return this.finish(db,j,"failed","WEBSITE_PREREQUISITE_TIMEOUT");
      }
      // Only an uncertain paid call needs review. Anything else stays retryable.
      const call = j.kind === "brand.analyze"
        ? ((await db.query("SELECT status FROM app.analysis_calls WHERE job_id=$1", [j.id])).rows[0]?.status ?? null)
        : null;
      const outcome = exhaustedIntakeOutcome(j.kind, call);
      return this.finish(db, j, outcome.status, outcome.code);
    });
  }
}
