-- The daily identifier is an HMAC, salted and rotated each UTC day.
-- No raw addresses, full user agents, referrer URLs, or query strings are stored.
CREATE TABLE analytics_visitors (
  day TEXT NOT NULL CHECK (length(day) = 10),
  visitor_id TEXT NOT NULL CHECK (length(visitor_id) = 64),
  PRIMARY KEY (day, visitor_id)
) WITHOUT ROWID;

CREATE TABLE analytics_metrics (
  day TEXT NOT NULL CHECK (length(day) = 10),
  path TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 512),
  referrer TEXT NOT NULL CHECK (length(referrer) BETWEEN 1 AND 253),
  country TEXT NOT NULL CHECK (length(country) = 2),
  device TEXT NOT NULL CHECK (device IN ('desktop', 'mobile', 'tablet')),
  views INTEGER NOT NULL DEFAULT 1 CHECK (views > 0),
  PRIMARY KEY (day, path, referrer, country, device)
) WITHOUT ROWID;
