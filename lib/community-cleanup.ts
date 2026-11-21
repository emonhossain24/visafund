export async function cleanupCommunity(database: D1Database) {
 const stamp=new Date().toISOString();
 const admins="SELECT owner FROM platform_roles WHERE role='SUPER_ADMIN'";
 const comments=await database.prepare(
  'DELETE FROM community_comments WHERE (expires_at<=? AND author_id NOT IN ('+admins+')) OR parent_id IN (SELECT id FROM community_comments WHERE expires_at<=? AND author_id NOT IN ('+admins+'))'
 ).bind(stamp,stamp).run();
 const posts=await database.prepare(
  "DELETE FROM community_posts WHERE expires_at<=? AND author_id NOT IN ("+admins+") AND NOT EXISTS (SELECT 1 FROM community_comments c JOIN platform_roles r ON r.owner=c.author_id AND r.role='SUPER_ADMIN' WHERE c.post_id=community_posts.id)"
 ).bind(stamp).run();
 const staleReports=await database.prepare("DELETE FROM community_reports WHERE (post_id IS NOT NULL AND post_id NOT IN (SELECT id FROM community_posts)) OR (comment_id IS NOT NULL AND comment_id NOT IN (SELECT id FROM community_comments))").run();
 return {deletedComments:comments.meta.changes||0,deletedPosts:posts.meta.changes||0,deletedReports:staleReports.meta.changes||0};
}
