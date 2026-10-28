import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { TenantDatabase } from "./database.js";
import { object, uuid } from "./workspaces.js";
import {visualDirections,reviewVisual,approvedVisualFacts} from "./brand-visual-review.js";
export const FIELDS = [
  "brand_name",
  "offering",
  "audience",
  "voice",
  "colors",
  "prohibited_claims",
  "positioning",
  "cta",
  "fonts",
  "products",
] as const;
export function canonicalJSON(value: unknown): string {
  const normalized = JSON.parse(JSON.stringify(value));
  const ordered = (v: any): any =>
    Array.isArray(v)
      ? v.map(ordered)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, ordered(v[k])]),
          )
        : v;
  return JSON.stringify(ordered(normalized));
}
export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function text(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 4000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new BadRequestException("Use 1–4000 characters of plain text");
  return value.trim();
}
function key(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{8,128}$/.test(value))
    throw new BadRequestException("An Idempotency-Key is required");
  return value;
}
export async function lockReview(db: PoolClient, org: string, brand: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `brain:${org}:${brand}`,
  ]);
  await db.query(
    "INSERT INTO app.brand_review_state(organization_id,brand_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [org, brand],
  );
  return (
    await db.query(
      "SELECT revision FROM app.brand_review_state WHERE organization_id=$1 AND brand_id=$2 FOR UPDATE",
      [org, brand],
    )
  ).rows[0].revision as number;
}
export async function bumpReview(db: PoolClient, org: string, brand: string) {
  await db.query(
    "UPDATE app.brand_review_state SET revision=revision+1 WHERE organization_id=$1 AND brand_id=$2",
    [org, brand],
  );
}
export class BrandBrain {
  constructor(readonly database: TenantDatabase) {}
  private run<T>(
    user: string,
    org: string,
    brand: string,
    write: boolean,
    action: (db: PoolClient) => Promise<T>,
  ) {
    org = uuid(org);
    brand = uuid(brand);
    return this.database.transaction(
      user,
      org,
      write,
      async (db) => {
        if (
          !(
            await db.query(
              "SELECT id FROM app.brands WHERE organization_id=$1 AND id=$2",
              [org, brand],
            )
          ).rowCount
        )
          throw new NotFoundException("Brand not found");
        return action(db);
      },
      brand,
    );
  }
  async read(user: string, org: string, brand: string) {
    return this.run(user, org, brand, false, async (db) => {
      const state = (
        await db.query(
          "SELECT revision FROM app.brand_review_state WHERE organization_id=$1 AND brand_id=$2 FOR SHARE",
          [org, brand],
        )
      ).rows[0];
      const sources = (
        await db.query(
          "SELECT id,asset_id,website_url,kind,sha256,parser_version,coverage,captured_at FROM app.brand_sources WHERE organization_id=$1 AND brand_id=$2 ORDER BY captured_at,id LIMIT 100",
          [org, brand],
        )
      ).rows;
      const findings = (
        await db.query(
          `SELECT f.*,c.page,c.anchor,c.text AS evidence FROM app.brand_findings f JOIN app.brand_chunks c ON c.id=f.chunk_id AND c.organization_id=f.organization_id AND c.brand_id=f.brand_id WHERE f.organization_id=$1 AND f.brand_id=$2 ORDER BY f.field,f.id LIMIT 501`,
          [org, brand],
        )
      ).rows;
      const active =
        (
          await db.query(
            "SELECT * FROM app.brand_brain_versions WHERE organization_id=$1 AND brand_id=$2 ORDER BY review_revision DESC LIMIT 1",
            [org, brand],
          )
        ).rows[0] ?? null;
      const jobs = (
        await db.query(
          "SELECT id,asset_id,status,error_code FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind='document.extract' ORDER BY created_at DESC LIMIT 10",
          [org, brand],
        )
      ).rows;
      return {
        visuals: await visualDirections(db,org,brand),
        revision: state?.revision ?? 0,
        sources,
        findings,
        active,
        jobs,
      };
    });
  }
  async source(user: string, org: string, brand: string, id: string) {
    id = uuid(id);
    return this.run(user, org, brand, false, async (db) => {
      const source = (
        await db.query(
          "SELECT * FROM app.brand_sources WHERE organization_id=$1 AND brand_id=$2 AND id=$3",
          [org, brand, id],
        )
      ).rows[0];
      if (!source) throw new NotFoundException("Source not found");
      return {
        ...source,
        chunks: (
          await db.query(
            "SELECT id,page,anchor,bbox,text FROM app.brand_chunks WHERE organization_id=$1 AND brand_id=$2 AND source_id=$3 ORDER BY page,id LIMIT 2000",
            [org, brand, id],
          )
        ).rows,
      };
    });
  }
  async manual(
    user: string,
    org: string,
    brand: string,
    input: unknown,
    requestKey: unknown,
  ) {
    const body = object(input, ["field", "value"]),
      value = text(body.value);
    if (!FIELDS.includes(body.field as any))
      throw new BadRequestException("Unknown brand field");
    const k = key(requestKey),
      digest = hash(JSON.stringify([body.field, value]));
    return this.run(user, org, brand, true, async (db) => {
      await lockReview(db, org, brand);
      const operation = `brain.manual:${brand}`;
      const prior = (
        await db.query(
          "SELECT request_hash,response FROM app.idempotency WHERE organization_id=$1 AND operation=$2 AND key=$3",
          [org, operation, k],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== digest)
          throw new ConflictException(
            "This request key was used for different content",
          );
        return prior.response;
      }
      const usage = (
        await db.query(
          "SELECT finding_count,source_count FROM app.brand_review_state WHERE organization_id=$1 AND brand_id=$2",
          [org, brand],
        )
      ).rows[0];
      if (usage.finding_count >= 500 || usage.source_count >= 100)
        throw new ConflictException("This brand has reached its finding limit");
      const source = randomUUID(),
        chunk = randomUUID(),
        id = randomUUID(),
        evidence = `${body.field}: ${value}`;
      await db.query(
        "INSERT INTO app.brand_sources(id,organization_id,brand_id,kind,sha256,parser_version,coverage) VALUES($1,$2,$3,'manual',$4,'manual-v1',$5)",
        [
          source,
          org,
          brand,
          hash(evidence),
          JSON.stringify({ type: "user_supplied" }),
        ],
      );
      await db.query(
        "INSERT INTO app.brand_chunks(id,organization_id,brand_id,source_id,page,anchor,text) VALUES($1,$2,$3,$4,1,'manual',$5)",
        [chunk, org, brand, source, evidence],
      );
      await db.query(
        "INSERT INTO app.brand_findings(id,organization_id,brand_id,source_id,chunk_id,field,original_value,value,extraction_type) VALUES($1,$2,$3,$4,$5,$6,$7,$7,'manual')",
        [id, org, brand, source, chunk, body.field, value],
      );
      await db.query(
        "UPDATE app.brand_review_state SET source_count=source_count+1,finding_count=finding_count+1 WHERE organization_id=$1 AND brand_id=$2",
        [org, brand],
      );
      await bumpReview(db, org, brand);
      await this.audit(db, user, org, brand, "brain.manual_added", id);
      const result = { id, status: "unreviewed", revision: 1 };
      await db.query(
        "INSERT INTO app.idempotency(organization_id,operation,key,request_hash,response) VALUES($1,$2,$3,$4,$5)",
        [org, operation, k, digest, JSON.stringify(result)],
      );
      return result;
    });
  }
  async review(
    user: string,
    org: string,
    brand: string,
    id: string,
    input: unknown,
  ) {
    id = uuid(id);
    const body = object(input, ["revision", "decision", "value", "alternatives"]);
    if (
      !["correct", "wrong", "edited"].includes(String(body.decision)) ||
      !Number.isSafeInteger(body.revision) ||
      Number(body.revision) < 1
    )
      throw new BadRequestException(
        "A saved revision and Correct, Wrong or Edit decision are required",
      );
    const alternatives = body.alternatives === undefined ? [] : body.alternatives;
    if (!Array.isArray(alternatives) || alternatives.length > 499 ||
        alternatives.some((a:any) => !a || typeof a !== 'object' || !Number.isSafeInteger(a.revision) || a.revision < 1) ||
        (alternatives.length && body.decision === 'wrong'))
      throw new BadRequestException('Choose a description before replacing alternatives');
    const alternativeIds = alternatives.map((a:any) => uuid(a.id));
    if (new Set(alternativeIds).size !== alternativeIds.length || alternativeIds.includes(id))
      throw new BadRequestException('Duplicate alternative');
    const value = body.decision === "edited" ? text(body.value) : null;
    if (body.decision !== "edited" && body.value !== undefined)
      throw new BadRequestException("Only Edit accepts a replacement value");
    return this.run(user, org, brand, true, async (db) => {
      await lockReview(db, org, brand);
      const result = (
        await db.query(
          `UPDATE app.brand_findings SET status=$4,value=CASE WHEN $4='edited' THEN $5 ELSE original_value END,revision=revision+1,reviewed_by=$6,reviewed_at=now() WHERE organization_id=$1 AND brand_id=$2 AND id=$3 AND revision=$7 RETURNING id,status,value,revision,field`,
          [org, brand, id, body.decision, value, user, body.revision],
        )
      ).rows[0];
      if (!result) {
        if (
          !(
            await db.query(
              "SELECT id FROM app.brand_findings WHERE organization_id=$1 AND brand_id=$2 AND id=$3",
              [org, brand, id],
            )
          ).rowCount
        )
          throw new NotFoundException("Finding not found");
        throw new ConflictException(
          "This finding changed. Reload before saving your decision.",
        );
      }
      for (const alternative of alternatives) {
        const replaced = await db.query(
          `UPDATE app.brand_findings SET status='wrong',revision=revision+1,reviewed_by=$6,reviewed_at=now()
           WHERE organization_id=$1 AND brand_id=$2 AND id=$3 AND revision=$4 AND field=$5 RETURNING id`,
          [org,brand,alternative.id,alternative.revision,result.field,user]);
        if (!replaced.rowCount) throw new ConflictException('These descriptions changed. Refresh your profile and choose again.');
        await this.audit(db,user,org,brand,'brain.wrong',alternative.id);
      }
      await bumpReview(db, org, brand);
      await this.audit(db, user, org, brand, `brain.${body.decision}`, id);
      return result;
    });
  }
  async reviewVisual(user:string,org:string,brand:string,input:unknown){
    return this.run(user,org,brand,true,async db=>{
      const result=await reviewVisual(db,user,org,brand,input);
      await this.audit(db,user,org,brand,`brain.visual_${result.status}`,result.id);
      return result;
    });
  }
  async approve(user: string, org: string, brand: string, input: unknown) {
    const { revision } = object(input, ["revision"]);
    if (!Number.isSafeInteger(revision) || Number(revision) < 1)
      throw new BadRequestException("The reviewed draft revision is required");
    return this.run(user, org, brand, true, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `members:${org}`,
      ]);
      const role = (
        await db.query(
          "SELECT role FROM app.memberships WHERE organization_id=$1 AND user_id=$2 AND active",
          [org, user],
        )
      ).rows[0]?.role;
      if (!["owner", "admin"].includes(role))
        throw new ForbiddenException(
          "Only a client owner or admin can approve brand facts",
        );
      const current = await lockReview(db, org, brand);
      if (current !== revision)
        throw new ConflictException(
          "The brand draft changed. Review the latest findings before approving.",
        );
      const prior = (
        await db.query(
          "SELECT * FROM app.brand_brain_versions WHERE organization_id=$1 AND brand_id=$2 AND review_revision=$3",
          [org, brand, revision],
        )
      ).rows[0];
      if (prior) return prior;
      const findings = (
        await db.query(
          `SELECT f.id,f.field,f.value,f.status,f.source_id,f.chunk_id,f.reviewed_by,f.reviewed_at,c.page,c.anchor,s.sha256 AS source_sha256 FROM app.brand_findings f JOIN app.brand_chunks c ON c.id=f.chunk_id AND c.organization_id=f.organization_id AND c.brand_id=f.brand_id JOIN app.brand_sources s ON s.id=f.source_id AND s.organization_id=f.organization_id AND s.brand_id=f.brand_id WHERE f.organization_id=$1 AND f.brand_id=$2 ORDER BY f.field,f.id`,
          [org, brand],
        )
      ).rows;
      if (findings.some((f) => f.status === "unreviewed"))
        throw new ConflictException(
          "Review every finding or mark it Wrong before approving",
        );
      const accepted = findings.filter(
          (f) => f.status === "correct" || f.status === "edited",
        ),
        values = new Map<string, string>();
      for (const finding of accepted) {
        if (
          values.has(finding.field) &&
          values.get(finding.field) !== finding.value
        )
          throw new ConflictException(
            `Resolve conflicting ${finding.field.replaceAll("_", " ")} findings before approving`,
          );
        values.set(finding.field, finding.value);
      }
      if (
        ["brand_name", "offering", "audience"].some(
          (field) => !values.has(field),
        )
      )
        throw new ConflictException(
          "Confirm the brand name, offering and audience before approving",
        );
      const visualFacts = await approvedVisualFacts(db,org,brand);
      const snapshot = {
          schema_version: 1,
          facts: [...accepted,...visualFacts],
          missing_fields: FIELDS.filter((field) => !values.has(field)),
        },
        serialized = canonicalJSON(snapshot),
        id = randomUUID();
      if (Buffer.byteLength(serialized) > 240000)
        throw new ConflictException(
          "This profile contains too much accepted evidence. Mark duplicate findings Wrong before approving.",
        );
      const result = (
        await db.query(
          "INSERT INTO app.brand_brain_versions(id,organization_id,brand_id,review_revision,snapshot,sha256,approved_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [id, org, brand, revision, serialized, hash(serialized), user],
        )
      ).rows[0];
      await this.audit(db, user, org, brand, "brain.approved", id);
      return result;
    });
  }
  async version(user: string, org: string, brand: string, id: string) {
    id = uuid(id);
    return this.run(user, org, brand, false, async (db) => {
      const row = (
        await db.query(
          "SELECT * FROM app.brand_brain_versions WHERE organization_id=$1 AND brand_id=$2 AND id=$3",
          [org, brand, id],
        )
      ).rows[0];
      if (!row) throw new NotFoundException("Brand version not found");
      return row;
    });
  }
  private async audit(
    db: PoolClient,
    user: string,
    org: string,
    brand: string,
    action: string,
    id: string,
  ) {
    await db.query(
      "INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,$4,$5)",
      [org, brand, user, action, id],
    );
  }
}
