import {ChatActionWorker} from './chat-action-worker.js';
import {ChatConversations} from './chat-conversations.js';
import {Put} from '@nestjs/common';
import {resolveIngressAddress} from './auth-ingress.js';
import {CampaignIdeas} from './campaign-ideas.js';
import {CampaignBlogs} from './campaign-blogs.js';
import {CreativeProvider} from './creative-provider.js';
import {Postforme} from './postforme.js';
import {HiggsfieldReplacements} from './higgsfield-replacements.js';
import {Strategies} from './strategies.js';
import {StockMedia} from './stock-media.js';
import {StockProvider} from './stock-provider.js';
import {GenerationNotifications} from './generation-notifications.js';
import {ProjectArchive} from './project-archive.js';
import {Readable} from 'node:stream';
import {StreamableFile} from '@nestjs/common';
import {CarouselGeneration} from './carousel-generation.js';
import {Carousels} from './carousels.js';
import {Insights} from './insights.js';
import {VideoCanvas} from './video-canvas.js';
import {VideoReferenceBindings} from './video-references.js';
import {BusinessOverview} from './business-overview.js';
import {Publication} from './publication.js';
import {SocialProvisioning} from './social-provisioning.js';
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
import { Body, Catch, Controller, Delete, Get, Headers, HttpException, Inject, Injectable, Module, Param, Patch,
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

type AuthRequest = Request & { actorId: string; actorEmail: string; sessionId: string; traceId: string };
const AUTH = Symbol('auth');

@Injectable()
class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers), query: { disableCookieCache: true } });
    if (!session || !session.user.emailVerified) throw new UnauthorizedException('Sign in with a verified email to continue');
    request.actorId = session.user.id;
    request.actorEmail = session.user.email;
    request.sessionId = session.session.id;
    return true;
  }
}

@Controller('api/v1/businesses/:id/generation-notifications')
@UseGuards(SessionGuard)
class StandaloneGenerationNotificationsController {
 constructor(@Inject(GenerationNotifications) readonly service:GenerationNotifications){}
 @Get() read(@Req() r:AuthRequest,@Param('id') id:string){return this.service.read(r.actorId,id,null);}
 @Post() subscribe(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.service.subscribe(r.actorId,r.actorEmail,id,null,body);}
 @Post(':notification/cancel') cancel(@Req() r:AuthRequest,@Param('id') id:string,@Param('notification') notification:string){return this.service.cancel(r.actorId,id,null,notification);}
}

@Controller('api/v1/businesses/:id/content-plans/:plan/notifications')
@UseGuards(SessionGuard)
class GenerationNotificationsController {
 constructor(@Inject(GenerationNotifications) readonly service:GenerationNotifications){}
 @Get() read(@Req() r:AuthRequest,@Param('id') id:string,@Param('plan') plan:string){return this.service.read(r.actorId,id,plan);}
 @Post() subscribe(@Req() r:AuthRequest,@Param('id') id:string,@Param('plan') plan:string,@Body() body:unknown){return this.service.subscribe(r.actorId,r.actorEmail,id,plan,body);}
 @Post(':notification/cancel') cancel(@Req() r:AuthRequest,@Param('id') id:string,@Param('plan') plan:string,@Param('notification') notification:string){return this.service.cancel(r.actorId,id,plan,notification);}
}

@Controller('api/v1/businesses/:id')
@UseGuards(SessionGuard)
class ProjectArchiveController {
 @Post('canvas-projects/:kind/:project/archive') archiveKind(@Req() r:AuthRequest,@Param('id') id:string,@Param('kind') kind:string,@Param('project') project:string,@Body() body:unknown){return this.service.change(r.actorId,id,project,body,true,kind);}
 @Post('canvas-projects/:kind/:project/restore') restoreKind(@Req() r:AuthRequest,@Param('id') id:string,@Param('kind') kind:string,@Param('project') project:string,@Body() body:unknown){return this.service.change(r.actorId,id,project,body,false,kind);}
 constructor(@Inject(ProjectArchive) readonly service:ProjectArchive){}
 @Get('creative-project-archive') list(@Req() r:AuthRequest,@Param('id') id:string,@Query() query:unknown){return this.service.list(r.actorId,id,query);}
 @Post('creative-projects/:project/archive') archive(@Req() r:AuthRequest,@Param('id') id:string,@Param('project') project:string,@Body() body:unknown){return this.service.change(r.actorId,id,project,body,true);}
 @Post('creative-projects/:project/restore') restore(@Req() r:AuthRequest,@Param('id') id:string,@Param('project') project:string,@Body() body:unknown){return this.service.change(r.actorId,id,project,body,false);}
}

@Controller('api/v1/businesses/:id/strategies')
@UseGuards(SessionGuard)
class StrategiesController {
 constructor(@Inject(Strategies) readonly service:Strategies){}
 @Get() list(@Req() r:AuthRequest,@Param('id') id:string){return this.service.list(r.actorId,id);}
 @Post() create(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:string){return this.service.create(r.actorId,id,body,key);}
 @Post(':strategy/stop') stop(@Req() r:AuthRequest,@Param('id') id:string,@Param('strategy') strategy:string){return this.service.stop(r.actorId,id,strategy);}
 @Post(':strategy/campaigns/:plan/images') images(@Req() r:AuthRequest,@Param('id') id:string,@Param('strategy') strategy:string,@Param('plan') plan:string){return this.service.generate(r.actorId,id,strategy,plan);}
}

@Controller('api/v1/businesses/:id/higgsfield-images')
@UseGuards(SessionGuard)
class HiggsfieldReplacementsController {
 constructor(@Inject(HiggsfieldReplacements) readonly service:HiggsfieldReplacements){}
 @Get('quote') quote(@Req() r:AuthRequest,@Param('id') id:string){return this.service.quote(r.actorId,id);}
 @Get('projects/:project') status(@Req() r:AuthRequest,@Param('id') id:string,@Param('project') project:string){return this.service.status(r.actorId,id,project);}
 @Post('projects/:project') submit(@Req() r:AuthRequest,@Param('id') id:string,@Param('project') project:string,@Body() body:unknown,@Headers('idempotency-key') key:string){return this.service.submit(r.actorId,id,project,body,key);}
}

@Controller('api/v1/businesses/:id/stock')
@UseGuards(SessionGuard)
class StockMediaController {
 constructor(@Inject(StockMedia) readonly service:StockMedia){}
 @Get('capabilities') capabilities(@Req() r:AuthRequest,@Param('id') id:string){return this.service.capabilities(r.actorId,id);}
 @Get() search(@Req() r:AuthRequest,@Param('id') id:string,@Query() query:unknown){return this.service.search(r.actorId,id,query);}
 @Get('photos/:photo/preview') async preview(@Req() r:AuthRequest,@Param('id') id:string,@Param('photo') photo:string){const result=await this.service.preview(r.actorId,id,photo);return new StreamableFile(result.bytes,{type:result.type,length:result.bytes.length,disposition:'inline'});}
 @Post('imports') importPhoto(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:string){return this.service.import(r.actorId,id,body,key);}
 @Get('imports/:key') status(@Req() r:AuthRequest,@Param('id') id:string,@Param('key') key:string){return this.service.status(r.actorId,id,key);}
 @Post('projects/:project/replace') replace(@Req() r:AuthRequest,@Param('id') id:string,@Param('project') project:string,@Body() body:unknown){return this.service.replace(r.actorId,id,project,body);}
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

@Controller('api/v1/businesses/:id/carousel-generations')
@UseGuards(SessionGuard)
class CarouselGenerationController {
 constructor(@Inject(CarouselGeneration) private readonly service:CarouselGeneration){}
 @Get() read(@Req() r:AuthRequest,@Param('id') id:string){return this.service.read(r.actorId,id);}
 @Post() submit(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:string){return this.service.submit(r.actorId,id,body,key);}
 @Post(':job/cancel') cancel(@Req() r:AuthRequest,@Param('id') id:string,@Param('job') job:string){return this.service.cancel(r.actorId,id,job);}
}

@Controller('api/v1/businesses/:id/carousels')
@UseGuards(SessionGuard)
class CarouselsController {
 constructor(@Inject(Carousels) private readonly service:Carousels){}
 @Get() list(@Req() r:AuthRequest,@Param('id') id:string){return this.service.list(r.actorId,id);}
 @Get('versions/:version/download') async download(@Req() r:AuthRequest,@Param('id') id:string,@Param('version') version:string){
  const bundle=await this.service.download(r.actorId,id,version);
  return new StreamableFile(Readable.from(bundle.stream()),{type:'application/zip',disposition:'attachment; filename="desvio-carousel.zip"',length:bundle.length});
 }
 @Get(':project') read(@Req() r:AuthRequest,@Param('id') id:string,@Param('project') project:string){return this.service.read(r.actorId,id,project);}
 @Post() save(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:string){return this.service.save(r.actorId,id,body,key);}
 @Post(':version/review') review(@Req() r:AuthRequest,@Param('id') id:string,@Param('version') version:string,@Body() body:unknown){return this.service.review(r.actorId,id,version,body);}
}

@Controller('api/v1/businesses/:id/insights')
@UseGuards(SessionGuard)
class InsightsController {
 constructor(@Inject(Insights) private readonly service:Insights){}
 @Get() read(@Req() r:AuthRequest,@Param('id') id:string){return this.service.read(r.actorId,id);}
 @Post() submit(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:string){return this.service.submit(r.actorId,id,body,key);}
 @Post(':lesson/experiments') experiment(@Req() r:AuthRequest,@Param('id') id:string,@Param('lesson') lesson:string,@Body() body:unknown,@Headers('idempotency-key') key:string){return this.service.recordExperiment(r.actorId,id,lesson,body,key);}
 @Post(':lesson/review') review(@Req() r:AuthRequest,@Param('id') id:string,@Param('lesson') lesson:string,@Body() body:unknown){return this.service.review(r.actorId,id,lesson,body);}
 @Post(':job/cancel') cancel(@Req() r:AuthRequest,@Param('id') id:string,@Param('job') job:string){return this.service.cancel(r.actorId,id,job);}
}

@Controller('api/v1/businesses/:id')
@UseGuards(SessionGuard)
class CampaignBlogsController {
 constructor(@Inject(CampaignBlogs) private readonly service:CampaignBlogs){}
 @Get('content-plans/:plan/blogs') list(@Req() r:AuthRequest,@Param('id') id:string,@Param('plan') p:string){return this.service.list(r.actorId,id,p);}
 @Post('content-plans/:plan/blogs') create(@Req() r:AuthRequest,@Param('id') id:string,@Param('plan') p:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.create(r.actorId,id,p,body,key);}
 @Get('campaign-blogs/:blog') detail(@Req() r:AuthRequest,@Param('id') id:string,@Param('blog') blog:string){return this.service.detail(r.actorId,id,blog);}
 @Patch('campaign-blogs/:blog') save(@Req() r:AuthRequest,@Param('id') id:string,@Param('blog') blog:string,@Body() body:unknown){return this.service.save(r.actorId,id,blog,body);}
 @Post('campaign-blogs/:blog/generate') generate(@Req() r:AuthRequest,@Param('id') id:string,@Param('blog') blog:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.generate(r.actorId,id,blog,body,key);}
}

@Controller('api/v1/postforme')
@UseGuards(SessionGuard)
class PostformeReturnController {
 constructor(@Inject(Postforme) private readonly service:Postforme){}
 @Get('return') finish(@Req() r:AuthRequest){return this.service.returnAttempt(r.actorId,r.sessionId);}
}

@Controller('api/v1/businesses/:id/postforme')
@UseGuards(SessionGuard)
class PostformeController {
 constructor(@Inject(Postforme) private readonly service:Postforme){}
 @Get('connections') read(@Req() r:AuthRequest,@Param('id') id:string){return this.service.read(r.actorId,id,r.sessionId);}
 @Post('connections/authorize') authorize(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return this.service.authorize(r.actorId,r.sessionId,id,b);}
 @Post('connections/finish') finish(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown){return this.service.finish(r.actorId,r.sessionId,id,b);}
 @Post('connections/refresh') refresh(@Req() r:AuthRequest,@Param('id') id:string){return this.service.refresh(r.actorId,id,r.sessionId);}
 @Post('connections/:account/disconnect') disconnect(@Req() r:AuthRequest,@Param('id') id:string,@Param('account') account:string){return this.service.disconnect(r.actorId,id,account,r.sessionId);}
 @Get('analytics') analytics(@Req() r:AuthRequest,@Param('id') id:string){return this.service.analytics(r.actorId,id);}
 @Post('analytics/refresh') analyticsRefresh(@Req() r:AuthRequest,@Param('id') id:string){return this.service.refreshAnalytics(r.actorId,id);}
 @Get('publications') publications(@Req() r:AuthRequest,@Param('id') id:string){return this.service.list(r.actorId,id);}
 @Get('publications/ready') ready(@Req() r:AuthRequest,@Param('id') id:string){return this.service.ready(r.actorId,id);}
 @Post('publications') submit(@Req() r:AuthRequest,@Param('id') id:string,@Body() b:unknown,@Headers('idempotency-key') key:string){return this.service.submit(r.actorId,id,b,key);}
 @Post('publications/:post/reconcile') reconcile(@Req() r:AuthRequest,@Param('id') id:string,@Param('post') post:string){return this.service.reconcile(r.actorId,id,post);}
}

@Controller('api/v1/businesses/:id/analytics')
@UseGuards(SessionGuard)
class AnalyticsController {
 constructor(@Inject(Publication) private readonly service:Publication){}
 @Get() read(@Req() r:AuthRequest,@Param('id') id:string,@Query() query:unknown){return this.service.analytics(r.actorId,id,query);}
}

@Controller('api/v1/businesses/:id/publications')
@UseGuards(SessionGuard)
class PublicationController {
 constructor(@Inject(Publication) private readonly service:Publication){}
 @Get() list(@Req() r:AuthRequest,@Param('id') id:string){return this.service.list(r.actorId,id);}
 @Post() submit(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:string){return this.service.submit(r.actorId,id,body,key);}
 @Get('ready') ready(@Req() r:AuthRequest,@Param('id') id:string){return this.service.ready(r.actorId,id);}
 @Get(':job/history') history(@Req() r:AuthRequest,@Param('id') id:string,@Param('job') job:string){return this.service.history(r.actorId,id,job);}
 @Post(':job/cancel') cancel(@Req() r:AuthRequest,@Param('id') id:string,@Param('job') job:string){return this.service.cancel(r.actorId,id,job);}
 @Post(':job/reconcile') reconcile(@Req() r:AuthRequest,@Param('id') id:string,@Param('job') job:string,@Headers('idempotency-key') key:string){return this.service.reconcile(r.actorId,id,job,key);}
}

@Controller('api/v1/businesses/:id/connections')
@UseGuards(SessionGuard)
class SocialController {
 constructor(@Inject(SocialConnections) private readonly service:SocialConnections,@Inject(SocialOAuth) private readonly oauth:SocialOAuth,@Inject(SocialProvisioning) private readonly provision:SocialProvisioning){}
 @Post('prepare') prepare(@Req() req:AuthRequest,@Param('id') id:string,@Headers('idempotency-key') key:string){return this.provision.prepare(req.actorId,id,key);}
 @Post('provisioning/:job/recheck') recheckSetup(@Req() req:AuthRequest,@Param('id') id:string,@Param('job') job:string,@Headers('idempotency-key') key:string){return this.provision.recheck(req.actorId,id,job,key);}
 @Post('provisioning/:job/cancel') cancelSetup(@Req() req:AuthRequest,@Param('id') id:string,@Param('job') job:string){return this.provision.cancel(req.actorId,id,job);}
 @Post('oauth/:provider') start(@Req() req:AuthRequest,@Param('id') id:string,@Param('provider') provider:string,@Headers('idempotency-key') key:string,@Body() body:unknown){return this.oauth.start(req.actorId,req.sessionId,id,key,body,provider);}
 @Get('oauth/:attempt') authorization(@Req() req:AuthRequest,@Param('id') id:string,@Param('attempt') attempt:string){return this.oauth.read(req.actorId,req.sessionId,id,attempt);}
 @Post('oauth/:attempt/callback') callback(@Req() req:AuthRequest,@Param('id') id:string,@Param('attempt') attempt:string,@Body() body:unknown){return this.oauth.callback(req.actorId,req.sessionId,id,attempt,body);}
 @Post('oauth/:attempt/cancel') cancelPageSelection(@Req() req:AuthRequest,@Param('id') id:string,@Param('attempt') attempt:string){return this.oauth.cancelPageSelection(req.actorId,req.sessionId,id,attempt);}
 @Post('oauth/:attempt/page') selectPage(@Req() req:AuthRequest,@Param('id') id:string,@Param('attempt') attempt:string,@Body() body:unknown){return this.oauth.selectPage(req.actorId,req.sessionId,id,attempt,body);}
 @Get() read(@Req() req:AuthRequest,@Param('id') id:string){return this.service.read(req.actorId,id,req.sessionId);}
 @Post('channels/:channel/disconnect') disconnect(@Req() req:AuthRequest,@Param('id') id:string,@Param('channel') channel:string,@Headers('idempotency-key') key:string,@Body() body:unknown){return this.service.disconnect(req.actorId,id,channel,key,body);}
 @Post('refresh') refresh(@Req() req:AuthRequest,@Param('id') id:string,@Headers('idempotency-key') key:string){return this.service.refresh(req.actorId,id,key);}
 @Post('jobs/:job/cancel') cancel(@Req() req:AuthRequest,@Param('id') id:string,@Param('job') job:string){return this.service.cancel(req.actorId,id,job);}
}

@Controller('api/v1')
@UseGuards(SessionGuard)
class BusinessController {
 constructor(@Inject(Businesses) private readonly service:Businesses,@Inject(Intake) private readonly intake:Intake,@Inject(BusinessOverview) private readonly overview:BusinessOverview,@Inject(Team) private readonly team:Team){}
 @Get('businesses/:id/team') businessTeam(@Req() r:AuthRequest,@Param('id') id:string){return this.team.businessList(r.actorId,id);}
 @Post('businesses/:id/team/invitations') businessInvite(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.team.businessInvite(r.actorId,id,body,key);}
 @Post('businesses/:id/team/invitations/:invitation/revoke') businessRevoke(@Req() r:AuthRequest,@Param('id') id:string,@Param('invitation') invitation:string){return this.team.businessRevoke(r.actorId,id,invitation);}
 @Patch('businesses/:id/team/members/:target') businessChange(@Req() r:AuthRequest,@Param('id') id:string,@Param('target') target:string,@Body() body:unknown){return this.team.businessChange(r.actorId,id,target,body);}
 @Get('businesses/:id/overview') businessOverview(@Req() r:AuthRequest,@Param('id') id:string){return this.overview.read(r.actorId,id);}
 @Get('businesses/:id/visuals/:visualId') visualReference(@Req() r:AuthRequest,@Param('id') id:string,@Param('visualId') visualId:string){return this.intake.visual(r.actorId,id,visualId);}
 @Get('businesses/:id/intake') intakeStatus(@Req() r:AuthRequest,@Param('id') id:string){return this.intake.read(r.actorId,id);}
 @Post('businesses/:id/intake') submitIntake(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.intake.submit(r.actorId,id,body,key);}
 @Post('accounts/current/initialize') initialize(@Req() r:AuthRequest){return this.service.initialize(r.actorId);}
 @Get('accounts/current/entitlements') entitlements(@Req() r:AuthRequest){return this.service.entitlements(r.actorId);}
 @Get('businesses') list(@Req() r:AuthRequest){return this.service.list(r.actorId);}
 @Post('businesses') create(@Req() r:AuthRequest,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.create(r.actorId,body,key);}
 @Get('businesses/:id/onboarding') onboarding(@Req() r:AuthRequest,@Param('id') id:string){return this.service.onboarding(r.actorId,id);}
 @Patch('businesses/:id/onboarding') saveOnboarding(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.service.onboarding(r.actorId,id,body);}
 @Delete('businesses/:id') removeBusiness(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.service.remove(r.actorId,id,body);}
 @Get('businesses/:id') resolve(@Req() r:AuthRequest,@Param('id') id:string){return this.service.resolve(r.actorId,id);}
}

@Controller('api/v1/businesses/:id')
@UseGuards(SessionGuard)
class VideoController {
 constructor(@Inject(VideoCanvas) private readonly service:VideoCanvas){}
 @Get('video-jobs/:jobId/draft') draft(@Req() r:AuthRequest,@Param('id') id:string,@Param('jobId') j:string){return this.service.draft(r.actorId,id,j);}
 @Post('video-jobs/:jobId/draft') saveDraft(@Req() r:AuthRequest,@Param('id') id:string,@Param('jobId') j:string,@Body() body:unknown){return this.service.saveDraft(r.actorId,id,j,body);}
 @Post('video-versions/:versionId/regenerate') regenerate(@Req() r:AuthRequest,@Param('id') id:string,@Param('versionId') v:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.regenerate(r.actorId,id,v,body,key);}
 @Post('video-jobs/:jobId/cancel') cancel(@Req() r:AuthRequest,@Param('id') id:string,@Param('jobId') j:string){return this.service.cancel(r.actorId,id,j);}
 @Get('videos') list(@Req() r:AuthRequest,@Param('id') id:string){return this.service.list(r.actorId,id);}
 @Post('canvas/threads/:threadId/videos') submit(@Req() r:AuthRequest,@Param('id') id:string,@Param('threadId') t:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.submit(r.actorId,id,t,body,key);}
 @Get('video-versions/:versionId') version(@Req() r:AuthRequest,@Param('id') id:string,@Param('versionId') v:string){return this.service.version(r.actorId,id,v);}
 @Get('video-versions/:versionId/download') download(@Req() r:AuthRequest,@Param('id') id:string,@Param('versionId') v:string){return this.service.download(r.actorId,id,v);}
 @Get('video-versions/:versionId/poster') poster(@Req() r:AuthRequest,@Param('id') id:string,@Param('versionId') v:string){return this.service.download(r.actorId,id,v,true);}
 @Post('video-versions/:versionId/review') review(@Req() r:AuthRequest,@Param('id') id:string,@Param('versionId') v:string,@Body() body:unknown){return this.service.review(r.actorId,id,v,body);}
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
 @Get('content-plan/loops') loops(@Req() r:AuthRequest,@Param('id') id:string){return this.planning.loops(r.actorId,id);}
 @Post('content-plan/loops/:loopId/stop') stopLoop(@Req() r:AuthRequest,@Param('id') id:string,@Param('loopId') loop:string){return this.planning.stopLoop(r.actorId,id,loop);}
 @Post('content-plan/generate') generate(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.planning.submit(r.actorId,id,body,key);}
 @Get('content-plan/jobs') jobs(@Req() r:AuthRequest,@Param('id') id:string){return this.planning.jobs(r.actorId,id);}
 @Get('content-plans') catalog(@Req() r:AuthRequest,@Param('id') id:string){return this.service.catalog(r.actorId,id);}
 @Post('content-plans/:planId/posts') addPost(@Req() r:AuthRequest,@Param('id') id:string,@Param('planId') p:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.addPost(r.actorId,id,p,body,key);}
 @Post('content-plans/:planId/carousels') addCarousel(@Req() r:AuthRequest,@Param('id') id:string,@Param('planId') p:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.addCarousel(r.actorId,id,p,body,key);}
 @Post('content-plans/:planId/videos') addVideo(@Req() r:AuthRequest,@Param('id') id:string,@Param('planId') p:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.addVideo(r.actorId,id,p,body,key);}
 @Get('content-plans/:planId/ideas') ideas(@Req() r:AuthRequest,@Param('id') id:string,@Param('planId') p:string,@Query() query:unknown){return new CampaignIdeas(this.planning).latest(r.actorId,id,p,query);}
 @Post('content-plans/:planId/ideas') generateIdeas(@Req() r:AuthRequest,@Param('id') id:string,@Param('planId') p:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return new CampaignIdeas(this.planning).generate(r.actorId,id,p,body,key);}
 @Get('content-plans/:planId') detail(@Req() r:AuthRequest,@Param('id') id:string,@Param('planId') p:string){return this.planning.detail(r.actorId,id,p);}
 @Post('planning-jobs/:jobId/cancel') cancel(@Req() r:AuthRequest,@Param('id') id:string,@Param('jobId') j:string){return this.planning.cancel(r.actorId,id,j);}
 @Post('content-plans') create(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.service.create(r.actorId,id,body,key);}
 @Get('content-plan/export') export(@Req() r:AuthRequest,@Param('id') id:string,@Query() query:unknown){return this.service.export(r.actorId,id,query);}
 @Get('content-archive') archive(@Req() r:AuthRequest,@Param('id') id:string,@Query() query:unknown){return this.service.archive(r.actorId,id,query);}
 @Post('content-slots/:slotId/restore') restore(@Req() r:AuthRequest,@Param('id') id:string,@Param('slotId') slot:string,@Body() body:unknown){return this.service.restore(r.actorId,id,slot,body);}
 @Get('content-plan') list(@Req() r:AuthRequest,@Param('id') id:string,@Query() query:unknown){return this.service.list(r.actorId,id,query);}
 @Get('review-inbox') inbox(@Req() r:AuthRequest,@Param('id') id:string,@Query() query:unknown){return this.service.list(r.actorId,id,query,true);}
 @Get('content-slots/:slotId') slot(@Req() r:AuthRequest,@Param('id') id:string,@Param('slotId') slot:string){return this.creatives.detail(r.actorId,id,slot);}
 @Get('content-plans/:planId/image-batch') imageBatch(@Req() r:AuthRequest,@Param('id') id:string,@Param('planId') plan:string){return this.creatives.batchStatus(r.actorId,id,plan);}
 @Post('content-plans/:planId/generate-images') batchImages(@Req() r:AuthRequest,@Param('id') id:string,@Param('planId') plan:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.creatives.generateBatch(r.actorId,id,plan,body,key);}
 @Post('content-slots/:slotId/generate-creative') creative(@Req() r:AuthRequest,@Param('id') id:string,@Param('slotId') slot:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.creatives.generate(r.actorId,id,slot,body,key);}
 @Patch('content-slots/:slotId') edit(@Req() r:AuthRequest,@Param('id') id:string,@Param('slotId') slot:string,@Body() body:unknown){return this.service.edit(r.actorId,id,slot,body);}
 @Get('content-slots/:slotId/history') history(@Req() r:AuthRequest,@Param('id') id:string,@Param('slotId') slot:string){return this.service.history(r.actorId,id,slot);}
 @Post('reviews/bulk-submit') submitReview(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.service.bulkSubmit(r.actorId,id,body);}
 @Post('reviews/bulk-approve') bulk(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.service.bulkApprove(r.actorId,id,body);}
 @Post('reviews/:slotId') review(@Req() r:AuthRequest,@Param('id') id:string,@Param('slotId') slot:string,@Body() body:unknown){return this.service.review(r.actorId,id,slot,body);}
}

@Controller('api/v1/businesses/:id')
@UseGuards(SessionGuard)
class CanvasController {
 constructor(@Inject(Canvas) private readonly service:Canvas,@Inject(ChatConversations) private readonly chat:ChatConversations){}
 @Get('create-chat/outbox') chatOutbox(@Req() r:AuthRequest,@Param('id') id:string){return this.chat.outbox(r.actorId,id);}
 @Put('create-chat/outbox') saveChatOutbox(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.chat.saveOutbox(r.actorId,id,body);}
 @Post('create-chat/outbox/:key/discard') discardChat(@Req() r:AuthRequest,@Param('id') id:string,@Param('key') key:string){return this.chat.discard(r.actorId,id,key);}
 @Post('create-chat/outbox/:key/acknowledge') acknowledgeChat(@Req() r:AuthRequest,@Param('id') id:string,@Param('key') key:string){return this.chat.acknowledge(r.actorId,id,key);}
 @Get('create-chat/history') history(@Req() r:AuthRequest,@Param('id') id:string,@Query('q') q?:string){return this.chat.list(r.actorId,id,q);}
 @Get('create-chat/conversations/:conversationId') conversation(@Req() r:AuthRequest,@Param('id') id:string,@Param('conversationId') c:string){return this.chat.read(r.actorId,id,c);}
 @Post('create-chat/messages') chatMessage(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:unknown){return this.chat.submit(r.actorId,id,body,key);}
 @Post('create-chat/turns/:turnId/execute') chatExecute(@Req() r:AuthRequest,@Param('id') id:string,@Param('turnId') t:string){return this.chat.execute(r.actorId,id,t);}
 @Get('create-chat/draft') createDraft(@Req() r:AuthRequest,@Param('id') id:string){return this.service.createDraft(r.actorId,id);}
 @Put('create-chat/draft') saveCreateDraft(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.service.saveCreateDraft(r.actorId,id,body);}
 @Get('canvas/allowances') allowances(@Req() r:AuthRequest,@Param('id') id:string){return this.service.allowances(r.actorId,id);}
 @Get('canvas/references') references(@Req() r:AuthRequest,@Param('id') id:string){return this.service.references(r.actorId,id);}
 @Post('canvas/references') approveReference(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.service.approveReference(r.actorId,id,body);}
 @Post('canvas/references/:referenceId/revoke') revokeReference(@Req() r:AuthRequest,@Param('id') id:string,@Param('referenceId') ref:string){return this.service.revokeReference(r.actorId,id,ref);}
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
  @Get(':org/generation-usage') generationUsage(@Req() req:AuthRequest,@Param('org') org:string){return this.service.generationUsage(req.actorId,org);}
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
 @Patch('visuals') reviewVisual(@Req() r:AuthRequest,@Param('org') o:string,@Param('brand') b:string,@Body() body:unknown){return this.brain.reviewVisual(r.actorId,o,b,body);}
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
    const mail=new MailQueue(config.origin,config.mailEncryptionKey,!!config.smtp),mailWorker=new MailWorker(mailPool,mail,config);
    await mailWorker.assertRole();
    const auth = createAuth(authPool, config,mail), workspaces = new Workspaces(database),team=new Team(database,mail,config.origin);
    const server = express();
    server.disable('x-powered-by');
    server.use((req: Request, res: Response, next: NextFunction) => {
      (req as AuthRequest).traceId = randomUUID();
      req.headers['x-desvio-trace-id']=(req as AuthRequest).traceId;
      req.headers['x-desvio-peer-ip'] = resolveIngressAddress(req.headers,req.socket.remoteAddress ?? '127.0.0.1',req.method,req.path,config.authIngressSecret);
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
      if(request.method==='POST'&&new URL(request.url).pathname==='/api/auth/update-user'){
        let body:any;try{body=await request.clone().json();}catch{return globalThis.Response.json({error:'Enter your name'},{status:400});}
        if(!body||Array.isArray(body)||Object.keys(body).some(k=>k!=='name')||typeof body.name!=='string'||body.name!==body.name.trim()||!body.name||body.name.length>120||/[\u0000-\u001f\u007f]/.test(body.name))return globalThis.Response.json({error:'Enter a name of 1–120 characters'},{status:400});
      }
      try {const response=await auth.handler(request);return response.status>=500?unavailable():response;}
      catch {return unavailable();}
    }));
    @Module({ controllers: [CampaignBlogsController,PostformeReturnController,PostformeController,HiggsfieldReplacementsController,StrategiesController,StandaloneGenerationNotificationsController,StockMediaController,GenerationNotificationsController,ProjectArchiveController,CarouselGenerationController,CarouselsController,InsightsController,AnalyticsController,VideoController,PublicationController,SocialController,ExportController,WorkspaceController,InvitationController,AssetController,BrainController,BusinessController,CanvasController,ContentPlanController], providers: [SessionGuard,
 {provide:ChatConversations,useFactory:(canvas:Canvas,planning:Planning)=>new ChatConversations(canvas,planning),inject:[Canvas,Planning]},
 {provide:CampaignBlogs,useValue:new CampaignBlogs(new ContentPlan(new Businesses(database,workspaces),config.renderImage),new CreativeProvider(config.openaiApiKey))},
 {provide:Strategies,useValue:new Strategies(new Planning(new ContentPlan(new Businesses(database,workspaces),config.renderImage)),new SlotCreatives(new ContentPlan(new Businesses(database,workspaces),config.renderImage),new Canvas(new Businesses(database,workspaces),store),new CarouselGeneration(new Canvas(new Businesses(database,workspaces),store),config.renderImage)))},
 {provide:HiggsfieldReplacements,useFactory:(canvas:Canvas)=>new HiggsfieldReplacements(canvas,config.higgsfieldImagesEnabled),inject:[Canvas]},
 {provide:StockMedia,useValue:new StockMedia(new Businesses(database,workspaces),new Assets(database,store),new StockProvider(config.pexelsApiKey))},
 {provide:GenerationNotifications,useValue:new GenerationNotifications(new ContentPlan(new Businesses(database,workspaces),config.renderImage),mail)},
 {provide:ProjectArchive,useValue:new ProjectArchive(new Canvas(new Businesses(database,workspaces),store))},
 {provide:VideoCanvas,useFactory:()=>{const canvas=new Canvas(new Businesses(database,workspaces),store);return new VideoCanvas(canvas,new VideoReferenceBindings(canvas,config.renderImage),config.videoEnabled===true);}},
      {provide:CarouselGeneration,useValue:new CarouselGeneration(new Canvas(new Businesses(database,workspaces),store),config.renderImage)},
      {provide:Carousels,useValue:new Carousels(new Canvas(new Businesses(database,workspaces),store),config.renderImage)},
      {provide:Insights,useValue:new Insights(new ContentPlan(new Businesses(database,workspaces),config.renderImage))},{provide:BusinessOverview,useValue:new BusinessOverview(new Businesses(database,workspaces))},{provide:Postforme,useValue:new Postforme(new SocialConnections(new Businesses(database,workspaces),true),new Publication(new SocialConnections(new Businesses(database,workspaces),true),new CreativeExports(new Canvas(new Businesses(database,workspaces),store),config.renderImage),true,config.videoRenderImage),config.postformeApiKey,config.postformePublishingEnabled===true)},{provide:Publication,useValue:new Publication(new SocialConnections(new Businesses(database,workspaces),config.socialEnabled===true),new CreativeExports(new Canvas(new Businesses(database,workspaces),store),config.renderImage),config.publishingEnabled===true,config.videoRenderImage)},{provide:SocialProvisioning,useValue:new SocialProvisioning(new SocialConnections(new Businesses(database,workspaces),config.socialEnabled===true),config.socialProvisioningEnabled===true)},{provide:SocialOAuth,useValue:new SocialOAuth(new SocialConnections(new Businesses(database,workspaces),config.socialEnabled===true),config.socialAuthorizationEnabled===true?config.oauthEncryptionKey:undefined)},{provide:SocialConnections,useValue:new SocialConnections(new Businesses(database,workspaces),config.socialEnabled===true,{provisioning:config.socialProvisioningEnabled===true,authorization:config.socialAuthorizationEnabled===true&&!!config.oauthEncryptionKey})},{ provide: AUTH, useValue: auth }, { provide: Workspaces, useValue: workspaces },{provide:Team,useValue:team},{provide:Assets,useValue:new Assets(database,store)},{provide:BrandBrain,useValue:new BrandBrain(database)},{provide:Businesses,useValue:new Businesses(database,workspaces)},{provide:CreativeExports,useValue:new CreativeExports(new Canvas(new Businesses(database,workspaces),store),config.renderImage)},{provide:SlotCreatives,useValue:new SlotCreatives(new ContentPlan(new Businesses(database,workspaces),config.renderImage),new Canvas(new Businesses(database,workspaces),store),new CarouselGeneration(new Canvas(new Businesses(database,workspaces),store),config.renderImage))},{provide:Planning,useValue:new Planning(new ContentPlan(new Businesses(database,workspaces),config.renderImage))},{provide:ContentPlan,useValue:new ContentPlan(new Businesses(database,workspaces),config.renderImage)},{provide:Canvas,useValue:new Canvas(new Businesses(database,workspaces),store)},{provide:Intake,useValue:new Intake(new Businesses(database,workspaces),store)}] })
    class AppModule {}
    const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { bodyParser: false, logger: false });
    app.useGlobalFilters(new SafeErrors());
    await app.init();
    return { app, database, auth,mailWorker,chatWorker:new ChatActionWorker(mailPool,app.get(ChatConversations)), async close() { await app.close();mailWorker.close();store.close(); await Promise.all([pool.end(), authPool.end(),mailPool.end()]); } };
  } catch (error) { store.close();await Promise.all([pool.end(), authPool.end(),mailPool.end()]); throw error; }
}
