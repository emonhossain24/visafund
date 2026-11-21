CREATE TABLE banking_hub_content (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('event','premium','advisor','resource','country')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  meeting_url TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  starts_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  duration_minutes INTEGER,
  fee_amount INTEGER,
  fee_currency TEXT NOT NULL DEFAULT 'BDT',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  access_level TEXT NOT NULL DEFAULT 'locked' CHECK (access_level IN ('public','locked')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX banking_hub_kind_status ON banking_hub_content(kind,status,sort_order);
CREATE INDEX banking_hub_country ON banking_hub_content(country);
CREATE INDEX banking_hub_starts ON banking_hub_content(starts_at);
