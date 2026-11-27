import { z } from 'zod';
import { db, fail, guard, rateLimit, readJson, HttpError, now, uid, identity } from '@/lib/server';
import { superAdmin, requireAdminMFA } from '@/lib/platform';

export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const schema=z.object({
 action:z.enum(['create','update','delete','helpful']),
 id:z.string().optional(),
 title:z.string().trim().min(3).max(180).optional(),
 topic:z.string().max(100).optional(),
 question:z.string().trim().min(5).max(12000).optional(),
 answer:z.string().trim().min(2).max(20000).optional(),
 status:z.enum(['draft','published']).optional(),
 sortOrder:z.number().int().min(-10000).max(10000).optional()
}).strict();

export async function GET(){
 try{
  const user=await identity();
  const isAdmin=await superAdmin().then(()=>true).catch(()=>false);
  const rows=await db().prepare(`SELECT q.id,q.title,q.topic,q.question,q.answer,q.status,q.helpful_count,q.sort_order,q.created_at,q.updated_at,
    CASE WHEN h.user_id IS NULL THEN 0 ELSE 1 END AS helpful_by_me
    FROM banking_queries q LEFT JOIN banking_query_helpful h ON h.query_id=q.id AND h.user_id=?
    ${isAdmin?'':'WHERE q.status=\'published\''}
    ORDER BY q.sort_order,q.updated_at DESC`).bind(user.userId).all();
  return json({ok:true,isAdmin,items:rows.results});
 }catch(error){return fail(error)}
}

export async function POST(request:Request){
 try{
  guard(request);
  const input=schema.parse(await readJson(request,36000));
  const user=await identity();
  if(input.action==='helpful'){
   const id=z.string().uuid().parse(input.id);
   await rateLimit(user.userId,'banking-query-helpful',60);
   const result=await db().prepare(`INSERT OR IGNORE INTO banking_query_helpful(query_id,user_id,created_at)
     SELECT id,?,? FROM banking_queries WHERE id=? AND status='published'`).bind(user.userId,now(),id).run();
   if(result.meta.changes)await db().prepare('UPDATE banking_queries SET helpful_count=helpful_count+1 WHERE id=?').bind(id).run();
   const row=await db().prepare('SELECT helpful_count FROM banking_queries WHERE id=? AND status=\'published\'').bind(id).first() as {helpful_count:number}|null;
   if(!row)throw new HttpError(404,'Query not found');
   return json({ok:true,helpfulCount:row.helpful_count,added:Boolean(result.meta.changes)});
  }
  const admin=await superAdmin();
  await rateLimit(admin.userId,'banking-queries-admin-write',40);
  await requireAdminMFA();
  const database=db(),stamp=now();
  if(input.action==='delete'){
   const id=z.string().uuid().parse(input.id);
   const result=await database.prepare('DELETE FROM banking_queries WHERE id=?').bind(id).run();
   if(!result.meta.changes)throw new HttpError(404,'Banking Query not found');
   await database.prepare('INSERT INTO platform_audit(id,actor,target,action,reason,created) VALUES(?,?,?,?,?,?)').bind(uid(),admin.userId,id,'banking_query.delete','Admin deleted Banking Query '+id,stamp).run();
   return json({ok:true});
  }
  const title=z.string().trim().min(3).max(180).parse(input.title);
  const question=z.string().trim().min(5).max(12000).parse(input.question);
  const answer=z.string().trim().min(2).max(20000).parse(input.answer);
  const topic=(input.topic||'').trim(),status=input.status||'published',sortOrder=input.sortOrder||0;
  if(input.action==='create'){
   const id=uid();
   await database.prepare('INSERT INTO banking_queries(id,title,topic,question,answer,status,helpful_count,sort_order,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?,?,?)').bind(id,title,topic,question,answer,status,sortOrder,admin.userId,stamp,stamp).run();
   await database.prepare('INSERT INTO platform_audit(id,actor,target,action,reason,created) VALUES(?,?,?,?,?,?)').bind(uid(),admin.userId,id,'banking_query.create',topic+': '+title,stamp).run();
   return json({ok:true,id});
  }
  const id=z.string().uuid().parse(input.id);
  const result=await database.prepare('UPDATE banking_queries SET title=?,topic=?,question=?,answer=?,status=?,sort_order=?,updated_at=? WHERE id=?').bind(title,topic,question,answer,status,sortOrder,stamp,id).run();
  if(!result.meta.changes)throw new HttpError(404,'Banking Query not found');
  await database.prepare('INSERT INTO platform_audit(id,actor,target,action,reason,created) VALUES(?,?,?,?,?,?)').bind(uid(),admin.userId,id,'banking_query.update',topic+': '+title,stamp).run();
  return json({ok:true,id});
 }catch(error){if(error instanceof z.ZodError)return fail(new HttpError(400,'Check the Banking Queries form values'));return fail(error)}
}
