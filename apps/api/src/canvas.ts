import {parseCreateDraft} from './create-chat-draft.js';
import {normalizeCreativeSpec,creativeSourceSize,creativeDimensions} from "./campaign-formats.js";
import {approvedLearning} from './learning-context.js';
import {creativeTextProvider,creativeTextModel} from "./creative-planning.js";
import {approveReference,referenceColumns,referenceJoins} from './brand-references.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Businesses } from "./businesses.js";
import { ObjectStore } from "./object-store.js";
import { object, uuid } from "./workspaces.js";
import { canonicalJSON, hash } from "./brand-brain.js";
import { validateDesign } from "./creative-design.js";
const key = (v: unknown) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_.:-]{8,128}$/.test(v))
    throw new BadRequestException("An Idempotency-Key is required");
  return v;
};
const plain = (v: unknown, max: number) => {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
  )
    throw new BadRequestException(`Use 1–${max} characters of plain text`);
  return v.trim();
};
export class Canvas {
  constructor(
    readonly businesses: Businesses,
    readonly store: ObjectStore,
  ) {}
  async scope<T>(
    user: string,
    id: string,
    write: boolean,
    action: (db: any, b: any) => Promise<T>,
    reviewOnly=false,
  ) {
    const b = await this.businesses.resolve(user, id);
    return this.businesses.database.transaction(
      user,
      b.organization_id,
      write,
      (db) => action(db, b),
      id,reviewOnly,
    );
  }
  createDraft(user:string,id:string){
    return this.scope(user,id,false,async(db,b)=>({draft:(await db.query('SELECT revision,snapshot,updated_at FROM app.create_chat_drafts WHERE organization_id=$1 AND brand_id=$2 AND actor_id=$3',[b.organization_id,id,user])).rows[0]??null}));
  }
  saveCreateDraft(user:string,id:string,body:unknown){
    const {revision,snapshot}=parseCreateDraft(body);
    return this.scope(user,id,true,async(db,b)=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`create-draft:${id}:${user}`]);
      const prior=(await db.query('SELECT revision,snapshot FROM app.create_chat_drafts WHERE organization_id=$1 AND brand_id=$2 AND actor_id=$3',[b.organization_id,id,user])).rows[0];
      // Lost-response replay is safe; divergent tabs cannot silently overwrite each other.
      if(prior&&canonicalJSON(prior.snapshot)===canonicalJSON(snapshot))return {revision:prior.revision};
      if((prior?.revision??0)!==revision)throw new ConflictException('This draft changed in another tab. Reload to continue from the saved version.');
      const result=await db.query(`INSERT INTO app.create_chat_drafts(organization_id,brand_id,actor_id,snapshot) VALUES($1,$2,$3,$4)
        ON CONFLICT(organization_id,brand_id,actor_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,revision=create_chat_drafts.revision+1,updated_at=now() RETURNING revision`,[b.organization_id,id,user,snapshot]);
      return result.rows[0];
    });
  }
  allowances(user:string,id:string){
    return this.scope(user,id,false,async(db,b)=>{
      // Only permission metadata is exposed. Neither credentials nor a provider-health claim.
      const rows=(await db.query(`
        SELECT 'creative_openai' AS capability,enabled,expires_at,expires_at<=now() AS expired FROM app.creative_grants WHERE organization_id=$1 AND brand_id=$2
        UNION ALL SELECT 'creative_gemini',enabled,expires_at,expires_at<=now() FROM app.gemini_creative_grants WHERE organization_id=$1 AND brand_id=$2
        UNION ALL SELECT 'planning_'||provider,enabled,expires_at,expires_at<=now() FROM app.planning_grants WHERE organization_id=$1 AND brand_id=$2
        UNION ALL SELECT 'video',enabled,expires_at,expires_at<=now() FROM app.video_grants WHERE organization_id=$1 AND brand_id=$2`,[b.organization_id,id])).rows;
      return {scope:'allowances_only',allowances:['creative_openai','creative_gemini','planning_openai','planning_gemini','video'].map(capability=>{
        const row=rows.find((r:any)=>r.capability===capability);
        return {capability,state:!row?'missing':!row.enabled?'disabled':row.expired?'expired':'active',expires_at:row?.expires_at??null};
      })};
    });
  }
  references(user:string,id:string){
    return this.scope(user,id,false,async(db,b)=>({references:(await db.query(`SELECT ${referenceColumns} FROM app.brand_references r ${referenceJoins} WHERE r.organization_id=$1 AND r.brand_id=$2 AND r.revoked_at IS NULL ORDER BY r.approved_at,r.id`,[b.organization_id,id])).rows.map(({object_key,...r}:any)=>r)}));
  }
  approveReference(user:string,id:string,body:unknown){return this.scope(user,id,true,(db,b)=>approveReference(db,b.organization_id,id,user,body));}
  revokeReference(user:string,id:string,referenceId:string){
    referenceId=uuid(referenceId);
    return this.scope(user,id,true,async(db,b)=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${id.toLowerCase()}`]);
      if(!(await db.query('SELECT id FROM app.brand_references WHERE organization_id=$1 AND brand_id=$2 AND id=$3',[b.organization_id,id,referenceId])).rowCount)throw new NotFoundException('Reference not found');
      const changed=await db.query('UPDATE app.brand_references SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL',[referenceId]);
      if(changed.rowCount)await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'brand.reference_revoked',$4)",[b.organization_id,id,user,referenceId]);
      return {revoked:true};
    });
  }
  list(user: string, id: string) {
    return this.scope(user, id, false, async (db, b) => ({
      threads: (
        await db.query(
          "SELECT id,title,created_at FROM app.canvas_threads WHERE organization_id=$1 AND brand_id=$2 ORDER BY created_at DESC LIMIT 100",
          [b.organization_id, id],
        )
      ).rows,
    }));
  }
  createThread(
    user: string,
    id: string,
    body: unknown,
    requestKey: unknown,
    scoped?: { db: any; b: any },
  ) {
    const v = object(body, ["title"]),
      title = plain(v.title, 140),
      k = key(requestKey),
      sha = hash(canonicalJSON({ title }));
    const action = async (db: any, b: any) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `canvas:${id.toLowerCase()}`,
      ]);
      const prior = (
        await db.query(
          "SELECT id,request_hash FROM app.canvas_threads WHERE organization_id=$1 AND brand_id=$2 AND created_by=$3 AND request_key=$4",
          [b.organization_id, id, user, k],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== sha)
          throw new ConflictException(
            "That request key belongs to a different conversation",
          );
        return { id: prior.id };
      }
      if (
        (
          await db.query(
            "SELECT count(*)::int AS n FROM app.canvas_threads WHERE organization_id=$1 AND brand_id=$2",
            [b.organization_id, id],
          )
        ).rows[0].n >= 100
      )
        throw new ConflictException(
          "This business has reached its conversation limit",
        );
      const thread = randomUUID();
      await db.query(
        "INSERT INTO app.canvas_threads(id,organization_id,brand_id,title,created_by,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [thread, b.organization_id, id, title, user, k, sha],
      );
      return { id: thread };
    };
    return scoped
      ? action(scoped.db, scoped.b)
      : this.scope(user, id, true, action);
  }
  thread(user: string, id: string, threadId: string) {
    threadId = uuid(threadId);
    return this.scope(user, id, false, async (db, b) => {
      const thread = (
        await db.query(
          "SELECT id,title,created_at FROM app.canvas_threads WHERE organization_id=$1 AND brand_id=$2 AND id=$3",
          [b.organization_id, id, threadId],
        )
      ).rows[0];
      if (!thread) throw new NotFoundException("Conversation not found");
      return {
        thread,
        messages: (
          await db.query(
            "SELECT id,job_id,role,content,created_at FROM app.canvas_messages WHERE organization_id=$1 AND brand_id=$2 AND thread_id=$3 ORDER BY created_at,id LIMIT 200",
            [b.organization_id, id, threadId],
          )
        ).rows,
        runs: (
          await db.query(
            "SELECT j.id,j.status,j.cancel_requested,j.error_code,j.created_at,r.project_id,r.parent_version_id,r.output_version_id,r.channel,r.size,r.format,r.text_provider,r.selected_text_model FROM app.jobs j JOIN app.creative_requests r ON r.job_id=j.id WHERE r.organization_id=$1 AND r.brand_id=$2 AND r.thread_id=$3 ORDER BY j.created_at DESC LIMIT 100",
            [b.organization_id, id, threadId],
          )
        ).rows,
        planning_runs:(await db.query("SELECT j.id,j.status,j.cancel_requested,j.error_code,r.output_plan_id,r.scheduled_at,r.input->'preferences'->>'starts_on' AS starts_on FROM app.jobs j JOIN app.planning_requests r ON r.job_id=j.id WHERE r.organization_id=$1 AND r.brand_id=$2 AND r.thread_id=$3 ORDER BY j.created_at DESC,j.id LIMIT 100",[b.organization_id,id,threadId])).rows,
        projects: (
          await db.query(
            "SELECT id,title,latest_version_id FROM app.creative_projects WHERE organization_id=$1 AND brand_id=$2 AND thread_id=$3 AND archived_at IS NULL ORDER BY created_at DESC LIMIT 100",
            [b.organization_id, id, threadId],
          )
        ).rows,
      };
    });
  }
  submit(
    user: string,
    id: string,
    threadId: string,
    body: unknown,
    requestKey: unknown,
    scoped?: { db: any; b: any; batchJobIds?: string[] },
  ) {
    threadId = uuid(threadId);
    const v = object(body, [
        "prompt",
        "format",
        "channel",
        "size",
        "parent_version_id",
        "creative_spec",
        "reference_ids",
        "text_provider",
        "max_cost_micros",
      ]),
      prompt = plain(v.prompt, 4000),
      k = key(requestKey),
      textProvider=creativeTextProvider(v.text_provider);
    if (
      !["static", "ad"].includes(String(v.format)) ||
      !["linkedin", "instagram", "facebook"].includes(String(v.channel)) ||
      !["1024x1024", "1536x1024", "1024x1536"].includes(String(v.size))
    )
      throw new BadRequestException(
        "Choose a supported static image format, channel and size",
      );
    let creativeSpec=null;
    if(v.creative_spec!==undefined&&v.creative_spec!==null){
      try{creativeSpec=normalizeCreativeSpec(v.creative_spec,String(v.format),String(v.channel));}catch{throw new BadRequestException("Choose a compatible post placement and aspect");}
      if(creativeSourceSize(creativeSpec)!==v.size)throw new BadRequestException("Image source size must match the selected aspect");
    }
    if(v.max_cost_micros!==undefined&&(!Number.isSafeInteger(v.max_cost_micros)||Number(v.max_cost_micros)<1||Number(v.max_cost_micros)>1000000000))throw new BadRequestException("Use a positive whole-number request budget in microdollars");
    if(v.reference_ids!==undefined&&(!Array.isArray(v.reference_ids)||v.reference_ids.length>3))throw new BadRequestException("Choose up to three approved references");
    const referenceIds=(v.reference_ids??[]).map((r:unknown)=>uuid(String(r)));
    if(new Set(referenceIds).size!==referenceIds.length)throw new BadRequestException("Choose each reference once");
    const parent =
        v.parent_version_id === null || v.parent_version_id === undefined
          ? null
          : uuid(String(v.parent_version_id)),
      sha = hash(
        canonicalJSON({
          threadId,
          prompt,
          format: v.format,
          channel: v.channel,
          size: v.size,
          parent,
          ...(creativeSpec?{creative_spec:creativeSpec}:{}),
          ...(textProvider==='gemini'?{text_provider:textProvider}:{}),
          ...(v.max_cost_micros!==undefined?{max_cost_micros:v.max_cost_micros}:{}),
          ...(referenceIds.length?{reference_ids:referenceIds}:{}),
        }),
      );
    const action = async (db: any, b: any) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `canvas:${id.toLowerCase()}`,
      ]);
      if (
        !(
          await db.query(
            "SELECT id FROM app.canvas_threads WHERE organization_id=$1 AND brand_id=$2 AND id=$3",
            [b.organization_id, id, threadId],
          )
        ).rowCount
      )
        throw new NotFoundException("Conversation not found");
      const prior = (
        await db.query(
          "SELECT r.request_hash,j.id,j.status FROM app.creative_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.organization_id=$1 AND r.brand_id=$2 AND r.request_key=$3",
          [b.organization_id, id, k],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== sha)
          throw new ConflictException(
            "That request key belongs to another creative request",
          );
        return { id: prior.id, status: prior.status };
      }
      if (
        (
          await db.query(
            "SELECT id FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind IN ('creative.generate','carousel.generate') AND status IN ('queued','running','retrying','unknown') AND NOT(status='queued' AND (id=ANY($3::uuid[]) OR id IN (SELECT generation_job_id FROM app.carousel_children WHERE organization_id=$1 AND brand_id=$2 AND parent_job_id=ANY($3::uuid[])))) LIMIT 1",
            [b.organization_id, id, scoped?.batchJobIds??[]],
          )
        ).rowCount
      )
        throw new ConflictException(
          "A creative request is running or needs its uncertain provider outcome reconciled",
        );
      if (
        (
          await db.query(
            "SELECT count(*)::int AS n FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind='creative.generate' AND created_at>now()-interval '1 day'",
            [b.organization_id, id],
          )
        ).rows[0].n >= 90
      )
        throw new ConflictException("Daily creative request limit reached");
      const brain = (
        await db.query(
          "SELECT id FROM app.brand_brain_versions WHERE organization_id=$1 AND brand_id=$2 ORDER BY approved_at DESC,id LIMIT 1",
          [b.organization_id, id],
        )
      ).rows[0];
      if (!brain)
        throw new ConflictException(
          "Confirm your brand profile before creating",
        );
      let project: string;
      if (parent) {
        const version = (
          await db.query(
            "SELECT v.project_id,p.latest_version_id,p.archived_at,p.thread_id,m.width,m.height,v.skill_manifest FROM app.creative_versions v JOIN app.creative_projects p ON p.id=v.project_id JOIN app.creative_media m ON m.id=v.media_id WHERE v.organization_id=$1 AND v.brand_id=$2 AND v.id=$3",
            [b.organization_id, id, parent],
          )
        ).rows[0];
        if (!version || version.thread_id !== threadId)
          throw new NotFoundException("Creative version not found");
        if (version.archived_at) throw new ConflictException("Restore the archived creative before editing");
        if (version.latest_version_id !== parent)
          throw new ConflictException(
            "Open the latest version before requesting an image edit",
          );
        if(version.skill_manifest?.creative_spec&&!creativeSpec)throw new BadRequestException("Keep the saved post format when editing this image");
        const target=creativeSpec?creativeDimensions(creativeSpec):null;
        if (creativeSpec && canonicalJSON(version.skill_manifest?.creative_spec??null)!==canonicalJSON(creativeSpec))throw new BadRequestException("Keep the current post placement when editing this image");
        if (target?version.width!==target.width||version.height!==target.height:`${version.width}x${version.height}` !== v.size)
          throw new BadRequestException(
            "Keep the current dimensions when editing this image",
          );
        project = version.project_id;
      } else {
        project = randomUUID();
        await db.query(
          "INSERT INTO app.creative_projects(id,organization_id,brand_id,thread_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6)",
          [
            project,
            b.organization_id,
            id,
            threadId,
            prompt.slice(0, 140),
            user,
          ],
        );
      }
      if(referenceIds.length&&(await db.query('SELECT id FROM app.brand_references WHERE organization_id=$1 AND brand_id=$2 AND id=ANY($3::uuid[]) AND revoked_at IS NULL',[b.organization_id,id,referenceIds])).rowCount!==referenceIds.length)throw new ConflictException('A reference is unavailable or no longer approved');
      const selectedTextModel=await creativeTextModel(db,b.organization_id,id,textProvider);
      const job = randomUUID();
      await db.query(
        "INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'creative.generate')",
        [job, b.organization_id, id, user],
      );
      await db.query(
        "INSERT INTO app.creative_requests(job_id,organization_id,brand_id,thread_id,project_id,brain_id,parent_version_id,prompt,format,channel,size,request_key,request_hash,text_provider,selected_text_model,memory_context,max_cost_micros,creative_spec) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
        [
          job,
          b.organization_id,
          id,
          threadId,
          project,
          brain.id,
          parent,
          prompt,
          v.format,
          v.channel,
          v.size,
          k,
          sha,
          textProvider,selectedTextModel,JSON.stringify(await approvedLearning(db)),v.max_cost_micros??null,creativeSpec?JSON.stringify(creativeSpec):null,
        ],
      );
      for(const [position,referenceId] of referenceIds.entries())await db.query('INSERT INTO app.creative_references(organization_id,brand_id,job_id,reference_id,position) VALUES($1,$2,$3,$4,$5)',[b.organization_id,id,job,referenceId,position]);
      await db.query(
        "INSERT INTO app.canvas_messages(id,organization_id,brand_id,thread_id,job_id,role,content) VALUES($1,$2,$3,$4,$5,'user',$6)",
        [randomUUID(), b.organization_id, id, threadId, job, prompt],
      );
      await db.query(
        "INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'creative.generate')",
        [job, b.organization_id, id],
      );
      await db.query(
        "INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'creative.requested',$4)",
        [b.organization_id, id, user, job],
      );
      return { id: job, status: "queued" };
    };
    return scoped
      ? action(scoped.db, scoped.b)
      : this.scope(user, id, true, action);
  }
  project(user: string, id: string, projectId: string) {
    projectId = uuid(projectId);
    return this.scope(user, id, false, async (db, b) => {
      const p = (
        await db.query(
          "SELECT id,title,thread_id,latest_version_id,archived_at,archive_revision FROM app.creative_projects WHERE organization_id=$1 AND brand_id=$2 AND id=$3",
          [b.organization_id, id, projectId],
        )
      ).rows[0];
      if (!p) throw new NotFoundException("Creative not found");
      return {
        project: p,
        versions: (
          await db.query(
            "SELECT id,parent_id,brain_id,media_id,design,caption,skill_manifest,sha256,status,review_revision,reviewed_at,created_at FROM app.creative_versions WHERE organization_id=$1 AND brand_id=$2 AND project_id=$3 ORDER BY created_at DESC,id",
            [b.organization_id, id, projectId],
          )
        ).rows,
        reviews: (
          await db.query(
            "SELECT r.version_id,r.decision,r.feedback,r.created_at FROM app.creative_reviews r JOIN app.creative_versions v ON v.id=r.version_id WHERE v.project_id=$1 ORDER BY r.created_at",
            [projectId],
          )
        ).rows,
      };
    });
  }
  save(user: string, id: string, projectId: string, body: unknown) {
    projectId = uuid(projectId);
    const v = object(body, ["parent_id", "design", "caption"]),
      parent = uuid(String(v.parent_id));
    if (typeof v.caption !== "string" || v.caption.length > 3000)
      throw new BadRequestException("Use a caption of at most 3000 characters");
    return this.scope(user, id, true, async (db, b) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `canvas:${id.toLowerCase()}`,
      ]);
      const p = (
        await db.query(
          "SELECT v.*,p.latest_version_id,p.archived_at,m.width,m.height FROM app.creative_versions v JOIN app.creative_projects p ON p.id=v.project_id JOIN app.creative_media m ON m.id=v.media_id WHERE v.organization_id=$1 AND v.brand_id=$2 AND v.project_id=$3 AND v.id=$4",
          [b.organization_id, id, projectId, parent],
        )
      ).rows[0];
      if (!p) throw new NotFoundException("Creative not found");
      if (p.archived_at) throw new ConflictException("Restore the archived creative before editing");
      let design;
      try {
        design = validateDesign(v.design, p.media_id, p.width, p.height);
      } catch {
        throw new BadRequestException("Check the editable design fields");
      }
      const sha = hash(
        canonicalJSON({ design, caption: v.caption, brain_id: p.brain_id }),
      );
      const replay = (
        await db.query(
          "SELECT id FROM app.creative_versions WHERE project_id=$1 AND parent_id=$2 AND sha256=$3 AND created_by=$4",
          [projectId, parent, sha, user],
        )
      ).rows[0];
      if (replay) return replay;
      if (p.latest_version_id !== parent)
        throw new ConflictException(
          "Your creative changed. Open the latest saved version before saving",
        );
      if (
        (
          await db.query(
            "SELECT count(*)::int AS n FROM app.creative_versions WHERE project_id=$1",
            [projectId],
          )
        ).rows[0].n >= 100
      )
        throw new ConflictException("Creative version limit reached");
      const version = randomUUID();
      await db.query(
        "INSERT INTO app.creative_versions(id,organization_id,brand_id,project_id,parent_id,brain_id,media_id,design,caption,skill_manifest,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          version,
          b.organization_id,
          id,
          projectId,
          parent,
          p.brain_id,
          p.media_id,
          JSON.stringify(design),
          v.caption,
          JSON.stringify(p.skill_manifest),
          sha,
          user,
        ],
      );
      await db.query(
        "UPDATE app.creative_projects SET latest_version_id=$2 WHERE id=$1",
        [projectId, version],
      );
      return { id: version };
    });
  }
  review(user: string, id: string, versionId: string, body: unknown, scoped?:{db:any;b:any}) {
    versionId = uuid(versionId);
    const v = object(body, ["decision", "feedback", "revision"]);
    if (
      !["in_review", "approved", "rejected", "changes_requested"].includes(
        String(v.decision),
      ) ||
      typeof v.feedback !== "string" ||
      v.feedback.length > 2000 ||
      !Number.isInteger(v.revision)
    )
      throw new BadRequestException(
        "Check the review decision and saved revision",
      );
    const action=async (db:any,b:any)=>{
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `canvas:${id.toLowerCase()}`,
      ]);
      const version = (
        await db.query(
          "SELECT v.*,p.latest_version_id,p.archived_at FROM app.creative_versions v JOIN app.creative_projects p ON p.id=v.project_id WHERE v.organization_id=$1 AND v.brand_id=$2 AND v.id=$3",
          [b.organization_id, id, versionId],
        )
      ).rows[0];
      if (!version) throw new NotFoundException("Creative not found");
      if (version.archived_at) throw new ConflictException("Restore the archived creative before reviewing");
      if (
        v.decision !== "in_review" &&
        !(
          await db.query("SELECT app.creative_reviewer($1,$2) AS allowed", [
            b.organization_id,
            id,
          ])
        ).rows[0].allowed
      )
        throw new ForbiddenException(
          "Only a business owner or admin can approve or reject creative versions",
        );
      if (
        version.review_revision !== v.revision ||
        version.latest_version_id !== versionId
      )
        throw new ConflictException("Review the latest saved version");
      if (
        v.decision === "in_review"
          ? !["draft", "changes_requested"].includes(version.status)
          : version.status !== "in_review"
      )
        throw new ConflictException(
          "This version is not eligible for that review action",
        );
      await db.query(
        "UPDATE app.creative_versions SET status=$2,review_revision=review_revision+1,reviewed_by=$3,reviewed_at=$4 WHERE id=$1",
        [
          versionId,
          v.decision,
          v.decision === "in_review" ? null : user,
          v.decision === "in_review" ? null : new Date(),
        ],
      );
      await db.query(
        "INSERT INTO app.creative_reviews(id,organization_id,brand_id,version_id,actor_id,decision,feedback) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          b.organization_id,
          id,
          versionId,
          user,
          v.decision,
          v.feedback,
        ],
      );
      return {
        id: versionId,
        status: v.decision,
        revision: Number(v.revision) + 1,
      };
    };
    return scoped?action(scoped.db,scoped.b):this.scope(user,id,true,action,v.decision!=='in_review');
  }
  media(user: string, id: string, mediaId: string) {
    mediaId = uuid(mediaId);
    return this.scope(user, id, false, async (db, b) => {
      const m = (
        await db.query(
          "SELECT object_key FROM app.creative_media WHERE organization_id=$1 AND brand_id=$2 AND id=$3",
          [b.organization_id, id, mediaId],
        )
      ).rows[0];
      if (!m) throw new NotFoundException("Creative image not found");
      return {
        url: await this.store.downloadURL(
          m.object_key,
          "creative-background.png",
          "image/png",
        ),
        expiresIn: 60,
      };
    });
  }
  cancel(user: string, id: string, jobId: string) {
    jobId = uuid(jobId);
    return this.scope(user, id, true, async (db, b) => {
      const j = (
        await db.query(
          "SELECT id,status FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND id=$3 AND kind='creative.generate'",
          [b.organization_id, id, jobId],
        )
      ).rows[0];
      if (!j) throw new NotFoundException("Creative request not found");
      if (!["queued", "running", "retrying"].includes(j.status))
        throw new ConflictException(
          "This request has already finished or needs reconciliation",
        );
      await db.query("UPDATE app.jobs SET cancel_requested=true WHERE id=$1", [
        jobId,
      ]);
      return { id: jobId, cancel_requested: true };
    });
  }
}
