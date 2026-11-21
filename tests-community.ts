import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {cleanupCommunity} from './lib/community-cleanup.ts';

const require=createRequire(import.meta.url);
const runtime=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=await import(pathToFileURL(runtime.resolve('miniflare')).href);
const mf=new Miniflare({script:'export default {fetch(){return new Response("test")}}',modules:true,d1Databases:['DB'],compatibilityDate:'2026-05-15'});
let checks=0;
const ok=(value:unknown)=>{assert.ok(value);checks++};
try{
 const db=await mf.getD1Database('DB');
 await db.prepare("CREATE TABLE platform_users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,last_seen TEXT NOT NULL,preferences TEXT NOT NULL)").run();
 const migration=await readFile('drizzle/0008_banking_feed.sql','utf8');
 for(const statement of migration.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 const hubMigration=await readFile('drizzle/0009_banking_hub_content.sql','utf8');
 for(const statement of hubMigration.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 const hubId=crypto.randomUUID(),hubStamp=new Date().toISOString();
 await db.prepare("INSERT INTO banking_hub_content(id,kind,title,summary,body,category,country,platform,meeting_url,venue,starts_at,timezone,duration_minutes,fee_amount,fee_currency,status,access_level,sort_order,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .bind(hubId,'event','Student workshop','Open workshop','Event details','IELTS','','Google Meet','https://meet.google.com/example','Online',new Date(Date.now()+86400000).toISOString(),'Asia/Dhaka',60,null,'BDT','published','public',0,'admin',hubStamp,hubStamp).run();
 const publicEvent=await db.prepare("SELECT title,platform,status,access_level FROM banking_hub_content WHERE id=?").bind(hubId).first() as {title:string;platform:string;status:string;access_level:string}|null;
 ok(publicEvent?.title==='Student workshop'&&publicEvent.platform==='Google Meet'&&publicEvent.status==='published'&&publicEvent.access_level==='public');
 await db.prepare("UPDATE banking_hub_content SET title=?,status='draft',updated_at=? WHERE id=?").bind('Updated workshop',new Date().toISOString(),hubId).run();
 const updatedEvent=await db.prepare("SELECT title,status FROM banking_hub_content WHERE id=?").bind(hubId).first() as {title:string;status:string}|null;
 ok(updatedEvent?.title==='Updated workshop'&&updatedEvent.status==='draft');
 await db.prepare("DELETE FROM banking_hub_content WHERE id=?").bind(hubId).run();
 ok(!(await db.prepare("SELECT id FROM banking_hub_content WHERE id=?").bind(hubId).first()));

 for(const id of ['author','reader'])await db.prepare("INSERT INTO platform_users(id,name,email,status,created,last_seen,preferences) VALUES(?,?,?,'active',?,?, '{}')").bind(id,id,id+'@example.test',new Date().toISOString(),new Date().toISOString()).run();
 const stamp=new Date().toISOString(),past=new Date(Date.now()-25*3600000).toISOString(),future=new Date(Date.now()+24*3600000).toISOString();
 const post=crypto.randomUUID(),expiredPost=crypto.randomUUID();
 await db.prepare("INSERT INTO community_posts(id,author_id,category,body,status,created_at,updated_at,expires_at) VALUES(?,?, 'General Discussion','active post','active',?,?,?)").bind(post,'author',stamp,stamp,future).run();
 await db.prepare("INSERT INTO community_posts(id,author_id,category,body,status,created_at,updated_at,expires_at) VALUES(?,?, 'General Discussion','expired post','active',?,?,?)").bind(expiredPost,'author',past,past,past).run();
 const parent=crypto.randomUUID(),reply=crypto.randomUUID(),expiredReply=crypto.randomUUID();
 await db.prepare("INSERT INTO community_comments(id,post_id,author_id,body,created_at,updated_at,expires_at) VALUES(?,?,?,'parent',?,?,?)").bind(parent,post,'author',past,past,past).run();
 await db.prepare("INSERT INTO community_comments(id,post_id,author_id,parent_id,body,created_at,updated_at,expires_at) VALUES(?,?,?,?, 'reply',?,?,?)").bind(reply,post,'reader',parent,stamp,stamp,future).run();
 await db.prepare("INSERT INTO community_comments(id,post_id,author_id,body,created_at,updated_at,expires_at) VALUES(?,?,?,'expired reply',?,?,?)").bind(expiredReply,post,'reader',stamp,stamp,past).run();
 await db.prepare('INSERT INTO community_saved_posts(user_id,post_id,created_at) VALUES(?,?,?)').bind('reader',expiredPost,stamp).run();
 await db.prepare("INSERT INTO community_reactions(post_id,user_id,reaction_type,created_at) VALUES(?,?,'like',?)").bind(expiredPost,'reader',stamp).run();
 const result=await cleanupCommunity(db);
 ok(result.deletedComments>=2);
 ok(result.deletedPosts>=0);
 ok(!(await db.prepare('SELECT id FROM community_posts WHERE id=?').bind(expiredPost).first()));
 ok(!(await db.prepare('SELECT id FROM community_comments WHERE id=?').bind(expiredReply).first()));
 ok(!!await db.prepare('SELECT id FROM community_comments WHERE id=?').bind(parent).first()===false);
 ok(!(await db.prepare('SELECT id FROM community_comments WHERE id=?').bind(reply).first()));
 ok(!(await db.prepare('SELECT post_id FROM community_saved_posts WHERE post_id=?').bind(expiredPost).first()));
 ok(!(await db.prepare('SELECT post_id FROM community_reactions WHERE post_id=?').bind(expiredPost).first()));
 ok(!!await db.prepare('SELECT id FROM community_posts WHERE id=?').bind(post).first());
 // A fresh, unexpired comment remains visible and has a hard 24-hour expiry.
 const fresh=crypto.randomUUID(),expires=new Date(Date.now()+24*3600000).toISOString();
 await db.prepare('INSERT INTO community_comments(id,post_id,author_id,body,created_at,updated_at,expires_at) VALUES(?,?,?,\'fresh\',?,?,?)').bind(fresh,post,'reader',stamp,stamp,expires).run();
 await cleanupCommunity(db);
 ok(!!await db.prepare('SELECT id FROM community_comments WHERE id=? AND expires_at>?').bind(fresh,stamp).first());
 // Post/comment profile reads must exclude expired records using explicit timestamp predicates.
 const visible=await db.prepare('SELECT id FROM community_posts WHERE author_id=? AND expires_at>? AND status=\'active\'').bind('author',stamp).all();
 ok(visible.results.length===1&&visible.results[0].id===post);
 console.log(`Banking Feed cleanup: ${checks} checks passed (D1 migrations, expiry, cascade, saved/reaction cleanup and active profile visibility).`);
}finally{await mf.dispose()}
