-- OLX Car Finder Database Schema

-- Saved searches from OLX
CREATE TABLE IF NOT EXISTS saved_searches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    human_url TEXT NOT NULL,
    check_period_minutes INTEGER DEFAULT 60,
    model_whitelist TEXT DEFAULT '[]',  -- JSON array
    model_blacklist TEXT DEFAULT '[]',  -- JSON array
    ignored_brands TEXT DEFAULT '[]',   -- JSON array of ignored brands
    ignored_models TEXT DEFAULT '[]',   -- JSON array of ignored models
    opportunity_weights TEXT DEFAULT '{"price":70,"km":20,"recency":10}',
    min_group_size INTEGER DEFAULT 5,
    last_checked_at TEXT,
    last_sp_scanned INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Seen listing IDs per search (cap 2000 per search)
CREATE TABLE IF NOT EXISTS seen_ids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    search_id TEXT NOT NULL,
    list_id TEXT NOT NULL,
    first_seen_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (search_id) REFERENCES saved_searches(id) ON DELETE CASCADE,
    UNIQUE(search_id, list_id)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_seen_ids_search ON seen_ids(search_id);
CREATE INDEX IF NOT EXISTS idx_seen_ids_list ON seen_ids(search_id, list_id);

-- Alerts for new listings
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    search_id TEXT NOT NULL,
    list_id TEXT NOT NULL,
    subject TEXT,
    price TEXT,
    municipality TEXT,
    neighbourhood TEXT,
    ad_url TEXT,
    model TEXT,
    thumbnail_url TEXT,
    status TEXT DEFAULT 'new',  -- new, opened, muted
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (search_id) REFERENCES saved_searches(id) ON DELETE CASCADE
);

-- Index for efficient alert queries
CREATE INDEX IF NOT EXISTS idx_alerts_search ON alerts(search_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);

-- Listings cache (optional, for model aggregation)
CREATE TABLE IF NOT EXISTS listings (
    list_id TEXT PRIMARY KEY,
    search_id TEXT NOT NULL,
    subject TEXT,
    price TEXT,
    municipality TEXT,
    neighbourhood TEXT,
    ad_url TEXT,
    model TEXT,
    date_ts TEXT,
    thumbnail_url TEXT,
    collected_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (search_id) REFERENCES saved_searches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_listings_search ON listings(search_id);
CREATE INDEX IF NOT EXISTS idx_listings_model ON listings(model);
