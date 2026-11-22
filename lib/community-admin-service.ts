import { z } from 'zod';

const timestamp = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function slugify(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'community';
}

async function record(database: D1Database, actor: string, action: string, targetRef: string | null, targetUser: string | null, reason = '') {
  await database.prepare(
    'INSERT INTO community_moderation_logs(id,actor_id,target_user,target_ref,action,reason,created_at) VALUES(?,?,?,?,?,?,?)'
  ).bind(id(), actor, targetUser, targetRef, action, reason.slice(0, 300), timestamp()).run();
}

export async function readCommunityAdmin(database: D1Database, mode: string, search = '', status = 'all') {
  const q = '%' + search.trim().slice(0, 80) + '%';
  if (mode === 'overview') {
    const [posts, comments, groups, reports, restrictedUsers, members] = await Promise.all([
      database.prepare("SELECT COUNT(*) AS count FROM community_posts").first<{count:number}>(),
      database.prepare("SELECT COUNT(*) AS count FROM community_comments").first<{count:number}>(),
      database.prepare("SELECT COUNT(*) AS count FROM community_groups WHERE status='active'").first<{count:number}>(),
      database.prepare("SELECT COUNT(*) AS count FROM community_reports WHERE status='open'").first<{count:number}>(),
      database.prepare("SELECT COUNT(*) AS count FROM community_user_controls WHERE status<>'active' OR posting_disabled=1 OR commenting_disabled=1").first<{count:number}>(),
      database.prepare("SELECT COUNT(*) AS count FROM community_group_members WHERE status='pending'").first<{count:number}>(),
    ]);
    return { posts: posts?.count || 0, comments: comments?.count || 0, groups: groups?.count || 0, openReports: reports?.count || 0, restrictedUsers: restrictedUsers?.count || 0, pendingMembers: members?.count || 0 };
  }
  if (mode === 'posts') {
    const rows = await database.prepare(
      "SELECT p.id,p.author_id,p.group_id,p.category,p.body,p.status,p.created_at,p.updated_at,p.expires_at," +
      "u.name AS author_name,pi.id AS author_profile_id,g.name AS group_name," +
      "(SELECT COUNT(*) FROM community_comments c WHERE c.post_id=p.id) AS comment_count," +
      "(SELECT COUNT(*) FROM community_reactions r WHERE r.post_id=p.id AND r.reaction_type='like') AS like_count," +
      "(SELECT COUNT(*) FROM community_reactions r WHERE r.post_id=p.id AND r.reaction_type='helpful') AS helpful_count " +
      "FROM community_posts p JOIN platform_users u ON u.id=p.author_id " +
      "LEFT JOIN platform_profile_ids pi ON pi.owner=p.author_id LEFT JOIN community_groups g ON g.id=p.group_id " +
      "WHERE (?='all' OR p.status=?) AND (p.body LIKE ? OR u.name LIKE ? OR CAST(pi.id AS TEXT) LIKE ?) " +
      "ORDER BY p.created_at DESC LIMIT 100"
    ).bind(status, status, q, q, q).all();
    return { posts: rows.results };
  }
  if (mode === 'comments') {
    const rows = await database.prepare(
      "SELECT c.id,c.post_id,c.author_id,c.parent_id,c.body,c.created_at,c.updated_at,c.expires_at," +
      "u.name AS author_name,pi.id AS author_profile_id,p.body AS post_body,p.status AS post_status " +
      "FROM community_comments c JOIN community_posts p ON p.id=c.post_id " +
      "JOIN platform_users u ON u.id=c.author_id LEFT JOIN platform_profile_ids pi ON pi.owner=c.author_id " +
      "WHERE (?='all' OR p.status=?) " +
      "AND (c.body LIKE ? OR u.name LIKE ? OR CAST(pi.id AS TEXT) LIKE ?) ORDER BY c.created_at DESC LIMIT 150"
    ).bind(status, status, q, q, q).all();
    return { comments: rows.results };
  }
  if (mode === 'groups') {
    const rows = await database.prepare(
      "SELECT g.id,g.slug,g.name,g.description,g.join_mode,g.status,g.created_at,g.updated_at," +
      "(SELECT COUNT(*) FROM community_group_members m WHERE m.group_id=g.id AND m.status='active') AS member_count," +
      "(SELECT COUNT(*) FROM community_group_members m WHERE m.group_id=g.id AND m.status='pending') AS pending_count," +
      "(SELECT COUNT(*) FROM community_posts p WHERE p.group_id=g.id) AS post_count " +
      "FROM community_groups g WHERE (?='all' OR g.status=?) AND (g.name LIKE ? OR g.description LIKE ?) ORDER BY g.name LIMIT 100"
    ).bind(status, status, q, q).all();
    return { groups: rows.results };
  }
  if (mode === 'members') {
    const rows = await database.prepare(
      "SELECT u.id,u.name,pi.id AS profile_id,u.status AS account_status," +
      "COALESCE(c.status,'active') AS community_status,COALESCE(c.posting_disabled,0) AS posting_disabled," +
      "COALESCE(c.commenting_disabled,0) AS commenting_disabled,COALESCE(c.reason,'') AS reason,c.updated_at " +
      "FROM platform_users u LEFT JOIN platform_profile_ids pi ON pi.owner=u.id " +
      "LEFT JOIN community_user_controls c ON c.user_id=u.id " +
      "WHERE (?='all' OR COALESCE(c.status,'active')=?) AND (u.name LIKE ? OR u.id LIKE ? OR CAST(pi.id AS TEXT) LIKE ?) " +
      "ORDER BY u.created DESC LIMIT 150"
    ).bind(status, status, q, q, q).all();
    return { members: rows.results };
  }
  if (mode === 'memberships') {
    const rows = await database.prepare(
      "SELECT m.group_id,m.user_id,m.status,m.joined_at,g.name AS group_name,u.name AS user_name,pi.id AS profile_id " +
      "FROM community_group_members m JOIN community_groups g ON g.id=m.group_id " +
      "JOIN platform_users u ON u.id=m.user_id LEFT JOIN platform_profile_ids pi ON pi.owner=m.user_id " +
      "WHERE (?='all' OR m.status=?) AND (g.name LIKE ? OR u.name LIKE ? OR m.user_id LIKE ? OR CAST(pi.id AS TEXT) LIKE ?) " +
      "ORDER BY CASE WHEN m.status='pending' THEN 0 ELSE 1 END,m.joined_at DESC LIMIT 200"
    ).bind(status, status, q, q, q, q).all();
    return { memberships: rows.results };
  }
  if (mode === 'reports') {
    const rows = await database.prepare(
      "SELECT r.id,r.reason,r.status,r.created_at,r.reviewed_by,r.reviewed_at,r.post_id,r.comment_id," +
      "u.name AS reporter_name,pi.id AS reporter_profile_id," +
      "CASE WHEN p.id IS NOT NULL THEN p.body WHEN c.id IS NOT NULL THEN c.body ELSE NULL END AS content_preview " +
      "FROM community_reports r JOIN platform_users u ON u.id=r.reporter_id " +
      "LEFT JOIN platform_profile_ids pi ON pi.owner=r.reporter_id " +
      "LEFT JOIN community_posts p ON p.id=r.post_id LEFT JOIN community_comments c ON c.id=r.comment_id " +
      "WHERE (?='all' OR r.status=?) AND (r.reason LIKE ? OR u.name LIKE ?) ORDER BY r.created_at DESC LIMIT 150"
    ).bind(status, status, q, q).all();
    return { reports: rows.results };
  }
  if (mode === 'logs') {
    const rows = await database.prepare(
      "SELECT l.id,l.target_user,l.target_ref,l.action,l.reason,l.created_at,u.name AS admin_name " +
      "FROM community_moderation_logs l LEFT JOIN platform_users u ON u.id=l.actor_id " +
      "WHERE (l.action LIKE ? OR l.target_ref LIKE ? OR l.reason LIKE ?) ORDER BY l.created_at DESC LIMIT 200"
    ).bind(q, q, q).all();
    return { logs: rows.results };
  }
  throw Object.assign(new Error('Unsupported Banking Feed administration view.'), { status: 400 });
}

const actionSchema = z.object({
  action: z.enum([
    'hide-post','restore-post','edit-post','delete-post','delete-comment',
    'create-group','update-group','delete-group','approve-member','reject-member','remove-member',
    'set-user-controls','review-report',
  ]),
  postId: z.string().optional(),
  commentId: z.string().optional(),
  body: z.string().optional(),
  category: z.string().optional(),
  groupId: z.string().optional(),
  groupName: z.string().optional(),
  slug: z.string().optional(),
  description: z.string().optional(),
  joinMode: z.enum(['open','approval']).optional(),
  groupStatus: z.enum(['active','inactive']).optional(),
  targetUser: z.string().optional(),
  membershipAction: z.enum(['approve','reject','remove']).optional(),
  communityStatus: z.enum(['active','suspended','banned']).optional(),
  postingDisabled: z.boolean().optional(),
  commentingDisabled: z.boolean().optional(),
  reason: z.string().optional(),
  reportId: z.string().optional(),
  reportStatus: z.enum(['resolved','ignored']).optional(),
  confirmation: z.string().optional(),
}).strict();

function moderationText(value: string, max: number) {
  const text = value.trim();
  if (!text || text.length > max) throw Object.assign(new Error('Please enter valid text within the character limit.'), { status: 400 });
  if (/(?:\d[ -]?){13,19}/.test(text) || (/\b(otp|one[- ]time password|pin|password|cvv|cvc|card number|account number)\b/i.test(text) && /\d/.test(text))) {
    throw Object.assign(new Error('Do not include OTPs, passwords, PINs, card numbers, or full account details.'), { status: 400 });
  }
  return text;
}

export async function moderateCommunity(database: D1Database, actor: string, raw: unknown) {
  const input = actionSchema.parse(raw);
  const stamp = timestamp();
  const reason = (input.reason || 'Administrator moderation').trim().slice(0, 300);
  const writeLog = (action: string, targetRef: string | null, targetUser: string | null = null) =>
    database.prepare('INSERT INTO community_moderation_logs(id,actor_id,target_user,target_ref,action,reason,created_at) VALUES(?,?,?,?,?,?,?)')
      .bind(id(), actor, targetUser, targetRef, action, reason, stamp);

  if (input.action === 'hide-post' || input.action === 'restore-post' || input.action === 'delete-post') {
    const postId = z.string().uuid().parse(input.postId);
    const post = await database.prepare('SELECT id FROM community_posts WHERE id=?').bind(postId).first();
    if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
    if (input.action === 'delete-post') {
      if (input.confirmation !== 'DELETE POST') throw Object.assign(new Error('Confirm permanent post deletion.'), { status: 400 });
      await database.batch([
        database.prepare('DELETE FROM community_posts WHERE id=?').bind(postId),
        writeLog('post.delete', postId),
      ]);
      return { ok: true };
    }
    const status = input.action === 'hide-post' ? 'hidden' : 'active';
    await database.batch([
      database.prepare('UPDATE community_posts SET status=?,updated_at=? WHERE id=?').bind(status, stamp, postId),
      writeLog(input.action === 'hide-post' ? 'post.hide' : 'post.restore', postId),
    ]);
    return { ok: true, status };
  }

  if (input.action === 'edit-post') {
    const postId = z.string().uuid().parse(input.postId);
    const body = moderationText(input.body || '', 5000);
    const category = z.string().trim().min(1).max(60).parse(input.category || 'General Discussion');
    const result = await database.prepare('UPDATE community_posts SET body=?,category=?,updated_at=? WHERE id=?')
      .bind(body, category, stamp, postId).run();
    if (!result.meta.changes) throw Object.assign(new Error('Post not found.'), { status: 404 });
    await record(database, actor, 'post.edit', postId, null, reason);
    return { ok: true };
  }

  if (input.action === 'delete-comment') {
    const commentId = z.string().uuid().parse(input.commentId);
    const result = await database.prepare('DELETE FROM community_comments WHERE id=? OR parent_id=?').bind(commentId, commentId).run();
    if (!result.meta.changes) throw Object.assign(new Error('Comment not found.'), { status: 404 });
    await record(database, actor, 'comment.delete', commentId, null, reason);
    return { ok: true };
  }

  if (input.action === 'create-group') {
    const name = moderationText(input.groupName || '', 60);
    const description = (input.description || '').trim().slice(0, 500);
    const joinMode = input.joinMode || 'open';
    const groupId = id();
    const baseSlug = slugify(input.slug?.trim() || name);
    const slug = baseSlug + '-' + groupId.slice(0, 6);
    await database.batch([
      database.prepare("INSERT INTO community_groups(id,slug,name,description,join_mode,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?,?)")
        .bind(groupId, slug, name, description, joinMode, actor, stamp, stamp),
      writeLog('group.create', groupId),
    ]);
    return { ok: true, groupId };
  }

  if (input.action === 'update-group') {
    const groupId = z.string().min(1).max(80).parse(input.groupId);
    const name = moderationText(input.groupName || '', 60);
    const description = (input.description || '').trim().slice(0, 500);
    const joinMode = input.joinMode || 'open';
    const groupStatus = input.groupStatus || 'active';
    const result = await database.prepare('UPDATE community_groups SET name=?,description=?,join_mode=?,status=?,updated_at=? WHERE id=?')
      .bind(name, description, joinMode, groupStatus, stamp, groupId).run();
    if (!result.meta.changes) throw Object.assign(new Error('Community not found.'), { status: 404 });
    await record(database, actor, 'group.update', groupId, null, reason);
    return { ok: true };
  }

  if (input.action === 'delete-group') {
    const groupId = z.string().min(1).max(80).parse(input.groupId);
    const group = await database.prepare('SELECT name FROM community_groups WHERE id=?').bind(groupId).first<{name:string}>();
    if (!group) throw Object.assign(new Error('Community not found.'), { status: 404 });
    if (input.confirmation !== group.name) throw Object.assign(new Error('Type the exact community name to confirm deletion.'), { status: 400 });
    await database.batch([
      database.prepare('DELETE FROM community_groups WHERE id=?').bind(groupId),
      writeLog('group.delete', groupId),
    ]);
    return { ok: true };
  }

  if (['approve-member','reject-member','remove-member'].includes(input.action)) {
    const groupId = z.string().min(1).max(80).parse(input.groupId);
    const targetUser = z.string().min(1).max(200).parse(input.targetUser);
    const existing = await database.prepare('SELECT status FROM community_group_members WHERE group_id=? AND user_id=?')
      .bind(groupId, targetUser).first<{status:string}>();
    if (!existing) throw Object.assign(new Error('Community membership not found.'), { status: 404 });
    const approve = input.action === 'approve-member';
    const stmt = approve
      ? database.prepare("UPDATE community_group_members SET status='active' WHERE group_id=? AND user_id=?").bind(groupId, targetUser)
      : database.prepare('DELETE FROM community_group_members WHERE group_id=? AND user_id=?').bind(groupId, targetUser);
    await database.batch([stmt, writeLog('member.' + input.action.replace('-member',''), groupId, targetUser)]);
    return { ok: true, membershipStatus: approve ? 'active' : 'removed' };
  }

  if (input.action === 'set-user-controls') {
    const targetUser = z.string().min(1).max(200).parse(input.targetUser);
    const target = await database.prepare('SELECT id FROM platform_users WHERE id=?').bind(targetUser).first();
    if (!target) throw Object.assign(new Error('VisaFund user not found.'), { status: 404 });
    const communityStatus = input.communityStatus || 'active';
    const postingDisabled = input.postingDisabled ? 1 : 0;
    const commentingDisabled = input.commentingDisabled ? 1 : 0;
    await database.batch([
      database.prepare(
        'INSERT INTO community_user_controls(user_id,status,posting_disabled,commenting_disabled,reason,updated_by,updated_at) VALUES(?,?,?,?,?,?,?) ' +
        'ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,posting_disabled=excluded.posting_disabled,commenting_disabled=excluded.commenting_disabled,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at'
      ).bind(targetUser, communityStatus, postingDisabled, commentingDisabled, reason, actor, stamp),
      writeLog('user.controls.update', null, targetUser),
    ]);
    return { ok: true };
  }

  if (input.action === 'review-report') {
    const reportId = z.string().uuid().parse(input.reportId);
    const reportStatus = z.enum(['resolved','ignored']).parse(input.reportStatus);
    const result = await database.prepare('UPDATE community_reports SET status=?,reviewed_by=?,reviewed_at=? WHERE id=?')
      .bind(reportStatus, actor, stamp, reportId).run();
    if (!result.meta.changes) throw Object.assign(new Error('Report not found.'), { status: 404 });
    await record(database, actor, 'report.' + reportStatus, reportId, null, reason);
    return { ok: true, status: reportStatus };
  }

  throw Object.assign(new Error('Unsupported moderation action.'), { status: 400 });
}
