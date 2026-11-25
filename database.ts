import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';

const db: Database.Database = new Database('app.db', { verbose: console.log });

db.pragma('journal_mode = WAL');

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
    qualification TEXT DEFAULT 'обычный',
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
    status_semantic TEXT,
    manager_id INTEGER,
    is_quality BOOLEAN DEFAULT 0,
    refusal_reason_id INTEGER,
    created_at DATETIME,
    last_activity_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bitrix_deal_id INTEGER UNIQUE NOT NULL,
    lead_id INTEGER,
    manager_id INTEGER,
    inn TEXT,
    company_title TEXT,
    tm_mark BOOLEAN DEFAULT 0,
    category_id INTEGER,
    category_name TEXT,
    stage_id TEXT,
    stage_name TEXT,
    stage_semantic TEXT,
    products_list TEXT,
    product_field TEXT,
    amount REAL DEFAULT 0,
    payment_source TEXT,
    okved TEXT,
    created_at DATETIME,
    stage_changed_at DATETIME,
    last_activity_at DATETIME
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

  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manager_id INTEGER,
    month TEXT NOT NULL,
    working_days INTEGER DEFAULT 21,
    calls_norm INTEGER DEFAULT 0,
    leads_norm INTEGER DEFAULT 0,
    UNIQUE(manager_id, month)
  );

  CREATE TABLE IF NOT EXISTS conversion_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_id INTEGER UNIQUE NOT NULL,
    numerator TEXT NOT NULL,
    denominator TEXT NOT NULL,
    calc_type TEXT NOT NULL,
    product_type TEXT DEFAULT 'all',
    cycle_type TEXT DEFAULT 'all',
    excluded_statuses TEXT DEFAULT '["IMPORT"]',
    version INTEGER DEFAULT 1,
    FOREIGN KEY (base_id) REFERENCES bases(id) ON DELETE CASCADE
  );
`);

const safeMigrations = [
  'ALTER TABLE leads ADD COLUMN last_activity_at DATETIME',
  'ALTER TABLE deals ADD COLUMN last_activity_at DATETIME',
  'ALTER TABLE deals ADD COLUMN stage_semantic TEXT',
  'ALTER TABLE deals ADD COLUMN stage_name TEXT',
  'ALTER TABLE deals ADD COLUMN category_id INTEGER',
  'ALTER TABLE deals ADD COLUMN category_name TEXT',
  'ALTER TABLE deals ADD COLUMN company_title TEXT',
  'ALTER TABLE deals ADD COLUMN stage_changed_at DATETIME'
];

for (const sql of safeMigrations) {
  try {
    db.exec(sql);
  } catch (e) {
  }
}

const adminExists = db.prepare("SELECT id FROM users WHERE login = 'DIRECTOR'").get();
if (!adminExists) {
    try {
        const hash = bcrypt.hashSync('qwerty123', 10);
        db.prepare(`
            INSERT INTO users (login, password_hash, role) 
            VALUES (?, ?, ?)
        `).run('DIRECTOR', hash, 'DIRECTOR');
        console.log("✅ Учетная запись DIRECTOR (пароль: qwerty123) успешно создана!");
    } catch (err: any) {
        console.error("❌ Ошибка при создании администратора:", err.message);
    }
}

console.log("✅ База данных и таблицы успешно инициализированы!");

export default db;