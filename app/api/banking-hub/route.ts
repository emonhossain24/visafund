import { z } from 'zod';
import { db, fail, guard, rateLimit, readJson, HttpError, now, uid } from '@/lib/server';
import { identity } from '@/lib/server';
import { superAdmin, requireAdminMFA } from '@/lib/platform';

export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const kinds=['event','premium','advisor','resource','country'] as const;
const schema=z.object({
 action:z.enum(['create','update','delete']),
 id:z.string().optional(),
 kind:z.enum(kinds).optional(),
 title:z.string().trim().min(3).max(140).optional(),
 summary:z.string().max(500).optional(),
 body:z.string().max(12000).optional(),
 category:z.string().max(80).optional(),
 country:z.string().max(80).optional(),
 platform:z.string().max(80).optional(),
 meetingUrl:z.string().max(1000).optional(),
 venue:z.string().max(300).optional(),
 startsAt:z.string().max(50).nullable().optional(),
 timezone:z.string().max(80).optional(),
 durationMinutes:z.number().int().min(15).max(240).nullable().optional(),
 feeAmount:z.number().int().min(0).max(1000000).nullable().optional(),
 feeCurrency:z.string().max(8).optional(),
 status:z.enum(['draft','published','archived']).optional(),
 accessLevel:z.enum(['public','locked']).optional(),
 sortOrder:z.number().int().min(-10000).max(10000).optional()
}).strict();

export async function GET(request:Request){
 try{
  const params=new URL(request.url).searchParams;
  const user=await identity();
  const isAdmin=await superAdmin().then(()=>true).catch(()=>false);
  if(isAdmin) await requireAdminMFA();
  const kind=params.get('kind');
  if(isAdmin){
   const rows=kind
    ? await db().prepare('SELECT * FROM banking_hub_content WHERE kind=? ORDER BY sort_order,updated_at DESC').bind(kind).all()
    : await db().prepare('SELECT * FROM banking_hub_content ORDER BY kind,sort_order,updated_at DESC').all();
   return json({locked:false,isAdmin:true,items:rows.results});
  }
  if(kind&&kind!=='event')return json({locked:true,isAdmin:false,items:[]});
  const rows=await db().prepare("SELECT id,kind,title,summary,body,category,country,platform,meeting_url,venue,starts_at,timezone,duration_minutes,status,access_level,sort_order,created_at,updated_at FROM banking_hub_content WHERE kind='event' AND status='published' AND access_level='public' AND (starts_at IS NULL OR starts_at>=?) ORDER BY starts_at,sort_order LIMIT 100").bind(now()).all();
  return json({locked:false,isAdmin:false,items:rows.results});
 }catch(error){return fail(error)}
}
export async function POST(request:Request){
 try{
  guard(request);const user=await superAdmin();await rateLimit(user.userId,'banking-hub-admin-write',40);await requireAdminMFA();
  const input=schema.parse(await readJson(request,16000));const stamp=now();const database=db();
  if(input.action==='delete'){
   const id=z.string().uuid().parse(input.id);
   const result=await database.prepare('DELETE FROM banking_hub_content WHERE id=?').bind(id).run();
   if(!result.meta.changes)throw new HttpError(404,'Content not found');
   await database.prepare('INSERT INTO platform_audit(id,actor,target,action,reason,created) VALUES(?,?,?,?,?,?)').bind(uid(),user.userId,id,'banking_hub.delete','Admin deleted '+id,stamp).run();
   return json({ok:true});
  }
  const kind=z.enum(kinds).parse(input.kind);
  const title=z.string().trim().min(3).max(140).parse(input.title);
  const summary=(input.summary||'').trim();const body=(input.body||'').trim();
  const status=input.status||'draft';
  const accessLevel=kind==='event'?(input.accessLevel||'public'):'locked';
  const values=[kind,title,summary,body,input.category||'',input.country||'',input.platform||'',input.meetingUrl||'',input.venue||'',input.startsAt||null,input.timezone||'Asia/Dhaka',input.durationMinutes??null,input.feeAmount??null,input.feeCurrency||'BDT',status,accessLevel,input.sortOrder||0,stamp];
  if(input.action==='create'){
   const id=uid();
   await database.prepare('INSERT INTO banking_hub_content(id,kind,title,summary,body,category,country,platform,meeting_url,venue,starts_at,timezone,duration_minutes,fee_amount,fee_currency,status,access_level,sort_order,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,...values.slice(0,17),user.userId,stamp,stamp).run();
   await database.prepare('INSERT INTO platform_audit(id,actor,target,action,reason,created) VALUES(?,?,?,?,?,?)').bind(uid(),user.userId,id,'banking_hub.create',kind+': '+title,stamp).run();
   return json({ok:true,id});
  }
  const id=z.string().uuid().parse(input.id);
  const result=await database.prepare('UPDATE banking_hub_content SET kind=?,title=?,summary=?,body=?,category=?,country=?,platform=?,meeting_url=?,venue=?,starts_at=?,timezone=?,duration_minutes=?,fee_amount=?,fee_currency=?,status=?,access_level=?,sort_order=?,updated_at=? WHERE id=?').bind(...values,id).run();
  if(!result.meta.changes)throw new HttpError(404,'Content not found');
  await database.prepare('INSERT INTO platform_audit(id,actor,target,action,reason,created) VALUES(?,?,?,?,?,?)').bind(uid(),user.userId,id,'banking_hub.update',kind+': '+title,stamp).run();
  return json({ok:true,id});
 }catch(error){if(error instanceof z.ZodError)return fail(new HttpError(400,'Check the Banking Hub form values'));return fail(error)}
}
