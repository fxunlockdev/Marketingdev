import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';

export class TenantDatabase {
  constructor(readonly pool: Pool) {}

  async assertRuntimeRole() {
    const { rows: [role] } = await this.pool.query(`SELECT current_user AS name, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname = current_user`);
    if (role.name !== 'desvio_app' || role.rolsuper || role.rolbypassrls) throw new Error('Unsafe application database role');
    const { rows } = await this.pool.query(`SELECT n.nspname FROM pg_namespace n
      WHERE n.nspname IN ('auth', 'app') AND n.nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)`);
    if (rows.length) throw new Error('Runtime role must not own schemas');
    const tables = await this.pool.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('app','auth') AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname=current_user)`);
    if (tables.rows.length) throw new Error('Runtime role must not own tables');
  }

  async transaction<T>(userId: string, orgId: string | undefined, write: boolean,
    action: (db: PoolClient) => Promise<T>, brandId?: string): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true),
        set_config('app.brand_id', $3, true)`, [userId, orgId ?? '', brandId ?? '']);
      if (orgId) {
        const { rows } = await db.query(`SELECT role FROM app.memberships WHERE organization_id = $1 AND user_id = $2 AND active`, [orgId, userId]);
        if (!rows.length) throw new NotFoundException('Account not found');
        if(brandId){const allowed=(await db.query('SELECT app.business_access($1,$2,$3) AS allowed',[orgId,brandId,write])).rows[0].allowed;if(!allowed)throw write?new ForbiddenException('You cannot change this business'):new NotFoundException('Business not found');}
        if (write && rows[0].role === 'viewer') throw new ForbiddenException('This workspace is read-only for you');
      }
      const value = await action(db);
      await db.query('COMMIT');
      return value;
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally { db.release(); }
  }
}
