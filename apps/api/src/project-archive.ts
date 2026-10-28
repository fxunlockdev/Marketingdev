import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {Canvas} from './canvas.js';
import {object,uuid} from './workspaces.js';
export class ProjectArchive {
 constructor(readonly canvas:Canvas){}
 list(user:string,id:string,query:unknown){
  const q=object(query,['page']),page=q.page===undefined?1:Number(q.page);
  if(!Number.isSafeInteger(page)||page<1||page>1000)throw new BadRequestException('Invalid page');
  return this.canvas.scope(user,id,false,async(db,b)=>{
   const rows=(await db.query(`WITH archived AS (
    SELECT 'image'::text AS kind,p.id,p.title,p.thread_id,p.latest_version_id,p.archived_at,p.archive_revision,v.design,v.caption,
      (SELECT count(*)::int FROM app.creative_versions h WHERE h.project_id=p.id) AS version_count,NULL::uuid AS video_version_id,NULL::uuid AS carousel_version_id,p.id AS project_id
    FROM app.creative_projects p LEFT JOIN app.creative_versions v ON v.id=p.latest_version_id WHERE p.organization_id=$1 AND p.brand_id=$2 AND p.archived_at IS NOT NULL
    UNION ALL
    SELECT 'video',p.id,p.title,p.thread_id,p.latest_version_id,p.archived_at,p.archive_revision,NULL::jsonb,v.caption,
      (SELECT count(*)::int FROM app.video_versions h WHERE h.project_id=p.id),v.id,NULL::uuid,p.id
    FROM app.video_projects p LEFT JOIN app.video_versions v ON v.id=p.latest_version_id WHERE p.organization_id=$1 AND p.brand_id=$2 AND p.archived_at IS NOT NULL
    UNION ALL
    SELECT 'carousel',p.id,COALESCE(v.title,'Carousel'),NULL::uuid,p.latest_version_id,p.archived_at,p.archive_revision,NULL::jsonb,v.caption,
      (SELECT count(*)::int FROM app.carousel_versions h WHERE h.project_id=p.id),NULL::uuid,v.id,p.id
    FROM app.carousel_projects p LEFT JOIN app.carousel_versions v ON v.id=p.latest_version_id WHERE p.organization_id=$1 AND p.brand_id=$2 AND p.archived_at IS NOT NULL
   ) SELECT * FROM archived ORDER BY archived_at DESC,id LIMIT 51 OFFSET $3`,[b.organization_id,id,(page-1)*50])).rows;
   return {projects:rows.slice(0,50),page,has_more:rows.length>50};
  });
 }
 change(user:string,id:string,projectId:string,body:unknown,archive:boolean,kind="image"){
  const model=kind==='image'?'creative':kind==='video'?'video':kind==='carousel'?'carousel':null;
  if(!model)throw new BadRequestException('Choose an image, video or carousel');
  projectId=uuid(projectId);const v=object(body,['revision']);
  if(!Number.isSafeInteger(v.revision)||Number(v.revision)<1)throw new BadRequestException('Use the current archive revision');
  return this.canvas.scope(user,id,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${id.toLowerCase()}`]);
   const p=(await db.query(`SELECT id,archived_at,archive_revision FROM app.${model}_projects WHERE organization_id=$1 AND brand_id=$2 AND id=$3 FOR UPDATE`,[b.organization_id,id,projectId])).rows[0];
   if(!p)throw new NotFoundException('Creative not found');
   if(p.archive_revision!==v.revision)throw new ConflictException('This creative changed. Refresh before continuing');
   if(Boolean(p.archived_at)===archive)return p;
   if(archive){
    if((await db.query(`SELECT 1 FROM app.${model}_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.project_id=$1 AND j.status IN ('queued','running','retrying','unknown') LIMIT 1`,[projectId])).rowCount)throw new ConflictException('Wait for generation to finish or be reconciled before archiving');
    const versionField=model==='creative'?'creative_version_id':`${model}_version_id`;
    if((await db.query(`SELECT 1 FROM app.${model}_versions v WHERE v.project_id=$1 AND (
      EXISTS(SELECT 1 FROM app.content_slots s WHERE s.${versionField}=v.id) OR
      EXISTS(SELECT 1 FROM app.content_slot_events e WHERE e.${versionField}=v.id)
      ${model==='creative'?'OR EXISTS(SELECT 1 FROM app.carousel_pages c WHERE c.creative_version_id=v.id)':''}) LIMIT 1`,[projectId])).rowCount)throw new ConflictException('This creative belongs to a post or carousel. Archive that post from the calendar');
   }
   const row=(await db.query(`UPDATE app.${model}_projects SET archived_at=$2,archive_revision=archive_revision+1 WHERE id=$1 RETURNING id,archived_at,archive_revision`,[projectId,archive?new Date():null])).rows[0];
   await db.query('INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,$4,$5)',[b.organization_id,id,user,archive?'creative.archived':'creative.restored',projectId]);
   return row;
  });
 }
}
