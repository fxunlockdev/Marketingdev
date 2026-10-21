import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Body, Catch, Controller, Get, Headers, HttpException, Inject, Injectable, Module, Param, Patch,
  Post, Req, UnauthorizedException, UseGuards, type ArgumentsHost, type CanActivate, type ExceptionFilter, type ExecutionContext } from '@nestjs/common';
import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { createAuth, type Auth } from './auth.js';
import type { Config } from './config.js';
import { TenantDatabase } from './database.js';
import { Workspaces } from './workspaces.js';

type AuthRequest = Request & { actorId: string; traceId: string };
const AUTH = Symbol('auth');

@Injectable()
class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers), query: { disableCookieCache: true } });
    if (!session) throw new UnauthorizedException('Sign in to continue');
    request.actorId = session.user.id;
    return true;
  }
}

@Catch()
class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp(), response = http.getResponse<Response>(), request = http.getRequest<AuthRequest>();
    const parserType = (error as { type?: string })?.type;
    const status = error instanceof HttpException ? error.getStatus() : parserType === 'entity.too.large' ? 413 : parserType === 'entity.parse.failed' ? 400 : 503;
    response.status(status).json({ error: error instanceof HttpException ? error.message : status === 413 ? 'This request is too large' : status === 400 ? 'Invalid request body' : 'Unable to save or load your work. Please try again.', traceId: request.traceId });
  }
}

@Controller('api/v1/workspaces')
@UseGuards(SessionGuard)
class WorkspaceController {
  constructor(@Inject(Workspaces) private readonly service: Workspaces) {}
  @Get() list(@Req() req: AuthRequest) { return this.service.list(req.actorId); }
  @Post() create(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.create(req.actorId, body); }
  @Get(':org/brands') brands(@Req() req: AuthRequest, @Param('org') org: string) { return this.service.brands(req.actorId, org); }
  @Post(':org/brands') createBrand(@Req() req: AuthRequest, @Param('org') org: string, @Body() body: unknown, @Headers('idempotency-key') key: unknown) {
    return this.service.createBrand(req.actorId, org, body, key);
  }
  @Get(':org/brands/:brand') brand(@Req() req: AuthRequest, @Param('org') org: string, @Param('brand') brand: string) {
    return this.service.brand(req.actorId, org, brand);
  }
  @Patch(':org/brands/:brand') update(@Req() req: AuthRequest, @Param('org') org: string, @Param('brand') brand: string, @Body() body: unknown) {
    return this.service.updateBrand(req.actorId, org, brand, body);
  }
}

export async function createApplication(config: Config) {
  if (!['development', 'test'].includes(config.mode)) throw new Error('External auth launch blocked pending email verification/recovery');
  const authPool = new Pool({ connectionString: config.authDatabaseUrl, options: '-c search_path=auth', max: 5, connectionTimeoutMillis: 5000 });
  const pool = new Pool({ connectionString: config.appDatabaseUrl, max: 10, connectionTimeoutMillis: 5000,
    options: '-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000' });
  // An idle connection can die during a database restart. pg removes it from the pool;
  // handle the event so it doesn't crash the server. Active queries still fail visibly.
  pool.on('error', () => {});
  authPool.on('error', () => {});
  const database = new TenantDatabase(pool);
  try {
    await database.assertRuntimeRole();
    const { rows: [role] } = await authPool.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    if (role.name !== 'desvio_auth' || role.rolsuper || role.rolbypassrls) throw new Error('Unsafe authentication database role');
    const auth = createAuth(authPool, config), workspaces = new Workspaces(database);
    const server = express();
    server.disable('x-powered-by');
    server.use((req: Request, res: Response, next: NextFunction) => {
      (req as AuthRequest).traceId = randomUUID();
      req.headers['x-desvio-peer-ip'] = req.socket.remoteAddress ?? '127.0.0.1';
      res.setHeader('X-Request-Id', (req as AuthRequest).traceId);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Same-origin cookie application: exact origin required on every mutation, including auth.
      if (!['GET','HEAD','OPTIONS'].includes(req.method) &&
          (req.headers.origin !== config.origin || req.headers['sec-fetch-site'] === 'cross-site')) {
        res.status(403).json({ error: 'Open Desvio to make this change' }); return;
      }
      if (!['GET','HEAD','OPTIONS'].includes(req.method) && !req.is('application/json')) {
        res.status(415).json({ error: 'Use a JSON request' }); return;
      }
      next();
    });
    server.get('/health', async (_req, res) => {
      try { await pool.query('SELECT 1'); res.json({ status: 'ok', scope: 'api-database-only' }); }
      catch { res.status(503).json({ status: 'unavailable' }); }
    });
    // Pinned better-call Node adapter reconstructs consumed JSON bodies (contract-tested below).
    // Bound auth bodies too, including chunked requests without Content-Length.
    server.use(express.json({ limit: '32kb', strict: true }));
    server.use((error: { type?: string }, req: Request, res: Response, next: NextFunction) => {
      if (!['entity.too.large','entity.parse.failed'].includes(error.type ?? '')) { next(error); return; }
      res.status(error.type === 'entity.too.large' ? 413 : 400).json({
        error: error.type === 'entity.too.large' ? 'This request is too large' : 'Invalid request body',
        traceId: (req as AuthRequest).traceId,
      });
    });
    server.all('/api/auth/{*path}', toNodeHandler(auth));
    @Module({ controllers: [WorkspaceController], providers: [SessionGuard,
      { provide: AUTH, useValue: auth }, { provide: Workspaces, useValue: workspaces }] })
    class AppModule {}
    const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { bodyParser: false, logger: false });
    app.useGlobalFilters(new SafeErrors());
    await app.init();
    return { app, database, auth, async close() { await app.close(); await Promise.all([pool.end(), authPool.end()]); } };
  } catch (error) { await Promise.all([pool.end(), authPool.end()]); throw error; }
}
