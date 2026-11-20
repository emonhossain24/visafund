export async function cleanupCommunity(database: D1Database) {
  const stamp = new Date().toISOString();
  const comments = await database.prepare(
    'DELETE FROM community_comments WHERE expires_at<=?'
  ).bind(stamp).run();
  const posts = await database.prepare(
    'DELETE FROM community_posts WHERE expires_at<=?'
  ).bind(stamp).run();
  // Expired child records are removed first; post foreign keys cascade reactions,
  // saved-post references, and any remaining comment rows.
  return { deletedComments: comments.meta.changes || 0, deletedPosts: posts.meta.changes || 0 };
}
