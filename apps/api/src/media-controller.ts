import {BadRequestException,Controller,Get,Inject,Param,Query,Req,Res,UseGuards,type CanActivate,type Type} from '@nestjs/common';
import type {IncomingHttpHeaders} from 'node:http';
import {MediaLibrary} from './media-library.js';
import {PREVIEW_CACHE_CONTROL,previewWidth,type MediaKind} from './media-variants.js';

type MediaRequest={actorId:string;headers:IncomingHttpHeaders};
type MediaResponse={setHeader(name:string,value:string|number):unknown;status(code:number):{end(body?:Buffer):unknown}};

/** Preview routes for private media. Built around the application's own session guard so this
 * module never defines a second way to authenticate. Only successful replies are cacheable:
 * errors keep the API-wide `no-store`. */
export function createMediaController(guard:Type<CanActivate>):Type<unknown>{
 @Controller('api/v1/businesses/:id')
 @UseGuards(guard)
 class MediaController {
  constructor(@Inject(MediaLibrary) private readonly media:MediaLibrary){}
  @Get('creative-media/:ref/preview') creative(@Req() r:MediaRequest,@Res() res:MediaResponse,@Param('id') id:string,@Param('ref') ref:string,@Query('w') w:unknown):Promise<void>{return this.send(r,res,id,'creative',ref,w);}
  @Get('creative-exports/:ref/preview') exported(@Req() r:MediaRequest,@Res() res:MediaResponse,@Param('id') id:string,@Param('ref') ref:string,@Query('w') w:unknown):Promise<void>{return this.send(r,res,id,'export',ref,w);}
  @Get('video-versions/:ref/poster/preview') poster(@Req() r:MediaRequest,@Res() res:MediaResponse,@Param('id') id:string,@Param('ref') ref:string,@Query('w') w:unknown):Promise<void>{return this.send(r,res,id,'poster',ref,w);}
  @Get('carousel-versions/:ref/cover') cover(@Req() r:MediaRequest,@Res() res:MediaResponse,@Param('id') id:string,@Param('ref') ref:string,@Query('w') w:unknown):Promise<void>{return this.send(r,res,id,'cover',ref,w);}
  private async send(r:MediaRequest,res:MediaResponse,business:string,kind:MediaKind,ref:string,w:unknown):Promise<void>{
   try{previewWidth(w);}catch{throw new BadRequestException('Invalid preview width');}
   const validator=r.headers['if-none-match'];
   const reply=await this.media.preview(r.actorId,business,{kind,id:ref},w,typeof validator==='string'?validator:undefined);
   res.setHeader('Cache-Control',PREVIEW_CACHE_CONTROL);
   res.setHeader('ETag',reply.etag);
   res.setHeader('Cross-Origin-Resource-Policy','same-origin');
   if(reply.status===304){res.status(304).end();return;}
   res.setHeader('Content-Type','image/webp');
   res.setHeader('Content-Length',reply.bytes.length);
   res.setHeader('Content-Disposition','inline');
   res.status(200).end(reply.bytes);
  }
 }
 return MediaController;
}
