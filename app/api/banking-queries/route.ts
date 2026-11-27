import { z } from 'zod';
import { db, fail, guard, rateLimit, readJson, HttpError, now, uid, identity } from '@/lib/server';
import { superAdmin, requireAdminMFA } from '@/lib/platform';

export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});

// Self-heal the Banking Queries schema and seed the initial Italy questions.
// This is intentionally idempotent: it works even when a D1 migration was not
// applied, and it never overwrites questions an administrator has edited.
async function ensureBankingQueries(){
 const database=db();
 await database.prepare(`CREATE TABLE IF NOT EXISTS banking_queries (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published')),
  helpful_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
 )`).run();
 await database.prepare('CREATE INDEX IF NOT EXISTS banking_queries_published_sort ON banking_queries(status,sort_order,updated_at)').run();
 await database.prepare(`CREATE TABLE IF NOT EXISTS banking_query_helpful (
  query_id TEXT NOT NULL REFERENCES banking_queries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(query_id,user_id)
 )`).run();
 await database.prepare('CREATE INDEX IF NOT EXISTS banking_query_helpful_user ON banking_query_helpful(user_id,created_at)').run();
 const stamp=now();
 const seeds=[
  ['9f8c1a20-4c7d-4b31-9e62-11a000000001','ইতালির স্টুডেন্ট ভিসার জন্য কত মাসের ব্যাংক স্টেটমেন্ট প্রয়োজন?','Bank Statement','ইতালির স্টুডেন্ট ভিসার আবেদনের জন্য কত মাসের ব্যাংক স্টেটমেন্ট জমা দিতে হয়?','আবেদনকারী (Applicant) ও আর্থিক স্পন্সরের (Sponsor) গত ১২ মাসের ব্যাংক স্টেটমেন্ট প্রস্তুত রাখুন। এতে নিয়মিত লেনদেন, বর্তমান ব্যালেন্স এবং অর্থের উৎস বোঝানো সহজ হয়। জমা দেওয়ার আগে সংশ্লিষ্ট ইতালীয় দূতাবাস বা ভিসা সেন্টারের সর্বশেষ চেকলিস্ট যাচাই করুন।',10],
  ['9f8c1a20-4c7d-4b31-9e62-11a000000002','ইতালির স্টুডেন্ট ভিসার জন্য কার কার ব্যাংক স্টেটমেন্ট প্রয়োজন?','Bank Statement','শুধু স্পন্সরের, নাকি আবেদনকারীর নিজের ব্যাংক স্টেটমেন্টও প্রয়োজন?','Applicant ও Sponsor—দুজনের ব্যাংক স্টেটমেন্ট প্রস্তুত রাখুন। স্পন্সর খরচ বহন করলে তাঁর আয়ের প্রমাণ, পরিচয়পত্র, আবেদনকারীর সঙ্গে সম্পর্কের প্রমাণ এবং প্রয়োজনীয় sponsorship/consent documents-ও প্রস্তুত রাখুন। চূড়ান্ত ডকুমেন্ট তালিকা দূতাবাসের নির্দেশনা অনুযায়ী মিলিয়ে নিন।',20],
  ['9f8c1a20-4c7d-4b31-9e62-11a000000003','ইতালির স্টুডেন্ট ভিসার জন্য কোন ব্যাংকের অ্যাকাউন্ট ব্যবহার করা যাবে?','Bank Account','বাংলাদেশের নির্দিষ্ট কোনো ব্যাংকে অ্যাকাউন্ট থাকতে হবে, নাকি যেকোনো ব্যাংকের স্টেটমেন্ট দেওয়া যাবে?','বাংলাদেশ ব্যাংকের অনুমোদিত ও নিয়ন্ত্রণাধীন যেকোনো ব্যাংকের অ্যাকাউন্ট ব্যবহার করতে পারবেন। নির্দিষ্ট কোনো ব্যাংক বাধ্যতামূলক—এমন সাধারণ নিয়ম নেই। ব্যাংক স্টেটমেন্ট আসল, যাচাইযোগ্য এবং প্রয়োজনীয় তথ্যসহ হতে হবে। সর্বশেষ দূতাবাসের নির্দেশনা যাচাই করুন।',30],
  ['9f8c1a20-4c7d-4b31-9e62-11a000000004','ইতালির ভিসার জন্য কত টাকা প্রয়োজন?','Proof of Funds','ব্যাংক অ্যাকাউন্টে কত টাকা রাখা উচিত?','পরিকল্পনার জন্য প্রায় €10,500 বা তার বেশি সমপরিমাণ অর্থ প্রস্তুত রাখতে পারেন। এটি নির্দিষ্ট সরকারি ন্যূনতম অঙ্ক নয়—সর্বশেষ দূতাবাসের নির্দেশনা যাচাই করবেন। Savings Account-এ পর্যাপ্ত Liquid Money রাখুন এবং অর্থের বৈধ উৎসের প্রমাণ রাখুন। ধার করা বা সাময়িকভাবে জোগাড় করা টাকা দেখাবেন না।',40]
 ] as const;
 for(const [id,title,topic,question,answer,sortOrder] of seeds){
  await database.prepare(`INSERT OR IGNORE INTO banking_queries
   (id,title,topic,question,answer,status,helpful_count,sort_order,created_by,created_at,updated_at)
   VALUES(?,?,?,?,?,'published',0,?,'system',?,?)`)
   .bind(id,title,topic,question,answer,sortOrder,stamp,stamp).run();
 }
 // Update only the original seeded answer when it still contains the outdated
 // deposit-account wording; leave any administrator-edited answer untouched.
 await database.prepare(`UPDATE banking_queries SET
  title=?, question=?, answer=?, updated_at=?
  WHERE id=? AND answer LIKE '%পরিকল্পনার জন্য প্রায় €10,500 বা তার বেশি সমপরিমাণ অর্থের লক্ষ্য রাখতে পারেন.%'`)
  .bind('ইতালির ভিসার জন্য কত টাকা প্রয়োজন?','ব্যাংক অ্যাকাউন্টে কত টাকা রাখা উচিত?','পরিকল্পনার জন্য প্রায় €10,500 বা তার বেশি সমপরিমাণ অর্থ প্রস্তুত রাখতে পারেন। এটি নির্দিষ্ট সরকারি ন্যূনতম অঙ্ক নয়—সর্বশেষ দূতাবাসের নির্দেশনা যাচাই করবেন। Savings Account-এ পর্যাপ্ত Liquid Money রাখুন এবং অর্থের বৈধ উৎসের প্রমাণ রাখুন। ধার করা বা সাময়িকভাবে জোগাড় করা টাকা দেখাবেন না।',stamp,'9f8c1a20-4c7d-4b31-9e62-11a000000004').run();
}
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
  await ensureBankingQueries();
  const isAdmin=await superAdmin().then(()=>true).catch(()=>false);
  const rows=await db().prepare(`SELECT q.id,q.title,q.topic,q.question,q.answer,q.status,q.helpful_count,q.sort_order,q.created_at,q.updated_at,
    CASE WHEN h.user_id IS NULL THEN 0 ELSE 1 END AS helpful_by_me
    FROM banking_queries q LEFT JOIN banking_query_helpful h ON h.query_id=q.id AND h.user_id=?
    ${isAdmin?'':"WHERE q.status='published'"}
    ORDER BY q.sort_order,q.updated_at DESC`).bind(user.userId).all();
  return json({ok:true,isAdmin,items:rows.results});
 }catch(error){return fail(error)}
}

export async function POST(request:Request){
 try{
  guard(request);
  const input=schema.parse(await readJson(request,36000));
  const user=await identity();
  await ensureBankingQueries();
  if(input.action==='helpful'){
   const id=z.string().uuid().parse(input.id);
   await rateLimit(user.userId,'banking-query-helpful',60);
   const result=await db().prepare(`INSERT OR IGNORE INTO banking_query_helpful(query_id,user_id,created_at)
     SELECT id,?,? FROM banking_queries WHERE id=? AND status='published'`).bind(user.userId,now(),id).run();
   if(result.meta.changes)await db().prepare('UPDATE banking_queries SET helpful_count=helpful_count+1 WHERE id=?').bind(id).run();
   const row=await db().prepare("SELECT helpful_count FROM banking_queries WHERE id=? AND status='published'").bind(id).first<{helpful_count:number}|null>();
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
