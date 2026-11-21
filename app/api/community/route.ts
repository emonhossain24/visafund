import { z } from 'zod';
import { db, identity, HttpError, fail, guard, rateLimit, readJson, now, uid } from '@/lib/server';
import { profileIdForOwner } from '@/lib/profile-id';

export const dynamic = 'force-dynamic';

const CATEGORIES = [
  'Bank Account',
  'Bank Statement',
  'Bank Solvency',
  'Bank Transactions',
  'Education Loan',
  'FDR / DPS',
  'Financial Documents',
  'Bank Issues',
  'General Discussion',
  'Student Questions',
  'University & Visa Discussions',
  'Scholarships',
  'Success Stories',
] as const;

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

type PostRow = {
  id: string;
  author_name: string;
  author_profile_id: number | null;
  category: string;
  body: string;
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  group_id: string | null;
  group_name: string | null;
  comment_count: number;
  like_count: number;
  helpful_count: number;
  my_reaction: 'like' | 'helpful' | null;
  saved: number;
  is_mine: number;
};

async function communityControl(owner: string) {
  return db().prepare(
    "SELECT status,posting_disabled,commenting_disabled,reason FROM community_user_controls WHERE user_id=?"
  ).bind(owner).first<{status:string;posting_disabled:number;commenting_disabled:number;reason:string}>();
}

async function ensureCommunityAccess(owner: string, action?: 'post' | 'comment') {
  const control = await communityControl(owner);
  if (control && control.status !== 'active') {
    throw new HttpError(403, control.status === 'banned' ? 'Your Banking Feed access is banned.' : 'Your Banking Feed access is suspended.');
  }
  if (action === 'post' && control?.posting_disabled) throw new HttpError(403, 'Posting is currently restricted by the administrator.');
  if (action === 'comment' && control?.commenting_disabled) throw new HttpError(403, 'Commenting is currently restricted by the administrator.');
}

function safeCommunityText(value: string) {
  const text = value.trim();
  if (!text) throw new HttpError(400, 'Write some text before publishing.');
  const hasLongNumber = /(?:\d[ -]?){13,19}/.test(text);
  const hasSensitiveLabel = /\b(otp|one[- ]time password|pin|password|cvv|cvc|card number|account number|full account)\b/i.test(text);
  if (hasLongNumber || (hasSensitiveLabel && /\d/.test(text))) {
    throw new HttpError(400, 'Do not post OTPs, passwords, PINs, card numbers, or full bank account details.');
  }
  return text;
}

async function assertPostVisible(postId: string, owner: string) {
  const post = await db().prepare(
    "SELECT id,group_id FROM community_posts WHERE id=? AND status='active' AND expires_at>?"
  ).bind(postId, now()).first<{id:string;group_id:string|null}>();
  if (!post) throw new HttpError(404, 'This post is no longer available.');
  if (post.group_id) {
    const membership = await db().prepare(
      "SELECT 1 AS ok FROM community_group_members gm JOIN community_groups g ON g.id=gm.group_id WHERE gm.group_id=? AND gm.user_id=? AND gm.status='active' AND g.status='active'"
    ).bind(post.group_id, owner).first();
    if (!membership) throw new HttpError(403, 'Join this community to view its posts.');
  }
  return post;
}

async function readPosts(owner: string, options: {
  page?: number;
  groupId?: string;
  category?: string;
  query?: string;
  sort?: string;
  savedOnly?: boolean;
  postId?: string;
  authorId?: string;
} = {}) {
  const stamp = now();
  const page = Math.max(1, Math.min(10000, options.page || 1));
  const limit = 20;
  const where = [
    "p.status='active'",
    'p.expires_at>?',
    "(p.group_id IS NULL OR EXISTS (SELECT 1 FROM community_group_members gm JOIN community_groups gx ON gx.id=gm.group_id WHERE gm.group_id=p.group_id AND gm.user_id=? AND gm.status='active' AND gx.status='active'))",
  ];
  const args: unknown[] = [stamp, owner];
  if (options.groupId) {
    where.push('p.group_id=?');
    args.push(options.groupId);
  }
  if (options.category) {
    where.push('p.category=?');
    args.push(options.category);
  }
  if (options.postId) {
    where.push('p.id=?');
    args.push(options.postId);
  }
  if (options.authorId) {
    where.push('p.author_id=?');
    args.push(options.authorId);
  }
  if (options.query) {
    where.push('(p.body LIKE ? OR u.name LIKE ?)');
    args.push('%' + options.query.slice(0, 80) + '%', '%' + options.query.slice(0, 80) + '%');
  }
  if (options.savedOnly) {
    where.push('EXISTS (SELECT 1 FROM community_saved_posts sx WHERE sx.post_id=p.id AND sx.user_id=?)');
    args.push(owner);
  }
  const order = options.sort === 'popular'
    ? "(SELECT COUNT(*) FROM community_reactions rx WHERE rx.post_id=p.id) DESC, p.created_at DESC"
    : 'p.created_at DESC';
  const rows = await db().prepare(
    "SELECT p.id,p.category,p.body,p.status,p.created_at,p.updated_at,p.expires_at,p.group_id," +
    "u.name AS author_name,pi.id AS author_profile_id,g.name AS group_name," +
    "(SELECT COUNT(*) FROM community_comments c WHERE c.post_id=p.id AND c.expires_at>?) AS comment_count," +
    "(SELECT COUNT(*) FROM community_reactions r WHERE r.post_id=p.id AND r.reaction_type='like') AS like_count," +
    "(SELECT COUNT(*) FROM community_reactions r WHERE r.post_id=p.id AND r.reaction_type='helpful') AS helpful_count," +
    "(SELECT r.reaction_type FROM community_reactions r WHERE r.post_id=p.id AND r.user_id=? LIMIT 1) AS my_reaction," +
    "EXISTS (SELECT 1 FROM community_saved_posts s WHERE s.post_id=p.id AND s.user_id=?) AS saved," +
    "CASE WHEN p.author_id=? THEN 1 ELSE 0 END AS is_mine " +
    "FROM community_posts p JOIN platform_users u ON u.id=p.author_id " +
    "LEFT JOIN platform_profile_ids pi ON pi.owner=p.author_id " +
    "LEFT JOIN community_groups g ON g.id=p.group_id WHERE " + where.join(' AND ') +
    " ORDER BY " + order + ' LIMIT ? OFFSET ?'
  ).bind(stamp, owner, owner, owner, ...args, limit + 1, (page - 1) * limit).all<PostRow>();
  const items = rows.results.slice(0, limit);
  return { posts: items, page, hasMore: rows.results.length > limit };
}

export async function GET(request: Request) {
  try {
    const user = await identity();
    await profileIdForOwner(db(), user.userId);
    await rateLimit(user.userId, 'community-read', 120);
    await ensureCommunityAccess(user.userId);
    const url = new URL(request.url);
    const params = url.searchParams;
    const mode = params.get('mode') || 'feed';

    if (mode === 'groups') {
      const result = await db().prepare(
        "SELECT g.id,g.slug,g.name,g.description,g.join_mode,g.status," +
        "(SELECT COUNT(*) FROM community_group_members m WHERE m.group_id=g.id AND m.status='active') AS member_count," +
        "(SELECT m.status FROM community_group_members m WHERE m.group_id=g.id AND m.user_id=? LIMIT 1) AS membership_status " +
        "FROM community_groups g WHERE g.status='active' ORDER BY g.name"
      ).bind(user.userId).all();
      return json({ groups: result.results });
    }

    if (mode === 'comments') {
      const postId = z.string().uuid().parse(params.get('postId'));
      await assertPostVisible(postId, user.userId);
      const comments = await db().prepare(
        "SELECT c.id,c.post_id,c.parent_id,c.body,c.created_at,c.updated_at,c.expires_at," +
        "u.name AS author_name,pi.id AS author_profile_id,CASE WHEN c.author_id=? THEN 1 ELSE 0 END AS is_mine " +
        "FROM community_comments c JOIN platform_users u ON u.id=c.author_id " +
        "LEFT JOIN platform_profile_ids pi ON pi.owner=c.author_id " +
        "WHERE c.post_id=? AND c.expires_at>? ORDER BY c.created_at ASC LIMIT 100"
      ).bind(user.userId, postId, now()).all();
      return json({ comments: comments.results });
    }

    if (mode === 'profile') {
      const rawProfile = params.get('profileId');
      const profileId = rawProfile ? z.coerce.number().int().positive().parse(rawProfile) : null;
      const profile = profileId
        ? await db().prepare("SELECT u.id,u.name,pi.id AS profile_id FROM platform_profile_ids pi JOIN platform_users u ON u.id=pi.owner WHERE pi.id=? AND u.status='active'").bind(profileId).first<{id:string;name:string;profile_id:number}>()
        : await db().prepare("SELECT u.id,u.name,pi.id AS profile_id FROM platform_users u JOIN platform_profile_ids pi ON pi.owner=u.id WHERE u.id=? AND u.status='active'").bind(user.userId).first<{id:string;name:string;profile_id:number}>();
      if (!profile) throw new HttpError(404, 'This profile is not available.');
      const posts = await readPosts(user.userId, { page: 1, authorId: profile.id });
      const comments = await db().prepare(
        "SELECT c.id,c.post_id,c.parent_id,c.body,c.created_at,c.expires_at,p.body AS post_body," +
        "u.name AS author_name,pi.id AS author_profile_id,CASE WHEN c.author_id=? THEN 1 ELSE 0 END AS is_mine " +
        "FROM community_comments c JOIN community_posts p ON p.id=c.post_id " +
        "JOIN platform_users u ON u.id=c.author_id LEFT JOIN platform_profile_ids pi ON pi.owner=c.author_id " +
        "WHERE c.author_id=? AND c.expires_at>? AND p.status='active' AND p.expires_at>? " +
        "AND (p.group_id IS NULL OR EXISTS (SELECT 1 FROM community_group_members gm JOIN community_groups g ON g.id=gm.group_id WHERE gm.group_id=p.group_id AND gm.user_id=? AND gm.status='active' AND g.status='active')) " +
        "ORDER BY c.created_at DESC LIMIT 20"
      ).bind(user.userId, profile.id, now(), now(), user.userId).all();
      return json({
        profile: { name: profile.name, profileId: profile.profile_id },
        posts: posts.posts,
        comments: comments.results,
      });
    }

    if (mode === 'saved') {
      return json(await readPosts(user.userId, { page: Number(params.get('page') || 1), savedOnly: true }));
    }

    if (mode === 'post') {
      const postId = z.string().uuid().parse(params.get('id'));
      await assertPostVisible(postId, user.userId);
      return json(await readPosts(user.userId, { postId }));
    }

    if (mode !== 'feed') throw new HttpError(400, 'Unsupported Banking Feed request.');
    const groupId = params.get('groupId') || undefined;
    if (groupId) {
      const member = await db().prepare(
        "SELECT 1 AS ok FROM community_group_members WHERE group_id=? AND user_id=? AND status='active'"
      ).bind(groupId, user.userId).first();
      if (!member) throw new HttpError(403, 'Join this community to view its feed.');
    }
    const category = params.get('category') || undefined;
    if (category && !CATEGORIES.includes(category as typeof CATEGORIES[number])) throw new HttpError(400, 'Invalid category.');
    return json(await readPosts(user.userId, {
      page: Number(params.get('page') || 1),
      groupId,
      category,
      query: params.get('q') || undefined,
      sort: params.get('sort') || 'latest',
    }));
  } catch (error) {
    return fail(error);
  }
}

const writeSchema = z.object({
  action: z.enum(['create-post','edit-post','delete-post','create-comment','edit-comment','delete-comment','react','save','unsave','join-group','leave-group','report']),
  body: z.string().optional(),
  category: z.enum(CATEGORIES).optional(),
  groupId: z.string().optional(),
  postId: z.string().optional(),
  commentId: z.string().optional(),
  parentId: z.string().nullable().optional(),
  reaction: z.enum(['like','helpful']).optional(),
  reason: z.enum(['spam','scam','sensitive-information','harassment','misinformation','other']).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    guard(request);
    const user = await identity();
    await ensureCommunityAccess(user.userId);
    await profileIdForOwner(db(), user.userId);
    await rateLimit(user.userId, 'community-write', 45);
    const input = writeSchema.parse(await readJson(request, 8000));
    const stamp = now();
    const database = db();

    if (input.action === 'create-post') {
      await ensureCommunityAccess(user.userId, 'post');
      const body = safeCommunityText(input.body || '');
      if (body.length > 5000) throw new HttpError(400, 'Posts can contain up to 5,000 characters.');
      if (input.groupId) {
        const member = await database.prepare(
          "SELECT 1 AS ok FROM community_group_members WHERE group_id=? AND user_id=? AND status='active'"
        ).bind(input.groupId, user.userId).first();
        if (!member) throw new HttpError(403, 'Join the community before posting there.');
      }
      const id = uid();
      const expires = new Date(Date.parse(stamp) + 72 * 60 * 60 * 1000).toISOString();
      await database.prepare(
        "INSERT INTO community_posts(id,author_id,group_id,category,body,status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,'active',?,?,?)"
      ).bind(id, user.userId, input.groupId || null, input.category || 'General Discussion', body, stamp, stamp, expires).run();
      return json({ ok: true, id, expiresAt: expires }, 201);
    }

    if (input.action === 'create-comment') {
      await ensureCommunityAccess(user.userId, 'comment');
      const postId = z.string().uuid().parse(input.postId);
      const post = await assertPostVisible(postId, user.userId);
      const body = safeCommunityText(input.body || '');
      if (body.length > 1500) throw new HttpError(400, 'Comments can contain up to 1,500 characters.');
      if (input.parentId) {
        const parent = await database.prepare(
          "SELECT id FROM community_comments WHERE id=? AND post_id=? AND parent_id IS NULL AND expires_at>?"
        ).bind(input.parentId, postId, stamp).first();
        if (!parent) throw new HttpError(404, 'The comment you are replying to is no longer available.');
      }
      const id = uid();
      const expires = new Date(Date.parse(stamp) + 24 * 60 * 60 * 1000).toISOString();
      await database.prepare(
        "INSERT INTO community_comments(id,post_id,author_id,parent_id,body,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?)"
      ).bind(id, postId, user.userId, input.parentId || null, body, stamp, stamp, expires).run();
      return json({ ok: true, id, expiresAt: expires, groupId: post.group_id }, 201);
    }

    if (input.action === 'edit-post') {
      const id = z.string().uuid().parse(input.postId);
      const body = safeCommunityText(input.body || '');
      if (body.length > 5000) throw new HttpError(400, 'Posts can contain up to 5,000 characters.');
      const result = await database.prepare(
        "UPDATE community_posts SET body=?,category=COALESCE(?,category),updated_at=? WHERE id=? AND author_id=? AND status='active' AND expires_at>?"
      ).bind(body, input.category || null, stamp, id, user.userId, stamp).run();
      if (!result.meta.changes) throw new HttpError(404, 'Post not found or no longer editable.');
      return json({ ok: true });
    }

    if (input.action === 'delete-post') {
      const id = z.string().uuid().parse(input.postId);
      const result = await database.prepare("DELETE FROM community_posts WHERE id=? AND author_id=?").bind(id, user.userId).run();
      if (!result.meta.changes) throw new HttpError(404, 'Post not found.');
      return json({ ok: true });
    }

    if (input.action === 'edit-comment') {
      const id = z.string().uuid().parse(input.commentId);
      const body = safeCommunityText(input.body || '');
      if (body.length > 1500) throw new HttpError(400, 'Comments can contain up to 1,500 characters.');
      const result = await database.prepare(
        "UPDATE community_comments SET body=?,updated_at=? WHERE id=? AND author_id=? AND expires_at>? AND EXISTS (SELECT 1 FROM community_posts p WHERE p.id=community_comments.post_id AND p.status='active' AND p.expires_at>?)"
      ).bind(body, stamp, id, user.userId, stamp, stamp).run();
      if (!result.meta.changes) throw new HttpError(404, 'Comment not found or no longer editable.');
      return json({ ok: true });
    }

    if (input.action === 'delete-comment') {
      const id = z.string().uuid().parse(input.commentId);
      const result = await database.prepare("DELETE FROM community_comments WHERE id IN (SELECT id FROM community_comments WHERE id=? AND author_id=?) OR parent_id IN (SELECT id FROM community_comments WHERE id=? AND author_id=?)").bind(id, user.userId, id, user.userId).run();
      if (!result.meta.changes) throw new HttpError(404, 'Comment not found.');
      return json({ ok: true });
    }

    if (input.action === 'react') {
      const postId = z.string().uuid().parse(input.postId);
      await assertPostVisible(postId, user.userId);
      if (!input.reaction) throw new HttpError(400, 'Choose Like or Helpful.');
      const old = await database.prepare(
        'SELECT reaction_type FROM community_reactions WHERE post_id=? AND user_id=?'
      ).bind(postId, user.userId).first<{reaction_type:string}>();
      if (old?.reaction_type === input.reaction) {
        await database.prepare('DELETE FROM community_reactions WHERE post_id=? AND user_id=?').bind(postId, user.userId).run();
        return json({ ok: true, reaction: null });
      }
      await database.prepare(
        'INSERT INTO community_reactions(post_id,user_id,reaction_type,created_at) VALUES(?,?,?,?) ON CONFLICT(post_id,user_id) DO UPDATE SET reaction_type=excluded.reaction_type,created_at=excluded.created_at'
      ).bind(postId, user.userId, input.reaction, stamp).run();
      return json({ ok: true, reaction: input.reaction });
    }

    if (input.action === 'save' || input.action === 'unsave') {
      const postId = z.string().uuid().parse(input.postId);
      await assertPostVisible(postId, user.userId);
      if (input.action === 'save') {
        await database.prepare('INSERT OR IGNORE INTO community_saved_posts(user_id,post_id,created_at) VALUES(?,?,?)').bind(user.userId, postId, stamp).run();
      } else {
        await database.prepare('DELETE FROM community_saved_posts WHERE user_id=? AND post_id=?').bind(user.userId, postId).run();
      }
      return json({ ok: true, saved: input.action === 'save' });
    }

    if (input.action === 'join-group') {
      const groupId = z.string().min(1).max(80).parse(input.groupId);
      const group = await database.prepare("SELECT join_mode FROM community_groups WHERE id=? AND status='active'").bind(groupId).first<{join_mode:string}>();
      if (!group) throw new HttpError(404, 'Community not found.');
      const status = group.join_mode === 'approval' ? 'pending' : 'active';
      await database.prepare('INSERT OR IGNORE INTO community_group_members(group_id,user_id,status,joined_at) VALUES(?,?,?,?)').bind(groupId, user.userId, status, stamp).run();
      const current = await database.prepare('SELECT status FROM community_group_members WHERE group_id=? AND user_id=?').bind(groupId, user.userId).first<{status:string}>();
      return json({ ok: true, membershipStatus: current?.status || status });
    }

    if (input.action === 'leave-group') {
      const groupId = z.string().min(1).max(80).parse(input.groupId);
      await database.prepare('DELETE FROM community_group_members WHERE group_id=? AND user_id=?').bind(groupId, user.userId).run();
      return json({ ok: true });
    }

    if (input.action === 'report') {
      const reason = z.enum(['spam','scam','sensitive-information','harassment','misinformation','other']).parse(input.reason);
      const postId = input.postId ? z.string().uuid().parse(input.postId) : null;
      const commentId = input.commentId ? z.string().uuid().parse(input.commentId) : null;
      if (!!postId === !!commentId) throw new HttpError(400, 'Report one post or one comment.');
      if (postId) await assertPostVisible(postId, user.userId);
      if (commentId) {
        const comment = await database.prepare(
          "SELECT c.post_id FROM community_comments c WHERE c.id=? AND c.expires_at>?"
        ).bind(commentId, stamp).first<{post_id:string}>();
        if (!comment) throw new HttpError(404, 'Comment not found.');
        await assertPostVisible(comment.post_id, user.userId);
      }
      const existing = await database.prepare(
        "SELECT id FROM community_reports WHERE reporter_id=? AND COALESCE(post_id,'')=COALESCE(?,'') AND COALESCE(comment_id,'')=COALESCE(?,'') AND status='open'"
      ).bind(user.userId, postId, commentId).first();
      if (!existing) await database.prepare(
        'INSERT INTO community_reports(id,reporter_id,post_id,comment_id,reason,status,created_at) VALUES(?,?,?,?,?,\'open\',?)'
      ).bind(uid(), user.userId, postId, commentId, reason, stamp).run();
      return json({ ok: true });
    }

    throw new HttpError(400, 'Unsupported Banking Feed action.');
  } catch (error) {
    return fail(error);
  }
}
