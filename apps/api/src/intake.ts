import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Businesses } from "./businesses.js";
import { ObjectStore } from "./object-store.js";
import { object, uuid } from "./workspaces.js";
import { canonicalJSON, hash } from "./brand-brain.js";
import { websiteURL, IntakeError } from "./safe-web.js";
export class Intake {
  constructor(
    readonly businesses: Businesses,
    readonly store?: ObjectStore,
  ) {}
  async read(user: string, id: string) {
    const b = await this.businesses.resolve(user, id);
    return this.businesses.database.transaction(
      user,
      b.organization_id,
      false,
      async (db) => ({
        visuals: (
          await db.query(
            `SELECT * FROM (
              SELECT v.id,v.source_id,v.viewport,v.width,v.height,v.observations,v.coverage,s.website_url,NULL::integer AS document_page,v.captured_at FROM app.website_visuals v JOIN app.brand_sources s ON s.id=v.source_id WHERE v.organization_id=$1 AND v.brand_id=$2
              UNION ALL
              SELECT v.id,v.source_id,'document',v.width,v.height,'{}'::jsonb,'{}'::jsonb,NULL::text,v.page,v.captured_at FROM app.document_visuals v WHERE v.organization_id=$1 AND v.brand_id=$2
              UNION ALL
              SELECT v.id,v.asset_id,'upload',v.width,v.height,'{}'::jsonb,'{}'::jsonb,NULL::text,NULL::integer,v.captured_at FROM app.uploaded_visuals v WHERE v.organization_id=$1 AND v.brand_id=$2
            ) evidence ORDER BY captured_at DESC,source_id,document_page LIMIT 70`,
            [b.organization_id, id],
          )
        ).rows,
        jobs: (
          await db.query(
            `SELECT j.id,j.kind,j.status,j.error_code,j.created_at,j.updated_at,r.website_url,r.result FROM app.jobs j JOIN app.intake_requests r ON r.job_id=j.id WHERE j.organization_id=$1 AND j.brand_id=$2 ORDER BY j.created_at DESC LIMIT 20`,
            [b.organization_id, id],
          )
        ).rows,
        recommendation:
          (
            await db.query(
              "SELECT * FROM app.onboarding_recommendations WHERE organization_id=$1 AND brand_id=$2 ORDER BY created_at DESC LIMIT 1",
              [b.organization_id, id],
            )
          ).rows[0] ?? null,
      }),
      id,
    );
  }
  async visual(user: string, id: string, visualId: string) {
    const b = await this.businesses.resolve(user, id);
    visualId = uuid(visualId);
    return this.businesses.database.transaction(
      user,
      b.organization_id,
      false,
      async (db) => {
        const v = (
          await db.query(
            "SELECT object_key,viewport,sha256,bytes FROM app.website_visuals WHERE organization_id=$1 AND brand_id=$2 AND id=$3 UNION ALL SELECT object_key,'document-page-'||page,sha256,bytes FROM app.document_visuals WHERE organization_id=$1 AND brand_id=$2 AND id=$3 UNION ALL SELECT object_key,'uploaded-photo',sha256,bytes FROM app.uploaded_visuals WHERE organization_id=$1 AND brand_id=$2 AND id=$3",
            [b.organization_id, id, visualId],
          )
        ).rows[0];
        if (!v || !this.store)
          throw new NotFoundException("Visual reference not found");
        return {
          url: await this.store.downloadURL(
            v.object_key,
            `brand-${v.viewport}.jpg`,
            "image/jpeg",
          ),
          expiresIn: 60,
          sha256: v.sha256,
          bytes: v.bytes,
        };
      },
      id,
    );
  }
  async submit(user: string, id: string, input: unknown, key: unknown) {
    const b = await this.businesses.resolve(user, id),
      v = object(input, ["kind"]);
    if (!["website.extract", "brand.analyze"].includes(String(v.kind)))
      throw new BadRequestException(
        "Choose website extraction or brand analysis",
      );
    if (typeof key !== "string" || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key))
      throw new BadRequestException("An Idempotency-Key is required");
    let url: string | null = null;
    if (v.kind === "website.extract") {
      try {
        url = websiteURL(b.website ?? "").href;
      } catch (e) {
        throw new BadRequestException(
          e instanceof IntakeError ? e.code : "INVALID_WEBSITE_URL",
        );
      }
    }
    const requestHash = hash(canonicalJSON({ kind: v.kind, url }));
    return this.businesses.database.transaction(
      user,
      b.organization_id,
      true,
      async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `intake:${id}`,
        ]);
        const prior = (
          await db.query(
            "SELECT r.request_hash,j.id,j.status FROM app.intake_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.organization_id=$1 AND r.brand_id=$2 AND r.request_key=$3",
            [b.organization_id, id, key],
          )
        ).rows[0];
        if (prior) {
          if (prior.request_hash !== requestHash)
            throw new ConflictException(
              "That request key was already used for different input",
            );
          return { id: prior.id, status: prior.status };
        }
        const active = (
          await db.query(
            "SELECT id,status FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind IN ('website.extract','brand.analyze') AND status IN ('queued','running','retrying') LIMIT 1",
            [b.organization_id, id],
          )
        ).rows[0];
        if (active)
          throw new ConflictException(
            "Website or AI analysis is already running for this business",
          );
        if (
          v.kind === "brand.analyze" &&
          (
            await db.query(
              "SELECT id FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind='brand.analyze' AND status='unknown' LIMIT 1",
              [b.organization_id, id],
            )
          ).rowCount
        )
          throw new ConflictException(
            "An earlier AI request has an uncertain outcome. An operator must reconcile it before another generation.",
          );
        const count = (
          await db.query(
            "SELECT count(*)::int AS n FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind IN ('website.extract','brand.analyze') AND created_at>now()-interval '1 day'",
            [b.organization_id, id],
          )
        ).rows[0].n;
        if (count >= 20)
          throw new ConflictException("Daily brand analysis limit reached");
        if (
          v.kind === "brand.analyze" &&
          !(
            await db.query(
              "SELECT id FROM app.brand_chunks WHERE organization_id=$1 AND brand_id=$2 LIMIT 1",
              [b.organization_id, id],
            )
          ).rowCount
        )
          throw new ConflictException("Add website or document evidence first");
        const job = randomUUID();
        await db.query(
          "INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,$5)",
          [job, b.organization_id, id, user, v.kind],
        );
        await db.query(
          "INSERT INTO app.intake_requests(job_id,organization_id,brand_id,request_key,request_hash,website_url) VALUES($1,$2,$3,$4,$5,$6)",
          [job, b.organization_id, id, key, requestHash, url],
        );
        await db.query(
          "INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,$4)",
          [job, b.organization_id, id, v.kind],
        );
        await db.query(
          "INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'intake.submitted',$4)",
          [b.organization_id, id, user, job],
        );
        return { id: job, status: "queued" };
      },
      id,
    );
  }
}
