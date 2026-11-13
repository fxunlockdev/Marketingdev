import {BadRequestException,ConflictException,ForbiddenException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {Businesses} from './businesses.js';
import {object} from './workspaces.js';
import {hash,canonicalJSON} from './brand-brain.js';
import {requireGuidedRevision} from './guided-campaign-contracts.js';
import {BrandDirectionError,brandKitDirection,directionFromResearch,onboardingDirection,validateBrandDirection,PALETTE_ROLES,type BrandDirection,type BrandDirectionEdit,type ResearchedDirection} from './brand-direction.js';

type Query=Pick<PoolClient,'query'>;
export type StoredDirection={id:string;version:number;source:'onboarding'|'brand_kit';direction:BrandDirection;created_at:string;created_by:string};
const COLUMNS='id,version,source,direction,created_at,created_by';

function stored(row:Record<string,unknown>|undefined):StoredDirection|null{
 if(!row)return null;
 // A row that no longer validates is ignored rather than steering generation with bad data.
 try{return {id:String(row.id),version:Number(row.version),source:row.source as StoredDirection['source'],direction:validateBrandDirection(row.direction),created_at:String(row.created_at),created_by:String(row.created_by)};}catch{return null;}
}

/** The current creative direction of a business, or null. */
export async function currentDirection(db:Query,organization:string,brand:string):Promise<StoredDirection|null>{
 return stored((await db.query(`SELECT ${COLUMNS} FROM app.brand_creative_directions WHERE organization_id=$1 AND brand_id=$2 ORDER BY version DESC LIMIT 1`,[organization,brand])).rows[0]);
}

/** The direction that applied when a job was created, so a replayed job builds the same prompt
 * and a later Brand Kit change affects only posts generated afterwards. */
export async function directionForJob(db:Query,organization:string,brand:string,jobId:string):Promise<StoredDirection|null>{
 return stored((await db.query(`SELECT ${COLUMNS} FROM app.brand_creative_directions WHERE organization_id=$1 AND brand_id=$2 AND created_at<=(SELECT created_at FROM app.jobs WHERE id=$3) ORDER BY version DESC LIMIT 1`,[organization,brand,jobId])).rows[0]);
}

/** A direction in the shape the image generators read for an approved mood board. */
export function directionAsBoard(d:StoredDirection):{direction:BrandDirection;feedback:'';source:'brand_direction'}{
 return {direction:d.direction,feedback:'',source:'brand_direction'};
}

const fail=(e:unknown):never=>{if(e instanceof BrandDirectionError)throw new BadRequestException(e.message);throw e;};

function editBody(body:unknown):{base:number;edit:BrandDirectionEdit}{
 const v=object(body,['base_version','looks','palette','heading_font','heading_weight','body_font','body_weight']);
 if(!Number.isSafeInteger(v.base_version)||Number(v.base_version)<0)throw new BadRequestException('Reload your creative direction before saving');
 if(!Array.isArray(v.looks)||v.looks.some(l=>typeof l!=='string'))throw new BadRequestException('Choose up to three looks');
 const palette=object(v.palette,[...PALETTE_ROLES]);
 if(PALETTE_ROLES.some(role=>typeof palette[role]!=='string'))throw new BadRequestException('Choose a colour for every role');
 if(typeof v.heading_font!=='string'||typeof v.body_font!=='string'||!Number.isInteger(v.heading_weight)||!Number.isInteger(v.body_weight))throw new BadRequestException('Choose fonts from the list');
 return {base:Number(v.base_version),edit:{looks:v.looks as string[],palette:palette as BrandDirectionEdit['palette'],heading_font:v.heading_font,heading_weight:Number(v.heading_weight),body_font:v.body_font,body_weight:Number(v.body_weight)}};
}

export class BrandDirections {
 constructor(readonly businesses:Businesses){}
 private async scope<T>(user:string,brand:string,write:boolean,action:(db:PoolClient,b:{organization_id:string;role:string})=>Promise<T>):Promise<T>{
  const b=await this.businesses.resolve(user,brand);
  return this.businesses.database.transaction(user,b.organization_id,write,(db:PoolClient)=>action(db,b),brand);
 }

 read(user:string,brand:string){return this.scope(user,brand,false,async(db,b)=>{
  const current=await currentDirection(db,b.organization_id,brand);
  const versions=(await db.query('SELECT id,version,source,created_at FROM app.brand_creative_directions WHERE organization_id=$1 AND brand_id=$2 ORDER BY version DESC LIMIT 20',[b.organization_id,brand])).rows;
  const board=current?null:(await db.query('SELECT direction FROM app.guided_moodboards WHERE organization_id=$1 AND brand_id=$2 AND approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1',[b.organization_id,brand])).rows[0];
  let legacy:BrandDirection|null=null;
  if(board){try{legacy=directionFromResearch(board.direction as ResearchedDirection);}catch{legacy=null;}}
  const can_edit=!!(await db.query('SELECT app.social_manager($1,$2) AS allowed',[b.organization_id,brand])).rows[0]?.allowed;
  return {current,versions,legacy_moodboard:legacy,can_edit};
 });}

 /** Picked looks, researched voice and brand facts become the direction once research is confirmed. */
 fromOnboarding(user:string,brand:string,body:unknown){
  const v=object(body,['brief_revision']);
  return this.scope(user,brand,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`creative-direction:${brand}`]);
   const brief=(await db.query(`SELECT g.revision,g.brief,g.research_job_id,COALESCE(child.result,r.result) AS result,COALESCE(d.analysis_job_id,g.research_job_id) AS result_job FROM app.guided_business_briefs g
    LEFT JOIN app.intake_requests r ON r.job_id=g.research_job_id LEFT JOIN app.intake_dependencies d ON d.capture_job_id=g.research_job_id
    LEFT JOIN app.intake_requests child ON child.job_id=d.analysis_job_id WHERE g.organization_id=$1 AND g.brand_id=$2`,[b.organization_id,brand])).rows[0];
   if(!brief)throw new ConflictException('Complete your business questions first');
   requireGuidedRevision(brief.revision,v.brief_revision);
   const looks:string[]=Array.isArray(brief.brief?.details?.references)?brief.brief.details.references:[];
   const research=(brief.result?.business_direction??null) as ResearchedDirection|null;
   const notes=typeof brief.brief?.visual_direction==='string'?brief.brief.visual_direction:'';
   const sourceHash=hash(canonicalJSON({looks,research_job:brief.result_job??null,notes}));
   // Re-confirming the same answers keeps the current direction, including later Brand Kit changes.
   if((await db.query("SELECT 1 FROM app.brand_creative_directions WHERE organization_id=$1 AND brand_id=$2 AND source='onboarding' AND source_hash=$3",[b.organization_id,brand,sourceHash])).rowCount)
    return (await currentDirection(db,b.organization_id,brand))!;
   let direction:BrandDirection;
   try{direction=onboardingDirection(looks,research,notes);}catch(e){
    if(e instanceof BrandDirectionError&&!looks.length)throw new ConflictException('Wait for your business research to finish');
    return fail(e);
   }
   return this.insert(db,b.organization_id,brand,user,'onboarding',direction,sourceHash);
  });
 }

 /** A Brand Kit change by an owner or admin: always a new version, used by posts generated afterwards. */
 save(user:string,brand:string,body:unknown){
  const {base,edit}=editBody(body);
  return this.scope(user,brand,true,async(db,b)=>{
   if(!(await db.query('SELECT app.social_manager($1,$2) AS allowed',[b.organization_id,brand])).rows[0]?.allowed)throw new ForbiddenException('Only a business owner or admin can change the creative direction');
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`creative-direction:${brand}`]);
   const current=await currentDirection(db,b.organization_id,brand);
   if((current?.version??0)!==base)throw new ConflictException('Your creative direction changed since you opened it. Reload to see the latest version.');
   let previous=current?.direction??null;
   if(!previous){
    const board=(await db.query('SELECT direction FROM app.guided_moodboards WHERE organization_id=$1 AND brand_id=$2 AND approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1',[b.organization_id,brand])).rows[0];
    if(board){try{previous=directionFromResearch(board.direction as ResearchedDirection);}catch{previous=null;}}
   }
   let direction:BrandDirection;
   try{direction=brandKitDirection(previous,edit);}catch(e){return fail(e);}
   return this.insert(db,b.organization_id,brand,user,'brand_kit',direction,null);
  });
 }

 private async insert(db:PoolClient,organization:string,brand:string,user:string,source:StoredDirection['source'],direction:BrandDirection,sourceHash:string|null):Promise<StoredDirection>{
  const id=randomUUID();
  const row=(await db.query(`INSERT INTO app.brand_creative_directions(id,organization_id,brand_id,version,source,look_ids,direction,source_hash,created_by)
   SELECT $1,$2,$3,COALESCE(max(version),0)+1,$4,$5,$6,$7,$8 FROM app.brand_creative_directions WHERE organization_id=$2 AND brand_id=$3 RETURNING ${COLUMNS}`,
   [id,organization,brand,source,direction.looks.map(l=>l.id),JSON.stringify(direction),sourceHash,user])).rows[0];
  await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'creative_direction.saved',$4)",[organization,brand,user,id]);
  return stored(row)!;
 }
}
