import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { TenantDatabase } from "./database.js";
import { Workspaces, uuid, object } from "./workspaces.js";
export class Businesses {
  constructor(
    readonly database: TenantDatabase,
    readonly workspaces: Workspaces,
  ) {}
  initialize(user: string) {
    return this.database.transaction(user, undefined, true, async (db) => ({
      accountId: (await db.query("SELECT app.ensure_personal_account() AS id"))
        .rows[0].id,
    }));
  }
  private async account(user: string) {
    return this.database.transaction(user, undefined, false, async (db) => {
      const row = (
        await db.query(
          "SELECT organization_id FROM app.personal_accounts WHERE user_id=$1",
          [user],
        )
      ).rows[0];
      if (!row)
        throw new ConflictException(
          "Open your account before adding a business",
        );
      return row.organization_id as string;
    });
  }
  async list(user: string) {
    const memberships = await this.workspaces.list(user);
    const businesses: any[] = [];
    for (const org of memberships.workspaces) {
      const rows = await this.database.transaction(
        user,
        org.id,
        false,
        async (db) =>
          (
            await db.query(
              `SELECT b.id,b.organization_id,b.name,b.website,b.revision,EXISTS(SELECT 1 FROM app.brand_brain_versions v WHERE v.organization_id=b.organization_id AND v.brand_id=b.id) AS has_approved_brand FROM app.brands b WHERE b.organization_id=$1 ORDER BY b.created_at,b.id LIMIT 100`,
              [org.id],
            )
          ).rows,
      );
      businesses.push(...rows.map((row) => ({ ...row, role: org.role })));
    }
    return { businesses };
  }
  async entitlements(user: string) {
    const org = await this.account(user);
    return this.database.transaction(user, org, false, async (db) => {
      const row = (
        await db.query(
          "SELECT * FROM app.account_entitlements WHERE organization_id=$1",
          [org],
        )
      ).rows[0];
      if (!row)
        throw new ForbiddenException("Account plan access is restricted");
      const active = (
        await db.query(
          "SELECT count(*)::int AS n FROM app.brands WHERE organization_id=$1",
          [org],
        )
      ).rows[0].n;
      return {
        accountId: org,
        plan: row.plan,
        max_active_businesses: row.max_active_businesses,
        active_businesses: active,
        can_create_business: active < row.max_active_businesses,
        upgrade_available: false,
      };
    });
  }
  async create(user: string, input: unknown, key: unknown) {
    const org = await this.account(user);
    try {
      return await this.workspaces.createBrand(user, org, input, key);
    } catch (e) {
      if (
        (e as any)?.code === "P0001" &&
        (e as Error).message === "BUSINESS_LIMIT_REACHED"
      )
        throw new ConflictException(
          "BUSINESS_LIMIT_REACHED: Your account has reached its business limit. Existing businesses remain available.",
        );
      throw e;
    }
  }
  async onboarding(user: string, id: string, input?: unknown) {
    const business = await this.resolve(user, id);
    return this.database.transaction(
      user,
      business.organization_id,
      input !== undefined,
      async (db) => {
        const prior = (
          await db.query(
            "SELECT * FROM app.business_onboarding WHERE organization_id=$1 AND brand_id=$2",
            [business.organization_id, id],
          )
        ).rows[0];
        if (input === undefined) {
          const saved = prior ?? {
            step: 2,
            revision: 0,
            goal: "awareness",
            timezone: "UTC",
            cadence: 3,
            channels: [],
            must_avoid: "",
            preferences_edited: false,
          };
          const recommendation =
            (
              await db.query(
                `SELECT r.*,EXISTS(SELECT 1 FROM app.brand_findings f WHERE f.organization_id=r.organization_id AND f.brand_id=r.brand_id AND f.status IN ('wrong','edited') AND f.reviewed_at>r.created_at) OR EXISTS(SELECT 1 FROM app.brand_sources s WHERE s.organization_id=r.organization_id AND s.brand_id=r.brand_id AND s.captured_at>r.created_at) AS stale FROM app.onboarding_recommendations r WHERE r.organization_id=$1 AND r.brand_id=$2 ORDER BY r.created_at DESC LIMIT 1`,
                [business.organization_id, id],
              )
            ).rows[0] ?? null;
          if (recommendation)
            recommendation.evidence = (
              await db.query(
                "SELECT c.id,c.text,c.page,s.website_url FROM app.brand_chunks c JOIN app.brand_sources s ON s.id=c.source_id WHERE c.organization_id=$1 AND c.brand_id=$2 AND c.id=ANY($3::uuid[])",
                [
                  business.organization_id,
                  id,
                  recommendation.recommendation.chunk_ids,
                ],
              )
            ).rows;
          const suggested =
            recommendation && !recommendation.stale && !saved.preferences_edited
              ? recommendation.recommendation
              : null;
          return {
            ...saved,
            ...(suggested
              ? {
                  goal: suggested.goal,
                  cadence: suggested.cadence,
                  channels: suggested.channels,
                }
              : {}),
            recommendation,
            prefilled: !!suggested,
          };
        }
        const value = object(input, [
          "revision",
          "step",
          "goal",
          "timezone",
          "cadence",
          "channels",
          "must_avoid",
          "preferences_edited",
        ]);
        if (
          (value.preferences_edited !== undefined &&
            typeof value.preferences_edited !== "boolean") ||
          !Number.isInteger(value.revision) ||
          !["awareness", "traffic", "leads", "sales"].includes(
            String(value.goal),
          ) ||
          ![2, 3].includes(Number(value.step)) ||
          !Number.isInteger(value.cadence) ||
          Number(value.cadence) < 1 ||
          Number(value.cadence) > 30 ||
          typeof value.must_avoid !== "string" ||
          value.must_avoid.length > 2000 ||
          !Array.isArray(value.channels) ||
          value.channels.length > 2 ||
          value.channels.some((c) => !["linkedin", "instagram"].includes(c)) ||
          new Set(value.channels).size !== value.channels.length
        )
          throw new BadRequestException(
            "Check the goal, channels, cadence and saved revision",
          );
        try {
          if (typeof value.timezone !== "string" || value.timezone.length > 100)
            throw new Error();
          new Intl.DateTimeFormat("en", { timeZone: value.timezone });
        } catch {
          throw new BadRequestException("Choose a valid time zone");
        }
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `onboarding:${id}`,
        ]);
        const current = (
          await db.query(
            "SELECT revision FROM app.business_onboarding WHERE organization_id=$1 AND brand_id=$2",
            [business.organization_id, id],
          )
        ).rows[0];
        if ((current?.revision ?? 0) !== value.revision)
          throw new ConflictException(
            "Your onboarding changed. Reload the saved version before continuing.",
          );
        const row = (
          await db.query(
            `INSERT INTO app.business_onboarding(organization_id,brand_id,step,goal,timezone,cadence,channels,must_avoid,preferences_edited) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(organization_id,brand_id) DO UPDATE SET step=EXCLUDED.step,goal=EXCLUDED.goal,timezone=EXCLUDED.timezone,cadence=EXCLUDED.cadence,channels=EXCLUDED.channels,must_avoid=EXCLUDED.must_avoid,preferences_edited=business_onboarding.preferences_edited OR EXCLUDED.preferences_edited,revision=business_onboarding.revision+1,updated_at=now() RETURNING *`,
            [
              business.organization_id,
              id,
              value.step,
              value.goal,
              value.timezone,
              value.cadence,
              JSON.stringify(value.channels),
              value.must_avoid,
              value.preferences_edited ?? true,
            ],
          )
        ).rows[0];
        return row;
      },
      id,
    );
  }
  async resolve(user: string, id: string) {
    id = uuid(id);
    const result = (await this.list(user)).businesses.find((b) => b.id === id);
    if (!result) throw new NotFoundException("Business not found");
    return result;
  }
}
