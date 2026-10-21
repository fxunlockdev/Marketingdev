import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TenantDatabase } from './database.js';

export function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException('Invalid resource ID');
  return value.toLowerCase();
}
export function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new BadRequestException('Unexpected fields');
  return value as Record<string, unknown>;
}
export function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(value)) throw new BadRequestException('Name must be 1–100 characters');
  return value.trim();
}
function website(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw new BadRequestException('Invalid website');
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
    return url.toString();
  } catch { throw new BadRequestException('Use an http or https website address without credentials'); }
}
type Brand = { id: string; organization_id: string; name: string; website: string | null; revision: number };

export class Workspaces {
  constructor(readonly database: TenantDatabase) {}

  list(user: string) {
    return this.database.transaction(user, undefined, false, async db => {
      const { rows } = await db.query(`SELECT o.id, o.name, m.role FROM app.organizations o
        JOIN app.memberships m ON m.organization_id=o.id AND m.user_id=$1 AND m.active ORDER BY o.created_at, o.id LIMIT 100`, [user]);
      return { workspaces: rows };
    });
  }

  create(user: string, input: unknown) {
    const workspaceName = name(object(input, ['name']).name);
    return this.database.transaction(user, undefined, true, async db => {
      const { rows: [result] } = await db.query('SELECT app.create_organization($1) AS id', [workspaceName]);
      return { id: result.id, name: workspaceName, role: 'owner' };
    });
  }

  brands(user: string, organizationId: string) {
    const org = uuid(organizationId);
    return this.database.transaction(user, org, false, async db => {
      const { rows } = await db.query('SELECT id, organization_id, name, website, revision FROM app.brands WHERE organization_id=$1 ORDER BY created_at, id LIMIT 100', [org]);
      return { brands: rows };
    });
  }

  brand(user: string, organizationId: string, brandId: string) {
    const org = uuid(organizationId), brand = uuid(brandId);
    return this.database.transaction(user, org, false, async db => {
      const { rows: [result] } = await db.query('SELECT id, organization_id, name, website, revision FROM app.brands WHERE organization_id=$1 AND id=$2', [org, brand]);
      if (!result) throw new NotFoundException('Brand not found');
      return result as Brand;
    }, brand);
  }

  createBrand(user: string, organizationId: string, input: unknown, key: unknown) {
    const org = uuid(organizationId), value = object(input, ['name', 'website']);
    const brandName = name(value.name), brandWebsite = website(value.website);
    if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) throw new BadRequestException('An 8–128 character Idempotency-Key is required');
    const hash = createHash('sha256').update(JSON.stringify({ name: brandName, website: brandWebsite })).digest('hex');
    return this.database.transaction(user, org, true, async db => {
      // One transaction also owns the durable audit/outbox. Lost responses can replay safely.
      await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`brand-create:${org}:${key}`]);
      const { rows: [prior] } = await db.query(`SELECT request_hash, response FROM app.idempotency
        WHERE organization_id=$1 AND operation='brand.create' AND key=$2`, [org, key]);
      if (prior) {
        if (prior.request_hash !== hash) throw new ConflictException('This request key was already used for different content');
        return prior.response as Brand;
      }
      // Serialize the workspace brand limit, including requests with different keys.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`brand-limit:${org}`]);
      const { rows: [count] } = await db.query('SELECT count(*)::int AS count FROM app.brands WHERE organization_id=$1', [org]);
      if (count.count >= 100) throw new ConflictException('This workspace has reached its brand limit');
      const { rows: [brand] } = await db.query(`INSERT INTO app.brands(organization_id,name,website) VALUES ($1,$2,$3)
        RETURNING id, organization_id, name, website, revision`, [org, brandName, brandWebsite]);
      await db.query(`INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id)
        VALUES ($1,$2,$3,'brand.created',$2)`, [org, brand.id, user]);
      await db.query(`INSERT INTO app.outbox(organization_id,brand_id,event_type,resource_revision) VALUES ($1,$2,'brand.created',1)`, [org, brand.id]);
      await db.query(`INSERT INTO app.idempotency(organization_id,operation,key,request_hash,response) VALUES ($1,'brand.create',$2,$3,$4::jsonb)`, [org,key,hash,JSON.stringify(brand)]);
      return brand as Brand;
    });
  }

  updateBrand(user: string, organizationId: string, brandId: string, input: unknown) {
    const org = uuid(organizationId), id = uuid(brandId), value = object(input, ['name','website','revision']);
    if (!('name' in value) && !('website' in value)) throw new BadRequestException('Include a name or website change');
    const brandName = 'name' in value ? name(value.name) : null;
    const brandWebsite = 'website' in value ? website(value.website) : null;
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || Number(value.revision) >= 2147483647) throw new BadRequestException('A valid saved revision is required');
    return this.database.transaction(user, org, true, async db => {
      const { rows: [brand] } = await db.query(`UPDATE app.brands SET name=COALESCE($3,name), website=CASE WHEN $6 THEN $4 ELSE website END, revision=revision+1, updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND revision=$5 RETURNING id,organization_id,name,website,revision`, [org,id,brandName,brandWebsite,value.revision,'website' in value]);
      if (!brand) {
        const exists = await db.query('SELECT id FROM app.brands WHERE organization_id=$1 AND id=$2', [org,id]);
        if (!exists.rows.length) throw new NotFoundException('Brand not found');
        throw new ConflictException('This brand changed in another session. Reload before saving your revision.');
      }
      await db.query(`INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES ($1,$2,$3,'brand.updated',$2)`, [org,id,user]);
      await db.query(`INSERT INTO app.outbox(organization_id,brand_id,event_type,resource_revision) VALUES ($1,$2,'brand.updated',$3)`, [org,id,brand.revision]);
      return brand as Brand;
    }, id);
  }
}
