type WebsiteIntake = {capture(jobs:AssetJobs,scope:JobScope,url:string):Promise<{
 pages:WebsitePage[];captures:Map<string,{capture:VisualCapture;objects:{key:string;bytes:number;shot:VisualCapture['snapshots'][number]}[]}>;
 visualErrors:{url:string;code:string}[];coverage:Record<string,any>;
}>};
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
} from "./brand-analysis.js";
import { lockReview, bumpReview } from "./brand-brain.js";
import { prepareVisuals, visualManifest } from "./visual-analysis.js";
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
      if (terminal.has(j.status)) return null;
      if (!(await this.jobs.permitted(db, j))) {
        await this.finish(db, j, "canceled", "ACCESS_REVOKED_OR_CANCELED");
        return null;
      }
      if (j.kind === "brand.analyze") {
        const parent = (await db.query("SELECT p.status,p.cancel_requested FROM app.intake_dependencies d JOIN app.jobs p ON p.id=d.capture_job_id WHERE d.analysis_job_id=$1", [j.id])).rows[0];
        if (parent) {
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
    if (job.waiting) return "waiting";
    try {
      return job.kind === "website.extract"
        ? await this.crawl(scope)
        : await this.analyze(scope);
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
            "SELECT website_url FROM app.intake_requests WHERE job_id=$1",
            [j.id],
          )
        ).rows[0],
    );
    if(this.websiteIntake){
      const captured=await this.websiteIntake.capture(this.jobs,scope,input.website_url);
      return this.persistWebsite(scope,captured.pages,captured.captures,captured.visualErrors,captured.coverage);
    }
    throw new IntakeError("AI_NOT_CONFIGURED");
  }
  private async persistWebsite(scope:JobScope,pages:WebsitePage[],captures:Map<string,{capture:VisualCapture;objects:{key:string;bytes:number;shot:VisualCapture["snapshots"][number]}[]}>,visualErrors:{url:string;code:string}[],coverage:any){
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
                page.coverage === "ai_web_research"
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
      if (inserted) {
        await db.query(
          "UPDATE app.brand_review_state SET source_count=source_count+$3 WHERE organization_id=$1 AND brand_id=$2",
          [j.organization_id, j.brand_id, inserted],
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
              coverage.method === "web_research" ? "ai_web_research" : coverage.provider === "self_hosted_browser"
                ? coverage.screenshotsAvailable ? "rendered_provider" : captures.size ? "partial_visual" : "server_html_only"
                : captures.size === pages.length && !visualErrors.length
                ? coverage.provider === "maxun" ? "rendered_provider" : "rendered_desktop_mobile"
                : captures.size
                  ? "partial_visual"
                  : "server_html_only",
            visualPages: captures.size,
            visualErrors,
            newSources: inserted,
          }),
        ],
      );
      return this.finish(db, j, "succeeded");
    });
  }
  async analyze(scope: JobScope) {
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
      const documentRows = (await db.query(`SELECT v.*,v.page AS document_page,s.sha256 AS document_sha256,'document' AS viewport,'{}'::jsonb AS observations
        FROM app.document_visuals v JOIN app.brand_sources s ON s.id=v.source_id
        WHERE v.organization_id=$1 AND v.brand_id=$2
        ORDER BY v.captured_at DESC,v.source_id,v.page LIMIT 10`, [j.organization_id,j.brand_id])).rows;
      const documentPageCount = Number((await db.query("SELECT count(*) AS n FROM app.document_visuals WHERE organization_id=$1 AND brand_id=$2", [j.organization_id,j.brand_id])).rows[0].n);
      // Share the existing ten-source budget. Keep website evidence alongside
      // documents, and record exactly which pages reached the model manifest.
      const selectedRows = documentRows.length ? [...rows.slice(0, Math.min(rows.length, 4)), ...documentRows.slice(0, 10-Math.min(rows.length, 4))] : rows;
      if (!selectedRows.length) return null;
      const grant = (
        await db.query(
          "SELECT max_tokens_per_image FROM app.analysis_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()",
          [j.organization_id, j.brand_id],
        )
      ).rows[0];
      if (!grant?.max_tokens_per_image)
        throw new IntakeError("AI_VISION_APPROVAL_REQUIRED");
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
      const chunks = (
        await db.query(
          "SELECT c.id,c.source_id,c.text,c.page,s.website_url FROM app.brand_chunks c JOIN app.brand_sources s ON s.id=c.source_id WHERE c.organization_id=$1 AND c.brand_id=$2 ORDER BY s.captured_at DESC,c.page,c.anchor,c.id LIMIT 100",
          [j.organization_id, j.brand_id],
        )
      ).rows;
      let length = 0;
      const selected = chunks.flatMap((c) => {
        const text = c.text.slice(0, 40000 - length);
        length += text.length;
        return text ? [{ ...c, text }] : [];
      });
      const reviewed = (
        await db.query(
          "SELECT field,value,status FROM app.brand_findings WHERE organization_id=$1 AND brand_id=$2 AND status<>'unreviewed' ORDER BY field,id LIMIT 500",
          [j.organization_id, j.brand_id],
        )
      ).rows;
      const input: AnalysisInput = {
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
            "SELECT COALESCE(sum(reserved_micros),0) AS used FROM app.analysis_calls WHERE organization_id=$1 AND brand_id=$2",
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
          "UPDATE app.analysis_calls SET status='succeeded',response_id=$2,result=$3,usage=$4 WHERE job_id=$1",
          [
            j.id,
            response.id,
            JSON.stringify({
              ...response.result,
              visual_manifest: visualManifest(prepared.input.visuals ?? []),
              visual_coverage: {
                document_pages_available: visualEvidence?.documentPageCount ?? 0,
                document_pages_analyzed: (prepared.input.visuals ?? []).filter(v => v.document_page).map(v => ({source_id:v.source_id,page:v.document_page})),
                limited: (visualEvidence?.documentPageCount ?? 0) > (prepared.input.visuals ?? []).filter(v => v.document_page).length,
              },
            }),
            JSON.stringify(response.usage),
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
            findings: fresh.length,
            missing: call.result.missing,
            recommendationAvailable: !!call.result.recommendation,
            visual_guidance: call.result.visual_guidance ?? [],
            visual_manifest: call.result.visual_manifest ?? [],
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
      return this.finish(
        db,
        j,
        j.kind === "brand.analyze" ? "unknown" : "failed",
        j.kind === "brand.analyze"
          ? "AI_SUBMISSION_REQUIRES_REVIEW"
          : "WEBSITE_RETRIES_EXHAUSTED",
      );
    });
  }
}
