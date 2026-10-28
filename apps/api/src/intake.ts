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
            `SELECT j.id,j.kind,j.status,j.error_code,j.created_at,j.updated_at,r.website_url,r.result,
            (SELECT source_job_id FROM app.intake_recoveries WHERE job_id=j.id) AS recovery_of,
            (j.kind='website.extract' AND (j.status='unknown' OR (j.status='succeeded' AND jsonb_array_length(COALESCE(r.result->'visualErrors','[]'::jsonb))>0)) AND NOT j.cancel_requested AND NOT EXISTS(SELECT 1 FROM app.intake_recoveries rr JOIN app.jobs done ON done.id=rr.job_id WHERE rr.source_job_id=COALESCE((SELECT source_job_id FROM app.intake_recoveries WHERE job_id=j.id),j.id) AND done.status='succeeded') AND EXISTS(SELECT 1 FROM app.website_capture_calls c
              WHERE c.job_id=COALESCE((SELECT source_job_id FROM app.intake_recoveries WHERE job_id=j.id),j.id)
              AND (c.checkpoint->>'phase'='polling' OR (c.checkpoint->>'phase'='submitting' AND c.checkpoint ? 'submittedAt')))) AS can_recover,(SELECT d.analysis_job_id FROM app.intake_dependencies d WHERE d.capture_job_id=j.id) AS auto_analysis_job_id FROM app.jobs j JOIN app.intake_requests r ON r.job_id=j.id WHERE j.organization_id=$1 AND j.brand_id=$2 ORDER BY j.created_at DESC,j.updated_at DESC,j.id DESC LIMIT 20`,
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
      v = object(input, ["kind", "autoAnalyze", "recoverJobId"]);
    if (!["website.extract", "brand.analyze"].includes(String(v.kind)))
      throw new BadRequestException(
        "Choose website extraction or brand analysis",
      );
    if (v.autoAnalyze !== undefined && (typeof v.autoAnalyze !== "boolean" || v.kind !== "website.extract"))
      throw new BadRequestException("Automatic analysis is only available for website capture");
    const automatic = v.autoAnalyze === true;
    const recovery=v.recoverJobId===undefined?null:uuid(String(v.recoverJobId));
    if(recovery&&automatic)throw new BadRequestException("Capture recovery does not start paid AI analysis; prepare the brand after recovery");
    if(recovery&&v.kind!=="website.extract")throw new BadRequestException("Only website captures can be recovered");
    if (typeof key !== "string" || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key))
      throw new BadRequestException("An Idempotency-Key is required");
    let url: string | null = null;
    if (v.kind === "website.extract" && !recovery) {
      try {
        url = websiteURL(b.website ?? "").href;
      } catch (e) {
        throw new BadRequestException(
          e instanceof IntakeError ? e.code : "INVALID_WEBSITE_URL",
        );
      }
    }
    const requestHash = hash(canonicalJSON({ kind: v.kind, url, ...(automatic ? { autoAnalyze: true } : {}),...(recovery?{recoverJobId:recovery}:{}) }));
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
        let sourceId:string|null=null;
        if(recovery){
          const source=(await db.query(`SELECT j.id,r.website_url,c.checkpoint FROM app.jobs selected
            LEFT JOIN app.intake_recoveries link ON link.job_id=selected.id
            JOIN app.jobs j ON j.id=COALESCE(link.source_job_id,selected.id)
            JOIN app.intake_requests r ON r.job_id=j.id JOIN app.website_capture_calls c ON c.job_id=j.id
            WHERE selected.id=$1 AND selected.organization_id=$2 AND selected.brand_id=$3 AND selected.status IN ('unknown','succeeded')
              AND j.kind='website.extract' AND (j.status='unknown' OR (j.status='succeeded' AND jsonb_array_length(COALESCE(r.result->'visualErrors','[]'::jsonb))>0)) AND NOT j.cancel_requested`,[recovery,b.organization_id,id])).rows[0];
          if(!source||!(source.checkpoint.phase==='polling'||(source.checkpoint.phase==='submitting'&&source.checkpoint.submittedAt)))
            throw new ConflictException("This capture has no verifiable saved run to check. Contact support; do not submit another paid crawl.");
          sourceId=source.id;url=source.website_url;
          if((await db.query("SELECT r.job_id FROM app.intake_recoveries r JOIN app.jobs j ON j.id=r.job_id WHERE r.source_job_id=$1 AND j.status='succeeded'",[sourceId])).rowCount)
            throw new ConflictException("This capture has already been recovered");
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
        if (!recovery &&
          (
            await db.query(
              `SELECT j.id FROM app.jobs j WHERE j.organization_id=$1 AND j.brand_id=$2 AND j.kind=ANY($3::text[]) AND j.status='unknown'
               AND NOT EXISTS(SELECT 1 FROM app.intake_recoveries r JOIN app.jobs done ON done.id=r.job_id
                WHERE r.source_job_id=COALESCE((SELECT source_job_id FROM app.intake_recoveries WHERE job_id=j.id),j.id) AND done.status='succeeded') LIMIT 1`,
              [b.organization_id, id, automatic ? ["website.extract", "brand.analyze"] : [v.kind]],
            )
          ).rowCount
        )
          throw new ConflictException(
            "An earlier request has an uncertain outcome. An operator must reconcile it before another request of this kind.",
          );
        const count = (
          await db.query(
            "SELECT count(*)::int AS n FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind IN ('website.extract','brand.analyze') AND created_at>now()-interval '1 day'",
            [b.organization_id, id],
          )
        ).rows[0].n;
        if (count + (automatic ? 2 : 1) > 20)
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
        if(sourceId)await db.query("INSERT INTO app.intake_recoveries(job_id,organization_id,brand_id,source_job_id) VALUES($1,$2,$3,$4)",[job,b.organization_id,id,sourceId]);
        await db.query(
          "INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,$4)",
          [job, b.organization_id, id, v.kind],
        );
        await db.query(
          "INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'intake.submitted',$4)",
          [b.organization_id, id, user, job],
        );
        if(sourceId)await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'intake.recovery_requested',$4)",[b.organization_id,id,user,job]);
        if (automatic) {
          const child = randomUUID();
          await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'brand.analyze')", [child,b.organization_id,id,user]);
          await db.query("INSERT INTO app.intake_requests(job_id,organization_id,brand_id,request_key,request_hash) VALUES($1,$2,$3,$4,$5)", [child,b.organization_id,id,`analyze-website-${job}`,hash(canonicalJSON({kind:'brand.analyze',url:null}))]);
          await db.query("INSERT INTO app.intake_dependencies(organization_id,brand_id,analysis_job_id,capture_job_id) VALUES($1,$2,$3,$4)", [b.organization_id,id,child,job]);
          await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'brand.analyze')", [child,b.organization_id,id]);
          await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'intake.submitted',$4)", [b.organization_id,id,user,child]);
        }
        return { id: job, status: "queued" };
      },
      id,
    );
  }
}
