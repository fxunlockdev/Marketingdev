import {SocialOAuth} from './social-oauth.js';
import {SocialConnections} from './social-connections.js';
import {CreativeExports} from './creative-exports.js';
import {SlotCreatives} from './slot-creatives.js';
import {Planning} from "./planning.js";
import {ContentPlan} from "./content-plan.js";
import {Canvas} from "./canvas.js";
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Body, Catch, Controller, Get, Headers, HttpException, Inject, Injectable, Module, Param, Patch,
  Post, Query, Req, UnauthorizedException, UseGuards, type ArgumentsHost, type CanActivate, type ExceptionFilter, type ExecutionContext } from '@nestjs/common';
import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { createAuth, type Auth } from './auth.js';
import type { Config } from './config.js';
import { TenantDatabase } from './database.js';
import { Workspaces } from './workspaces.js';
import { MailQueue,MailWorker } from './mail.js';
import { Team } from './team.js';
import {Businesses} from './businesses.js';
import {Intake} from './intake.js';
import {BrandBrain} from './brand-brain.js';
import {Assets} from './assets.js';
import {ObjectStore} from './object-store.js';

type AuthRequest = Request & { actorId: string; sessionId: string; traceId: string };
const AUTH = Symbol('auth');

@Injectable()
class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers), query: { disableCookieCache: true } });
    if (!session || !session.user.emailVerified) throw new UnauthorizedException('Sign in with a verified email to continue');
    request.actorId = session.user.id;
    request.sessionId = session.session.id;
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

@Controller('api/v1/businesses/:id/connections')
@UseGuards(SessionGuard)
class SocialController {
 constructor(@Inject(SocialConnections) private readonly service:SocialConnections,@Inject(SocialOAuth) private readonly oauth:SocialOAuth){}
 @Post('oauth/linkedin') start(@Req() req:AuthRequest,@Param('id') id:string,@Headers('idempotency-key') key:string){return this.oauth.start(req.actorId,req.sessionId,id,key);}
 @Get('oauth/:attempt') authorization(@Req() req:AuthRequest,@Param('id') id:string,@Param('attempt') attempt:string){return this.oauth.read(req.actorId,req.sessionId,id,attempt);}
 @Post('oauth/:attempt/callback') callback(@Req() req:AuthRequest,@Param('id') id:string,@Param('attempt') attempt:string,@Body() body:unknown){return this.oauth.callback(req.actorId,req.sessionId,id,attempt,body);}
 @Get() read(@Req() req:AuthRequest,@Param('id') id:string){return this.service.read(req.actorId,id);}
 @Post('refresh') refresh(@Req() req:AuthRequest,@Param('id') id:string,@Headers('idempotency-key') key:string){return this.service.refresh(req.actorId,id,key);}
 @Post('jobs/:job/cancel') cancel(@Req() req:AuthRequest,@Param('id') id:string,@Param('job') job:string){return this.service.cancel(req.actorId,id,job);}
}

@Controller('api/v1')
@UseGuards(SessionGuard)
class BusinessController {
 constructor(@Inject(Businesses) private readonly service:Businesses,@Inject(Intake) private readonly intake:Intake){}
 @Get('businesses/:id/visuals/:visualId') visualReference(@Req() r:AuthRequest,@Param('id') id:string,@Param('visualId') visualId:string){return this.intake.visual(r.actorId,id,visualId);}
 @Get('businesses/:id/intake') intakeStatus(@Req() r:AuthRequest,@Param('id') id:string){return this.intake.read(r.actorId,id);}
 @Post('businesses/:id/intake') submitIntake(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.intake.submit(r.actorId,id,body,key);}
 @Post('accounts/current/initialize') initialize(@Req() r:AuthRequest){return this.service.initialize(r.actorId);}
 @Get('accounts/current/entitlements') entitlements(@Req() r:AuthRequest){return this.service.entitlements(r.actorId);}
 @Get('businesses') list(@Req() r:AuthRequest){return this.service.list(r.actorId);}
 @Post('businesses') create(@Req() r:AuthRequest,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.create(r.actorId,body,key);}
 @Get('businesses/:id/onboarding') onboarding(@Req() r:AuthRequest,@Param('id') id:string){return this.service.onboarding(r.actorId,id);}
 @Patch('businesses/:id/onboarding') saveOnboarding(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.service.onboarding(r.actorId,id,body);}
 @Get('businesses/:id') resolve(@Req() r:AuthRequest,@Param('id') id:string){return this.service.resolve(r.actorId,id);}
}

@Controller('api/v1/businesses/:id')
@UseGuards(SessionGuard)
class ExportController {
 constructor(@Inject(CreativeExports) private readonly service:CreativeExports){}
 @Get('creative-versions/:versionId/exports') list(@Req() r:AuthRequest,@Param('id') id:string,@Param('versionId') v:string){return this.service.list(r.actorId,id,v);}
 @Post('creative-versions/:versionId/exports') submit(@Req() r:AuthRequest,@Param('id') id:string,@Param('versionId') v:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.submit(r.actorId,id,v,body,key);}
 @Get('creative-exports/:exportId/download') download(@Req() r:AuthRequest,@Param('id') id:string,@Param('exportId') e:string){return this.service.download(r.actorId,id,e);}
 @Post('creative-exports/:exportId/approve') approve(@Req() r:AuthRequest,@Param('id') id:string,@Param('exportId') e:string,@Body() body:unknown){return this.service.approve(r.actorId,id,e,body);}
 @Post('export-jobs/:jobId/cancel') cancel(@Req() r:AuthRequest,@Param('id') id:string,@Param('jobId') j:string){return this.service.cancel(r.actorId,id,j);}
}

@Controller('api/v1/businesses/:id')
@UseGuards(SessionGuard)
class ContentPlanController {
 constructor(@Inject(ContentPlan) private readonly service:ContentPlan,@Inject(Planning) private readonly planning:Planning,@Inject(SlotCreatives) private readonly creatives:SlotCreatives){}
 @Post('content-plan/generate') generate(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.planning.submit(r.actorId,id,body,key);}
 @Get('content-plan/jobs') jobs(@Req() r:AuthRequest,@Param('id') id:string){return this.planning.jobs(r.actorId,id);}
 @Get('content-plans/:planId') detail(@Req() r:AuthRequest,@Param('id') id:string,@Param('planId') p:string){return this.planning.detail(r.actorId,id,p);}
 @Post('planning-jobs/:jobId/cancel') cancel(@Req() r:AuthRequest,@Param('id') id:string,@Param('jobId') j:string){return this.planning.cancel(r.actorId,id,j);}
 @Post('content-plans') create(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.create(r.actorId,id,body,key);}
 @Get('content-plan') list(@Req() r:AuthRequest,@Param('id') id:string,@Query() query:unknown){return this.service.list(r.actorId,id,query);}
 @Get('review-inbox') inbox(@Req() r:AuthRequest,@Param('id') id:string,@Query() query:unknown){return this.service.list(r.actorId,id,query,true);}
 @Get('content-slots/:slotId') slot(@Req() r:AuthRequest,@Param('id') id:string,@Param('slotId') slot:string){return this.creatives.detail(r.actorId,id,slot);}
 @Post('content-slots/:slotId/generate-creative') creative(@Req() r:AuthRequest,@Param('id') id:string,@Param('slotId') slot:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.creatives.generate(r.actorId,id,slot,body,key);}
 @Patch('content-slots/:slotId') edit(@Req() r:AuthRequest,@Param('id') id:string,@Param('slotId') slot:string,@Body() body:unknown){return this.service.edit(r.actorId,id,slot,body);}
 @Get('content-slots/:slotId/history') history(@Req() r:AuthRequest,@Param('id') id:string,@Param('slotId') slot:string){return this.service.history(r.actorId,id,slot);}
 @Post('reviews/bulk-approve') bulk(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.service.bulkApprove(r.actorId,id,body);}
 @Post('reviews/:slotId') review(@Req() r:AuthRequest,@Param('id') id:string,@Param('slotId') slot:string,@Body() body:unknown){return this.service.review(r.actorId,id,slot,body);}
}

@Controller('api/v1/businesses/:id')
@UseGuards(SessionGuard)
class CanvasController {
 constructor(@Inject(Canvas) private readonly service:Canvas){}
 @Get('canvas/threads') list(@Req() r:AuthRequest,@Param('id') id:string){return this.service.list(r.actorId,id);}
 @Post('canvas/threads') create(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.createThread(r.actorId,id,body,key);}
 @Get('canvas/threads/:threadId') thread(@Req() r:AuthRequest,@Param('id') id:string,@Param('threadId') t:string){return this.service.thread(r.actorId,id,t);}
 @Post('canvas/threads/:threadId/messages') message(@Req() r:AuthRequest,@Param('id') id:string,@Param('threadId') t:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.submit(r.actorId,id,t,body,key);}
 @Get('creative-projects/:projectId') project(@Req() r:AuthRequest,@Param('id') id:string,@Param('projectId') p:string){return this.service.project(r.actorId,id,p);}
 @Post('creative-projects/:projectId/versions') save(@Req() r:AuthRequest,@Param('id') id:string,@Param('projectId') p:string,@Body() body:unknown){return this.service.save(r.actorId,id,p,body);}
 @Post('creative-versions/:versionId/review') review(@Req() r:AuthRequest,@Param('id') id:string,@Param('versionId') v:string,@Body() body:unknown){return this.service.review(r.actorId,id,v,body);}
 @Get('creative-media/:mediaId') media(@Req() r:AuthRequest,@Param('id') id:string,@Param('mediaId') m:string){return this.service.media(r.actorId,id,m);}
 @Post('creative-jobs/:jobId/cancel') cancel(@Req() r:AuthRequest,@Param('id') id:string,@Param('jobId') j:string){return this.service.cancel(r.actorId,id,j);}
}

@Controller('api/v1/workspaces')
@UseGuards(SessionGuard)
class WorkspaceController {
  constructor(@Inject(Workspaces) private readonly service: Workspaces,@Inject(Team) private readonly team:Team) {}
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
  @Get(':org/members') members(@Req() req:AuthRequest,@Param('org') org:string) {return this.team.list(req.actorId,org);}
  @Patch(':org/members/:user') changeMember(@Req() req:AuthRequest,@Param('org') org:string,@Param('user') user:string,@Body() body:unknown) {return this.team.change(req.actorId,org,user,body);}
  @Get(':org/invitations') invitations(@Req() req:AuthRequest,@Param('org') org:string) {return this.team.invitations(req.actorId,org);}
  @Post(':org/invitations') invite(@Req() req:AuthRequest,@Param('org') org:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown) {return this.team.invite(req.actorId,org,body,key);}
  @Post(':org/invitations/:id/revoke') revoke(@Req() req:AuthRequest,@Param('org') org:string,@Param('id') id:string) {return this.team.revoke(req.actorId,org,id);}
}
@Controller('api/v1/invitations')
@UseGuards(SessionGuard)
class InvitationController {
  constructor(@Inject(Team) private readonly team:Team) {}
  @Post('accept') accept(@Req() req:AuthRequest,@Body() body:unknown) {return this.team.accept(req.actorId,body);}
}

@Controller('api/v1/workspaces/:org/brands/:brand')
@UseGuards(SessionGuard)
class AssetController {
  constructor(@Inject(Assets) private readonly assets:Assets){}
  @Post('uploads') reserve(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.assets.reserve(r.actorId,o,b,body,key);}
  @Post('assets/:id/extract') extract(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string,@Param('id') id:string,@Headers('idempotency-key') key:unknown){return this.assets.extract(r.actorId,o,b,id,key);}
  @Post('assets/:id/abandon') abandon(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string,@Param('id') id:string){return this.assets.abandon(r.actorId,o,b,id);}
  @Get('assets') list(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string){return this.assets.list(r.actorId,o,b);}
  @Post('assets/:id/complete') complete(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string,@Param('id') id:string){return this.assets.complete(r.actorId,o,b,id);}
  @Post('assets/:id/download') download(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string,@Param('id') id:string){return this.assets.download(r.actorId,o,b,id);}
  @Get('jobs/:id') job(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string,@Param('id') id:string){return this.assets.job(r.actorId,o,b,id);}
  @Post('jobs/:id/cancel') cancel(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string,@Param('id') id:string){return this.assets.job(r.actorId,o,b,id,true);}
}

@Controller('api/v1/workspaces/:org/brands/:brand/brain')
@UseGuards(SessionGuard)
class BrainController {
 constructor(@Inject(BrandBrain) private readonly brain:BrandBrain){}
 @Get() read(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string){return this.brain.read(r.actorId,o,b);}
 @Get('sources/:id') source(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string,@Param('id') id:string){return this.brain.source(r.actorId,o,b,id);}
 @Post('findings') manual(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.brain.manual(r.actorId,o,b,body,key);}
 @Patch('findings/:id') review(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string,@Param('id') id:string,@Body() body:unknown){return this.brain.review(r.actorId,o,b,id,body);}
 @Post('approve') approve(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string,@Body() body:unknown){return this.brain.approve(r.actorId,o,b,body);}
 @Get('versions/:id') version(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string,@Param('id') id:string){return this.brain.version(r.actorId,o,b,id);}
}

export async function createApplication(config: Config) {
  if(config.mode==='production') throw new Error('Production launch blocked pending the complete release gate');
  const authPool = new Pool({ connectionString: config.authDatabaseUrl, options: '-c search_path=auth', max: 5, connectionTimeoutMillis: 5000 });
  const pool = new Pool({ connectionString: config.appDatabaseUrl, max: 10, connectionTimeoutMillis: 5000,
    options: '-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000' });
  // An idle connection can die during a database restart. pg removes it from the pool;
  // handle the event so it doesn't crash the server. Active queries still fail visibly.
  pool.on('error', () => {});
  authPool.on('error', () => {});
  const mailPool=new Pool({connectionString:config.mailDatabaseUrl,max:3,connectionTimeoutMillis:5000});
  mailPool.on('error',()=>{});
  const database = new TenantDatabase(pool),store=new ObjectStore(config.storage);
  try {
    await database.assertRuntimeRole();
    const { rows: [role] } = await authPool.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    if (role.name !== 'desvio_auth' || role.rolsuper || role.rolbypassrls) throw new Error('Unsafe authentication database role');
    const mail=new MailQueue(config.origin,config.mailEncryptionKey),mailWorker=new MailWorker(mailPool,mail,config);
    await mailWorker.assertRole();
    const auth = createAuth(authPool, config,mail), workspaces = new Workspaces(database),team=new Team(database,mail,config.origin);
    const server = express();
    server.disable('x-powered-by');
    server.use((req: Request, res: Response, next: NextFunction) => {
      (req as AuthRequest).traceId = randomUUID();
      req.headers['x-desvio-trace-id']=(req as AuthRequest).traceId;
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
    server.all('/api/auth/{*path}', toNodeHandler(async request=>{
      const unavailable=()=>globalThis.Response.json({error:'Account service is temporarily unavailable. Please try again.',traceId:request.headers.get('x-desvio-trace-id')},{status:503});
      try {const response=await auth.handler(request);return response.status>=500?unavailable():response;}
      catch {return unavailable();}
    }));
    @Module({ controllers: [SocialController,ExportController,WorkspaceController,InvitationController,AssetController,BrainController,BusinessController,CanvasController,ContentPlanController], providers: [SessionGuard,
      {provide:SocialOAuth,useValue:new SocialOAuth(new SocialConnections(new Businesses(database,workspaces),config.socialEnabled===true),config.oauthEncryptionKey)},{provide:SocialConnections,useValue:new SocialConnections(new Businesses(database,workspaces),config.socialEnabled===true)},{ provide: AUTH, useValue: auth }, { provide: Workspaces, useValue: workspaces },{provide:Team,useValue:team},{provide:Assets,useValue:new Assets(database,store)},{provide:BrandBrain,useValue:new BrandBrain(database)},{provide:Businesses,useValue:new Businesses(database,workspaces)},{provide:CreativeExports,useValue:new CreativeExports(new Canvas(new Businesses(database,workspaces),store),config.renderImage)},{provide:SlotCreatives,useValue:new SlotCreatives(new ContentPlan(new Businesses(database,workspaces)),new Canvas(new Businesses(database,workspaces),store))},{provide:Planning,useValue:new Planning(new ContentPlan(new Businesses(database,workspaces)))},{provide:ContentPlan,useValue:new ContentPlan(new Businesses(database,workspaces))},{provide:Canvas,useValue:new Canvas(new Businesses(database,workspaces),store)},{provide:Intake,useValue:new Intake(new Businesses(database,workspaces),store)}] })
    class AppModule {}
    const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { bodyParser: false, logger: false });
    app.useGlobalFilters(new SafeErrors());
    await app.init();
    return { app, database, auth,mailWorker, async close() { await app.close();mailWorker.close();store.close(); await Promise.all([pool.end(), authPool.end(),mailPool.end()]); } };
  } catch (error) { store.close();await Promise.all([pool.end(), authPool.end(),mailPool.end()]); throw error; }
}
