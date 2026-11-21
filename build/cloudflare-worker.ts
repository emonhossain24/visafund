import handler from "vinext/server/fetch-handler";
import {banInactiveUsers} from '../lib/inactivity';
import {cleanupCommunity} from '../lib/community-cleanup';
// External requests never carry trusted ChatGPT identity. The Sites dispatcher
// is absent here: discard its identity headers before the application sees them.
export default {fetch(request:Request,env:Cloudflare.Env,ctx:ExecutionContext){
 const headers=new Headers(request.headers);
 for(const name of [...headers.keys()])if(name.startsWith("oai-"))headers.delete(name);
 const safeRequest=new Request(request,{headers});
 return handler.fetch(safeRequest,env,ctx);
},
 async scheduled(controller:ScheduledController,env:Cloudflare.Env){
  const database=env.DB;
  if(!database)throw new Error('Cloudflare D1 binding DB is unavailable during scheduled maintenance.');
  const banned=controller.cron==='0 3 * * *'?await banInactiveUsers(database):0;
  const cleanup=await cleanupCommunity(database);
  console.log('VisaFund scheduled maintenance finished',{banned,...cleanup});
 }
};
