import {ForbiddenException} from '@nestjs/common';
import {Businesses} from './businesses.js';
/** Business-scoped transactions for social work. Connections themselves live in Post for Me (postforme.ts). */
export class SocialConnections {
 constructor(readonly businesses:Businesses,readonly enabled=true){}
 async scope<T>(user:string,id:string,write:boolean,action:(db:any,b:any)=>Promise<T>){const b=await this.businesses.resolve(user,id);return this.businesses.database.transaction(user,b.organization_id,write,async db=>{if(write&&!(await db.query('SELECT app.social_manager($1,$2) AS allowed',[b.organization_id,id])).rows[0].allowed)throw new ForbiddenException('Only a business owner or administrator can manage social connections');return action(db,b);},id);}
}
