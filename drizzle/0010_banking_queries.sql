CREATE TABLE banking_queries (
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
);
CREATE INDEX banking_queries_published_sort ON banking_queries(status,sort_order,updated_at);
CREATE TABLE banking_query_helpful (
  query_id TEXT NOT NULL REFERENCES banking_queries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(query_id,user_id)
);
CREATE INDEX banking_query_helpful_user ON banking_query_helpful(user_id,created_at);
