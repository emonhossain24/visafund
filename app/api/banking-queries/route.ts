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
 // A table may already exist from a partially applied older migration. CREATE IF
 // NOT EXISTS does not repair it, so add any missing non-key columns before indexes.
 const queryColumns=[
  ['title',"TEXT NOT NULL DEFAULT ''"],['topic',"TEXT NOT NULL DEFAULT ''"],
  ['question',"TEXT NOT NULL DEFAULT ''"],['answer',"TEXT NOT NULL DEFAULT ''"],
  ['status',"TEXT NOT NULL DEFAULT 'published'"],['helpful_count','INTEGER NOT NULL DEFAULT 0'],
  ['sort_order','INTEGER NOT NULL DEFAULT 0'],['created_by',"TEXT NOT NULL DEFAULT 'system'"],
  ['created_at',"TEXT NOT NULL DEFAULT ''"],['updated_at',"TEXT NOT NULL DEFAULT ''"]
 ] as const;
 const existingQueryColumns=await database.prepare('PRAGMA table_info(banking_queries)').all<{name:string}>();
 const queryColumnNames=new Set((existingQueryColumns.results||[]).map(column=>column.name));
 for(const [name,definition] of queryColumns){
  if(!queryColumnNames.has(name))await database.prepare(`ALTER TABLE banking_queries ADD COLUMN ${name} ${definition}`).run();
 }
 await database.prepare('CREATE INDEX IF NOT EXISTS banking_queries_published_sort ON banking_queries(status,sort_order,updated_at)').run();
 await database.prepare(`CREATE TABLE IF NOT EXISTS banking_query_helpful (
  query_id TEXT NOT NULL REFERENCES banking_queries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(query_id,user_id)
 )`).run();
 const helpfulColumns=[['query_id',"TEXT NOT NULL DEFAULT ''"],['user_id',"TEXT NOT NULL DEFAULT ''"],['created_at',"TEXT NOT NULL DEFAULT ''"]] as const;
 const existingHelpful=await database.prepare('PRAGMA table_info(banking_query_helpful)').all<{name:string}>();
 const helpfulNames=new Set((existingHelpful.results||[]).map(column=>column.name));
 for(const [name,definition] of helpfulColumns){
  if(!helpfulNames.has(name))await database.prepare(`ALTER TABLE banking_query_helpful ADD COLUMN ${name} ${definition}`).run();
 }
 await database.prepare('CREATE INDEX IF NOT EXISTS banking_query_helpful_user ON banking_query_helpful(user_id,created_at)').run();
 // Repair partial audit tables too; a failed audit schema must not break query reads.
 await database.prepare(`CREATE TABLE IF NOT EXISTS platform_audit (
  id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  target TEXT,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  created TEXT NOT NULL
 )`).run();
 const auditColumns=[['actor',"TEXT NOT NULL DEFAULT 'system'"],['target','TEXT'],['action',"TEXT NOT NULL DEFAULT 'unknown'"],['reason',"TEXT NOT NULL DEFAULT ''"],['created',"TEXT NOT NULL DEFAULT ''"]] as const;
 const existingAudit=await database.prepare('PRAGMA table_info(platform_audit)').all<{name:string}>();
 const auditNames=new Set((existingAudit.results||[]).map(column=>column.name));
 for(const [name,definition] of auditColumns){
  if(!auditNames.has(name))await database.prepare(`ALTER TABLE platform_audit ADD COLUMN ${name} ${definition}`).run();
 }
 await database.prepare('CREATE INDEX IF NOT EXISTS platform_audit_created ON platform_audit(created)').run();
 const stamp=now();
 const seeds=[
  ['9f8c1a20-4c7d-4b31-9e62-11a000000001','ইতালির স্টুডেন্ট ভিসার জন্য কত মাসের ব্যাংক স্টেটমেন্ট প্রয়োজন?','Bank Statement','ইতালির স্টুডেন্ট ভিসার আবেদনের জন্য কত মাসের ব্যাংক স্টেটমেন্ট জমা দিতে হয়?','আবেদনকারী (Applicant) ও আর্থিক স্পন্সরের (Sponsor) গত ১২ মাসের ব্যাংক স্টেটমেন্ট প্রস্তুত রাখুন। এতে নিয়মিত লেনদেন, বর্তমান ব্যালেন্স এবং অর্থের উৎস বোঝানো সহজ হয়। জমা দেওয়ার আগে সংশ্লিষ্ট ইতালীয় দূতাবাস বা ভিসা সেন্টারের সর্বশেষ চেকলিস্ট যাচাই করুন।',10],
  ['9f8c1a20-4c7d-4b31-9e62-11a000000002','ইতালির স্টুডেন্ট ভিসার জন্য কার কার ব্যাংক স্টেটমেন্ট প্রয়োজন?','Bank Statement','শুধু স্পন্সরের, নাকি আবেদনকারীর নিজের ব্যাংক স্টেটমেন্টও প্রয়োজন?','Applicant ও Sponsor—দুজনের ব্যাংক স্টেটমেন্ট প্রস্তুত রাখুন। স্পন্সর খরচ বহন করলে তাঁর আয়ের প্রমাণ, পরিচয়পত্র, আবেদনকারীর সঙ্গে সম্পর্কের প্রমাণ এবং প্রয়োজনীয় sponsorship/consent documents-ও প্রস্তুত রাখুন। চূড়ান্ত ডকুমেন্ট তালিকা দূতাবাসের নির্দেশনা অনুযায়ী মিলিয়ে নিন।',20],
  ['9f8c1a20-4c7d-4b31-9e62-11a000000003','ইতালির স্টুডেন্ট ভিসার জন্য কোন ব্যাংকের অ্যাকাউন্ট ব্যবহার করা যাবে?','Bank Account','বাংলাদেশের নির্দিষ্ট কোনো ব্যাংকে অ্যাকাউন্ট থাকতে হবে, নাকি যেকোনো ব্যাংকের স্টেটমেন্ট দেওয়া যাবে?','বাংলাদেশ ব্যাংকের অনুমোদিত ও নিয়ন্ত্রণাধীন যেকোনো ব্যাংকের অ্যাকাউন্ট ব্যবহার করতে পারবেন। নির্দিষ্ট কোনো ব্যাংক বাধ্যতামূলক—এমন সাধারণ নিয়ম নেই। ব্যাংক স্টেটমেন্ট আসল, যাচাইযোগ্য এবং প্রয়োজনীয় তথ্যসহ হতে হবে। সর্বশেষ দূতাবাসের নির্দেশনা যাচাই করুন।',30],
  ['9f8c1a20-4c7d-4b31-9e62-11a000000004','ইতালির ভিসার জন্য কত টাকা প্রয়োজন?','Proof of Funds','ব্যাংক অ্যাকাউন্টে কত টাকা রাখা উচিত?','পরিকল্পনার জন্য প্রায় €10,500 বা তার বেশি সমপরিমাণ অর্থ প্রস্তুত রাখতে পারেন। এটি নির্দিষ্ট সরকারি ন্যূনতম অঙ্ক নয়—সর্বশেষ দূতাবাসের নির্দেশনা যাচাই করবেন। Savings Account-এ পর্যাপ্ত Liquid Money রাখুন এবং অর্থের বৈধ উৎসের প্রমাণ রাখুন। ধার করা বা সাময়িকভাবে জোগাড় করা টাকা দেখাবেন না।',40],
  ['9f8c1a20-4c7d-4b31-9e62-11a000000005','স্পন্সরের আয়ের কী কী প্রমাণ দিতে হবে?','Sponsor Documents','ইতালির স্টুডেন্ট ভিসায় স্পন্সরের আয়ের প্রমাণ হিসেবে কী জমা দেব?','স্পন্সরের চাকরি বা ব্যবসার ধরন অনুযায়ী salary certificate, payslip, employment letter, trade licence, tax return এবং ব্যাংক লেনদেনের প্রমাণ প্রস্তুত রাখুন। সব কাগজে আয়ের তথ্য যেন পরস্পরের সঙ্গে সামঞ্জস্যপূর্ণ হয়।',50],
  ['9f8c1a20-4c7d-4b31-9e62-11a000000006','স্পন্সরের সঙ্গে সম্পর্কের প্রমাণ কীভাবে দেখাব?','Sponsor Documents','স্পন্সর আমার বাবা-মা বা অন্য আত্মীয় হলে সম্পর্কের প্রমাণ কী লাগবে?','জন্মনিবন্ধন, পারিবারিক সনদ বা প্রাসঙ্গিক সরকারি নথি দিয়ে সম্পর্ক প্রমাণ করুন। নথির নাম ও প্রয়োজনীয়তা আবেদনকারীর পরিস্থিতি এবং দূতাবাসের সর্বশেষ checklist অনুযায়ী যাচাই করুন।',60],
  ['9f8c1a20-4c7d-4b31-9e62-11a000000007','ব্যাংক স্টেটমেন্টের সঙ্গে Bank Solvency Certificate লাগবে?','Bank Documents','শুধু ব্যাংক স্টেটমেন্ট দিলেই হবে, নাকি solvency certificate-ও নিতে হবে?','সর্বশেষ ভিসা checklist-এ যে নথিগুলো চাওয়া হয়েছে সেগুলো জমা দিন। ব্যাংক স্টেটমেন্টের পাশাপাশি solvency certificate চাইলে ব্যাংক থেকে account holder-এর নামে সংগ্রহ করুন।',70],
  ['9f8c1a20-4c7d-4b31-9e62-11a000000008','হঠাৎ বড় অঙ্কের টাকা জমা হলে কী সমস্যা হতে পারে?','Source of Funds','ভিসার আগে অ্যাকাউন্টে বড় অঙ্কের টাকা জমা দিলে কীভাবে ব্যাখ্যা করব?','বড় জমার বৈধ উৎসের প্রমাণ রাখুন—যেমন বেতন, ব্যবসার আয়, সম্পদ বিক্রির দলিল বা বৈধ সঞ্চয়ের নথি। শুধু ব্যালেন্স বাড়ানোর জন্য অস্থায়ীভাবে টাকা জমা দেখানো ঝুঁকিপূর্ণ।',80],
  ['9f8c1a20-4c7d-4b31-9e62-11a000000009','ব্যাংক স্টেটমেন্টে কী কী তথ্য থাকা উচিত?','Bank Statement','ভিসার জন্য ব্যাংক স্টেটমেন্টে কোন তথ্যগুলো স্পষ্ট থাকতে হবে?','ব্যাংকের নাম ও শাখা, অ্যাকাউন্টধারীর নাম, অ্যাকাউন্ট নম্বর, স্টেটমেন্টের সময়সীমা, লেনদেন, opening ও closing balance এবং ব্যাংকের যাচাইযোগ্য সিল/স্বাক্ষর বা digital verification থাকা উচিত।',90],
  ['9f8c1a20-4c7d-4b31-9e62-11a000000010','স্পন্সর কি একাধিক শিক্ষার্থীর খরচ বহন করতে পারবেন?','Sponsor Capacity','একজন স্পন্সর একাধিক শিক্ষার্থীর জন্য আর্থিক সহায়তা দেখাতে পারবেন?','এটি স্পন্সরের প্রকৃত আয়, সঞ্চয়, বিদ্যমান দায় এবং প্রত্যেক শিক্ষার্থীর খরচ বহনের সক্ষমতার ওপর নির্ভর করে। সব আবেদনকারীর জন্য পর্যাপ্ত ও বিশ্বাসযোগ্য অর্থের প্রমাণ দিতে হবে; দূতাবাসের নির্দেশনা যাচাই করুন।',100]
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
  // Seed and serve published knowledge independently of a signed-in workspace session.
  await ensureBankingQueries();
  let userId='';
  try{const user=await identity();userId=user.userId}catch{/* Public read access; admin writes still require authentication. */}
  const isAdmin=await superAdmin().then(()=>true).catch(()=>false);
  const rows=await db().prepare(`SELECT q.id,q.title,q.topic,q.question,q.answer,q.status,q.helpful_count,q.sort_order,q.created_at,q.updated_at,
    CASE WHEN h.user_id IS NULL THEN 0 ELSE 1 END AS helpful_by_me
    FROM banking_queries q LEFT JOIN banking_query_helpful h ON h.query_id=q.id AND h.user_id=?
    ${isAdmin?'':"WHERE q.status='published'"}
    ORDER BY q.sort_order,q.updated_at DESC`).bind(userId).all();
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
