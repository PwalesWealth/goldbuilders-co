-- GoldBuilders Live Forms schema (SQLite; server.js creates these automatically)
CREATE TABLE IF NOT EXISTS contact_leads (
 id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, organization TEXT, email TEXT NOT NULL,
 phone TEXT, industry TEXT, timeline TEXT, service TEXT, message TEXT, consent INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS skeelup_registrations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, location TEXT,
 status TEXT, course TEXT, goal TEXT, experience TEXT, consent INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS assessment_results (
 id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE NOT NULL, organization TEXT, email TEXT,
 strategy INTEGER NOT NULL, people INTEGER NOT NULL, revenue INTEGER NOT NULL, finance INTEGER NOT NULL,
 technology INTEGER NOT NULL, operations INTEGER NOT NULL, brand INTEGER NOT NULL, score INTEGER NOT NULL,
 tier TEXT NOT NULL, recommendations_json TEXT, consent INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nexora_leads (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 full_name TEXT NOT NULL,
 email TEXT NOT NULL,
 phone TEXT NOT NULL,
 package TEXT NOT NULL,
 goals TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS luxestreams_club_leads (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 full_name TEXT NOT NULL,
 email TEXT NOT NULL,
 phone TEXT NOT NULL,
 city TEXT,
 member_type TEXT NOT NULL,
 services_json TEXT NOT NULL,
 timeline TEXT NOT NULL,
 details TEXT,
 consent INTEGER NOT NULL DEFAULT 0,
 marketing_consent INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
