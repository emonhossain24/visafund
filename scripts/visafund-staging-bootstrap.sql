CREATE TABLE IF NOT EXISTS `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`bank` text NOT NULL,
	`currency` text NOT NULL,
	`opening` integer NOT NULL,
	`date` text NOT NULL,
	`details` text NOT NULL,
	`created` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `accounts_owner` ON `accounts` (`owner`);
CREATE TABLE IF NOT EXISTS `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`entity` text NOT NULL,
	`action` text NOT NULL,
	`before` text,
	`after` text,
	`created` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `audit_owner` ON `audit` (`owner`,`created`);
CREATE TABLE IF NOT EXISTS `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`hash` text NOT NULL,
	`details` text NOT NULL,
	`created` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `documents_owner` ON `documents` (`owner`);
CREATE TABLE IF NOT EXISTS `records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `records_owner_kind` ON `records` (`owner`,`kind`);
CREATE TABLE IF NOT EXISTS `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`country` text NOT NULL,
	`data` text NOT NULL,
	`version` integer NOT NULL,
	`updated_by` text NOT NULL,
	`created` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `rules_country` ON `rules` (`country`);
CREATE TABLE IF NOT EXISTS `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`account` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`direction` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`details` text NOT NULL,
	`fingerprint` text,
	`transfer` text,
	`imported` integer DEFAULT 0 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`account`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX IF NOT EXISTS `tx_owner_date` ON `transactions` (`owner`,`date`);
CREATE INDEX IF NOT EXISTS `tx_account_date` ON `transactions` (`account`,`date`);
CREATE UNIQUE INDEX IF NOT EXISTS `tx_duplicate` ON `transactions` (`owner`,`fingerprint`);

CREATE TABLE IF NOT EXISTS `limits` (
	`id` text PRIMARY KEY NOT NULL,
	`stamp` integer NOT NULL,
	`count` integer NOT NULL
);


CREATE TABLE IF NOT EXISTS `platform_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`target` text,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`created` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `platform_audit_created` ON `platform_audit` (`created`);
CREATE TABLE IF NOT EXISTS `platform_content` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`updated` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `platform_content_kind_status` ON `platform_content` (`kind`,`status`);
CREATE TABLE IF NOT EXISTS `platform_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created` text NOT NULL,
	`last_seen` text NOT NULL,
	`terms_version` text,
	`preferences` text DEFAULT '{}' NOT NULL
);

CREATE INDEX IF NOT EXISTS `platform_users_status_created` ON `platform_users` (`status`,`created`);

CREATE TABLE IF NOT EXISTS `platform_deletion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`target` text NOT NULL,
	`status` text NOT NULL,
	`eligible_after` text NOT NULL,
	`created` text NOT NULL,
	`policy_version` text NOT NULL,
	`requested_by` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `platform_deletion_jobs_status` ON `platform_deletion_jobs` (`status`,`eligible_after`);

CREATE TABLE IF NOT EXISTS `auth_flows` (
	`hash` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`session` text NOT NULL,
	`purpose` text NOT NULL,
	`expires` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `auth_flows_expiry` ON `auth_flows` (`expires`);
CREATE TABLE IF NOT EXISTS `auth_identities` (
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`owner` text NOT NULL,
	`created` text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `auth_identity_subject` ON `auth_identities` (`issuer`,`subject`);
CREATE UNIQUE INDEX IF NOT EXISTS `auth_identity_owner` ON `auth_identities` (`issuer`,`owner`);

CREATE TABLE IF NOT EXISTS `exchange_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`retry_after` integer DEFAULT 0 NOT NULL
);


CREATE TABLE IF NOT EXISTS `platform_roles` (
	`owner` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'USER' NOT NULL CHECK (`role` IN ('USER','SUPER_ADMIN')),
	`provisioned_by` text DEFAULT 'registration' NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `platform_users`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE IF NOT EXISTS `auth_revoked_sessions` (
	`issuer` text NOT NULL,
	`session` text NOT NULL,
	`subject` text NOT NULL,
	`created` text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `revoked_session_key` ON `auth_revoked_sessions` (`issuer`,`session`);

INSERT OR IGNORE INTO platform_roles(owner,role,provisioned_by,created) SELECT id,'USER','migration',created FROM platform_users;
CREATE TABLE IF NOT EXISTS platform_profile_ids(
 id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
 owner TEXT NOT NULL,
 created TEXT NOT NULL,
 FOREIGN KEY(owner) REFERENCES platform_users(id) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS profile_owner_unique ON platform_profile_ids(owner);
INSERT INTO sqlite_sequence(name,seq)
SELECT 'platform_profile_ids',7049
WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='platform_profile_ids');
INSERT OR IGNORE INTO platform_profile_ids(owner,created)
SELECT id,created FROM platform_users ORDER BY created,id;


SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' ORDER BY name;


-- Banking Feed schema (same additive migration as drizzle/0008_banking_feed.sql)
CREATE TABLE IF NOT EXISTS community_groups(id TEXT PRIMARY KEY NOT NULL,slug TEXT NOT NULL UNIQUE,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',join_mode TEXT NOT NULL DEFAULT 'open',status TEXT NOT NULL DEFAULT 'active',created_by TEXT REFERENCES platform_users(id) ON DELETE SET NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS community_groups_status ON community_groups(status);
CREATE TABLE IF NOT EXISTS community_posts(id TEXT PRIMARY KEY NOT NULL,author_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,group_id TEXT REFERENCES community_groups(id) ON DELETE CASCADE,category TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS community_posts_feed ON community_posts(status,expires_at,created_at);
CREATE INDEX IF NOT EXISTS community_posts_author ON community_posts(author_id,expires_at);
CREATE INDEX IF NOT EXISTS community_posts_group ON community_posts(group_id,status,expires_at);
CREATE INDEX IF NOT EXISTS community_posts_category ON community_posts(category,status,expires_at);
CREATE TABLE IF NOT EXISTS community_comments(id TEXT PRIMARY KEY NOT NULL,post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,author_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,parent_id TEXT REFERENCES community_comments(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS community_comments_post ON community_comments(post_id,expires_at,created_at);
CREATE INDEX IF NOT EXISTS community_comments_author ON community_comments(author_id,expires_at);
CREATE INDEX IF NOT EXISTS community_comments_parent ON community_comments(parent_id);
CREATE INDEX IF NOT EXISTS community_comments_expiry ON community_comments(expires_at);
CREATE TABLE IF NOT EXISTS community_reactions(post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,reaction_type TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(post_id,user_id));
CREATE INDEX IF NOT EXISTS community_reactions_post ON community_reactions(post_id,reaction_type);
CREATE TABLE IF NOT EXISTS community_saved_posts(user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(user_id,post_id));
CREATE INDEX IF NOT EXISTS community_saved_posts_user ON community_saved_posts(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS community_group_members(group_id TEXT NOT NULL REFERENCES community_groups(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'active',joined_at TEXT NOT NULL,PRIMARY KEY(group_id,user_id));
CREATE INDEX IF NOT EXISTS community_group_members_user ON community_group_members(user_id,status);
CREATE TABLE IF NOT EXISTS community_reports(id TEXT PRIMARY KEY NOT NULL,reporter_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,post_id TEXT REFERENCES community_posts(id) ON DELETE CASCADE,comment_id TEXT REFERENCES community_comments(id) ON DELETE CASCADE,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL,reviewed_by TEXT,reviewed_at TEXT,CHECK((post_id IS NOT NULL AND comment_id IS NULL) OR (post_id IS NULL AND comment_id IS NOT NULL)));
CREATE INDEX IF NOT EXISTS community_reports_status ON community_reports(status,created_at DESC);
CREATE TABLE IF NOT EXISTS community_user_controls(user_id TEXT PRIMARY KEY NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'active',posting_disabled INTEGER NOT NULL DEFAULT 0,commenting_disabled INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL DEFAULT '',updated_by TEXT,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS community_user_controls_status ON community_user_controls(status);
CREATE TABLE IF NOT EXISTS community_moderation_logs(id TEXT PRIMARY KEY NOT NULL,actor_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,target_user TEXT,target_ref TEXT,action TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS community_moderation_logs_created ON community_moderation_logs(created_at DESC);
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
