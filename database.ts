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
    refusal_reason_id INTEGER
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
    okved TEXT
  );
`);

console.log("База данных и таблицы успешно созданы!");

export default db;