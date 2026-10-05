CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  rank TEXT,
  grade TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  background TEXT NOT NULL DEFAULT 'default',
  avatar TEXT,
  "mutedUntil" BIGINT NOT NULL DEFAULT 0,
  "bannedUntil" BIGINT NOT NULL DEFAULT 0,
  "banReason" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_records (
  id UUID PRIMARY KEY,
  collection TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_records_collection_idx ON app_records (collection);

CREATE TABLE IF NOT EXISTS storage_objects (
  bucket TEXT NOT NULL,
  path TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket, path)
);