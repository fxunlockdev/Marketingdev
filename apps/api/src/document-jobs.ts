import { randomUUID } from "node:crypto";
import { AssetJobs, type JobScope } from "./jobs.js";
import {
  DocumentParser,
  DocumentError,
  PARSER_VERSION,
  type ParsedDocument,
} from "./document-parser.js";
import { digest } from "./object-store.js";
import { lockReview, bumpReview } from "./brand-brain.js";
const terminal = new Set(["succeeded", "rejected", "failed", "canceled"]);
const labels: Record<string, string> = {
  "brand name": "brand_name",
  offering: "offering",
  audience: "audience",
  voice: "voice",
  colors: "colors",
  "prohibited claims": "prohibited_claims",
  positioning: "positioning",
  cta: "cta",
  fonts: "fonts",
  products: "products",
};
export function literalFindings(doc: ParsedDocument) {
  return doc.chunks
    .flatMap((chunk, index) =>
      chunk.text.split(/\r?\n/).flatMap((line) => {
        const match = /^([A-Za-z ]{2,30}):\s*(.{1,4000})$/.exec(line.trim());
        const field = match && labels[match[1].toLowerCase()];
        return field ? [{ index, field, value: match![2].trim() }] : [];
      }),
    )
    .filter((f) => f.value);
}
export class DocumentJobs {
  constructor(
    readonly jobs: AssetJobs,
    readonly parser: DocumentParser,
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
  async extract(scope: JobScope): Promise<string> {
    const asset = await this.jobs.transaction(scope, async (db, job) => {
      if (job.kind !== "document.extract") throw new Error("JOB_KIND_DENIED");
      if (terminal.has(job.status)) return null;
      if (!(await this.jobs.permitted(db, job))) {
        await this.finish(db, job, "canceled", "ACCESS_REVOKED_OR_CANCELED");
        return null;
      }
      const asset = (
        await db.query("SELECT * FROM app.assets WHERE id=$1", [job.asset_id])
      ).rows[0];
      if (
        !asset ||
        asset.state !== "ready" ||
        ![
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ].includes(asset.content_type)
      ) {
        await this.finish(db, job, "rejected", "DOCUMENT_NOT_READY");
        return null;
      }
      await db.query(
        "UPDATE app.jobs SET status='running',attempt=attempt+1,error_code=NULL,updated_at=now() WHERE id=$1",
        [job.id],
      );
      return asset;
    });
    if (!asset) return "finished";
    try {
      const bytes = await this.jobs.store.read(asset.canonical_key);
      if (
        bytes.length !== asset.expected_bytes ||
        digest(bytes) !== asset.sha256
      )
        throw new DocumentError("DOCUMENT_INTEGRITY_FAILED");
      const document = await this.parser.parse(
          bytes,
          asset.content_type === "application/pdf" ? "pdf" : "pptx",
        ),
        findings = literalFindings(document);
      return await this.jobs.transaction(scope, async (db, job) => {
        if (terminal.has(job.status)) return job.status;
        if (!(await this.jobs.permitted(db, job)))
          return this.finish(db, job, "canceled", "ACCESS_REVOKED_OR_CANCELED");
        await lockReview(db, job.organization_id, job.brand_id);
        if (
          (
            await db.query(
              "SELECT id FROM app.brand_sources WHERE asset_id=$1 AND parser_version=$2",
              [asset.id, PARSER_VERSION],
            )
          ).rowCount
        )
          return this.finish(db, job, "succeeded");
        const state = (
          await db.query(
            "SELECT source_count,finding_count FROM app.brand_review_state WHERE organization_id=$1 AND brand_id=$2",
            [job.organization_id, job.brand_id],
          )
        ).rows[0];
        if (
          state.source_count >= 100 ||
          state.finding_count + findings.length > 500
        )
          throw new DocumentError("BRAND_EVIDENCE_LIMIT_EXCEEDED");
        const source = randomUUID(),
          ids = document.chunks.map(() => randomUUID());
        await db.query(
          "INSERT INTO app.brand_sources(id,organization_id,brand_id,asset_id,kind,sha256,parser_version,coverage) VALUES($1,$2,$3,$4,'document',$5,$6,$7)",
          [
            source,
            job.organization_id,
            job.brand_id,
            asset.id,
            document.sha256,
            PARSER_VERSION,
            JSON.stringify({
              type: document.coverage,
              pages: document.pages,
              text_pages: document.textPages,
              warning:
                "Images, scanned text, tables and visual design require additional review.",
            }),
          ],
        );
        // Batches remain inside the same transaction: no partial evidence after interruption.
        for (let start = 0; start < document.chunks.length; start += 100) {
          const batch = document.chunks
            .slice(start, start + 100)
            .map((c, i) => ({ ...c, id: ids[start + i] }));
          await db.query(
            `INSERT INTO app.brand_chunks(id,organization_id,brand_id,source_id,page,anchor,bbox,text) SELECT x.id,$1,$2,$3,x.page,x.anchor,x.bbox,x.text FROM jsonb_to_recordset($4::jsonb) AS x(id uuid,page integer,anchor text,bbox jsonb,text text)`,
            [job.organization_id, job.brand_id, source, JSON.stringify(batch)],
          );
        }
        if (findings.length)
          await db.query(
            `INSERT INTO app.brand_findings(id,organization_id,brand_id,source_id,chunk_id,field,original_value,value,extraction_type) SELECT x.id,$1,$2,$3,x.chunk_id,x.field,x.value,x.value,'literal_label' FROM jsonb_to_recordset($4::jsonb) AS x(id uuid,chunk_id uuid,field text,value text)`,
            [
              job.organization_id,
              job.brand_id,
              source,
              JSON.stringify(
                findings.map((f) => ({
                  id: randomUUID(),
                  chunk_id: ids[f.index],
                  field: f.field,
                  value: f.value,
                })),
              ),
            ],
          );
        await db.query(
          "UPDATE app.brand_review_state SET source_count=source_count+1,finding_count=finding_count+$3 WHERE organization_id=$1 AND brand_id=$2",
          [job.organization_id, job.brand_id, findings.length],
        );
        await bumpReview(db, job.organization_id, job.brand_id);
        return this.finish(db, job, "succeeded");
      });
    } catch (error) {
      const permanent = error instanceof DocumentError,
        code = permanent ? error.code : "DOCUMENT_SERVICE_UNAVAILABLE";
      const status = await this.jobs.transaction(scope, async (db, job) => {
        if (terminal.has(job.status)) return job.status;
        if (!(await this.jobs.permitted(db, job)))
          return this.finish(db, job, "canceled", "ACCESS_REVOKED_OR_CANCELED");
        return this.finish(db, job, permanent ? "rejected" : "retrying", code);
      });
      if (status === "retrying") throw new Error(code);
      return status;
    }
  }
  fail(scope: JobScope) {
    return this.jobs.transaction(scope, async (db, job) => {
      if (job.kind !== "document.extract") throw new Error("JOB_KIND_DENIED");
      if (terminal.has(job.status)) return job.status;
      return this.finish(db, job, "failed", "DOCUMENT_RETRIES_EXHAUSTED");
    });
  }
}
