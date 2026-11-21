export async function cleanupCommunity(database: D1Database) {
 const stamp=new Date().toISOString();
 const comments=await database.prepare('DELETE FROM community_comments WHERE expires_at<=?').bind(stamp).run();
 const posts=await database.prepare('DELETE FROM community_posts WHERE expires_at<=?').bind(stamp).run();
 const staleReports=await database.prepare("DELETE FROM community_reports WHERE (post_id IS NOT NULL AND post_id NOT IN (SELECT id FROM community_posts)) OR (comment_id IS NOT NULL AND comment_id NOT IN (SELECT id FROM community_comments))").run();
 return {deletedComments:comments.meta.changes||0,deletedPosts:posts.meta.changes||0,deletedReports:staleReports.meta.changes||0};
}