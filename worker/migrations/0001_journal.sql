CREATE TABLE users (
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL,
 normalizedEmail TEXT NOT NULL UNIQUE,
 displayName TEXT NOT NULL,
 passwordHash TEXT NOT NULL,
 failedAttempts INTEGER NOT NULL DEFAULT 0,
 lockoutUntil INTEGER NOT NULL DEFAULT 0,
 createdAt TEXT NOT NULL
);
CREATE TABLE tracks (
 id TEXT PRIMARY KEY,
 userId TEXT NOT NULL REFERENCES users(id),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 description TEXT NOT NULL DEFAULT '',
 icon TEXT NOT NULL,
 color TEXT NOT NULL,
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
 createdAt TEXT NOT NULL
);
CREATE INDEX idx_tracks_user_archived ON tracks(userId,archived);
CREATE TABLE activities (
 id TEXT PRIMARY KEY,
 projectId TEXT NOT NULL REFERENCES tracks(id),
 date TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 description TEXT NOT NULL DEFAULT '',
 value REAL CHECK(value IS NULL OR (value >= 0 AND value <= 1000000000)),
 unit TEXT,
 createdAt TEXT NOT NULL,
 updatedAt TEXT NOT NULL
);
CREATE INDEX idx_activities_project_date ON activities(projectId,date DESC,createdAt DESC);
CREATE TABLE share_links (
 id TEXT PRIMARY KEY,
 projectId TEXT NOT NULL UNIQUE REFERENCES tracks(id),
 tokenHash TEXT NOT NULL UNIQUE,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 expiresAt TEXT,
 createdAt TEXT NOT NULL
);
CREATE TABLE sessions (
 tokenHash TEXT PRIMARY KEY,
 userId TEXT NOT NULL REFERENCES users(id),
 expiresAt INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expiry ON sessions(expiresAt);
CREATE TABLE auth_limits (
 key TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 expiresAt INTEGER NOT NULL
);
CREATE INDEX idx_auth_limits_expiry ON auth_limits(expiresAt);
