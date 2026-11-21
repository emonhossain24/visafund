-- Lightweight, text-only Banking Feed. Content expires at creation + 72h / 24h.
CREATE TABLE community_groups (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  join_mode TEXT NOT NULL DEFAULT 'open' CHECK (join_mode IN ('open','approval')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX community_groups_slug_unique ON community_groups(slug);
CREATE INDEX community_groups_status ON community_groups(status);

CREATE TABLE community_posts (
  id TEXT PRIMARY KEY NOT NULL,
  author_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES community_groups(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX community_posts_feed ON community_posts(status, expires_at, created_at);
CREATE INDEX community_posts_author ON community_posts(author_id, expires_at);
CREATE INDEX community_posts_group ON community_posts(group_id, status, expires_at);
CREATE INDEX community_posts_category ON community_posts(category, status, expires_at);

CREATE TABLE community_comments (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES community_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1500),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX community_comments_post ON community_comments(post_id, expires_at, created_at);
CREATE INDEX community_comments_author ON community_comments(author_id, expires_at);
CREATE INDEX community_comments_parent ON community_comments(parent_id);
CREATE INDEX community_comments_expiry ON community_comments(expires_at);

CREATE TABLE community_reactions (
  post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL CHECK (reaction_type IN ('like','helpful')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX community_reactions_post ON community_reactions(post_id, reaction_type);

CREATE TABLE community_saved_posts (
  user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX community_saved_posts_user ON community_saved_posts(user_id, created_at DESC);

CREATE TABLE community_group_members (
  group_id TEXT NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX community_group_members_user ON community_group_members(user_id, status);

CREATE TABLE community_reports (
  id TEXT PRIMARY KEY NOT NULL,
  reporter_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  post_id TEXT REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES community_comments(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored')),
  created_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  CHECK ((post_id IS NOT NULL AND comment_id IS NULL) OR (post_id IS NULL AND comment_id IS NOT NULL))
);
CREATE INDEX community_reports_status ON community_reports(status, created_at DESC);

CREATE TABLE community_user_controls (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','banned')),
  posting_disabled INTEGER NOT NULL DEFAULT 0,
  commenting_disabled INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX community_user_controls_status ON community_user_controls(status);

CREATE TABLE community_moderation_logs (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  target_user TEXT,
  target_ref TEXT,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX community_moderation_logs_created ON community_moderation_logs(created_at DESC);

INSERT OR IGNORE INTO community_groups(id,slug,name,description,join_mode,status,created_at,updated_at) VALUES
('community-bank-account','bank-account','Bank Account','Opening, maintaining, and managing student bank accounts.','open','active',datetime('now'),datetime('now')),
('community-bank-statement','bank-statement','Bank Statement','Statement format, transaction history, and evidence questions.','open','active',datetime('now'),datetime('now')),
('community-bank-solvency','bank-solvency','Bank Solvency','Bank solvency certificates and balance confirmation.','open','active',datetime('now'),datetime('now')),
('community-bank-transactions','bank-transactions','Bank Transactions','Deposits, transfers, transaction history, and holding periods.','open','active',datetime('now'),datetime('now')),
('community-education-loan','education-loan','Education Loan','Education loans and student financing discussions.','open','active',datetime('now'),datetime('now')),
('community-fdr-dps','fdr-dps','FDR / DPS','Fixed deposits, DPS, and related bank documentation.','open','active',datetime('now'),datetime('now')),
('community-financial-documents','financial-documents','Financial Documents','Organizing genuine financial documents for applications.','open','active',datetime('now'),datetime('now')),
('community-bank-issues','bank-issues','Bank Issues','Banking service problems and general guidance.','open','active',datetime('now'),datetime('now')),
('community-general','general-discussion','General Discussion','General study-abroad funding and banking discussions.','open','active',datetime('now'),datetime('now'));
