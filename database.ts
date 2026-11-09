import Database from 'better-sqlite3';

const db: Database.Database = new Database('app.db', { verbose: console.log });

db.exec(`
  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bitrix_id INTEGER,
    login TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    department_id INTEGER,
    FOREIGN KEY (department_id) REFERENCES departments(id)
  );

  CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bitrix_call_id INTEGER UNIQUE NOT NULL,
    manager_id INTEGER,
    direction TEXT,
    duration_seconds INTEGER,
    started_at DATETIME,
    owner_type TEXT,
    owner_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bitrix_lead_id INTEGER UNIQUE NOT NULL,
    segmentation TEXT,
    base_id INTEGER,
    product_id INTEGER,
    inn TEXT,
    status_id TEXT,
    manager_id INTEGER,
    is_quality BOOLEAN DEFAULT 0,
    refusal_reason_id INTEGER,
    created_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bitrix_deal_id INTEGER UNIQUE NOT NULL,
    lead_id INTEGER,
    manager_id INTEGER,
    inn TEXT,
    tm_mark BOOLEAN DEFAULT 0,
    stage_id TEXT,
    products_list TEXT,
    product_field TEXT,
    amount REAL DEFAULT 0,
    payment_source TEXT,
    okved TEXT,
    created_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS bases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    main_product_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    entity TEXT
  );

  CREATE TABLE IF NOT EXISTS refusal_reasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS okved (
    code TEXT PRIMARY KEY,
    name TEXT
  );

  CREATE TABLE IF NOT EXISTS daily_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    manager_id INTEGER,
    base_id INTEGER,
    product_id INTEGER,
    work_type TEXT,
    total_calls INTEGER DEFAULT 0,
    valid_conversations INTEGER DEFAULT 0,
    unique_leads INTEGER DEFAULT 0,
    quality_leads INTEGER DEFAULT 0,
    transfers INTEGER DEFAULT 0,
    paid_deals INTEGER DEFAULT 0,
    amount_sum REAL DEFAULT 0,
    UNIQUE(date, manager_id, base_id, product_id, work_type)
  );
`);

console.log("База данных и таблицы успешно созданы!");

export default db;