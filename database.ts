import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';

const db: Database.Database = new Database('app.db', { verbose: console.log });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const DEAL_PRODUCTS_DDL = `
CREATE TABLE IF NOT EXISTS deal_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bitrix_row_id INTEGER,
    bitrix_deal_id INTEGER NOT NULL,
    bitrix_product_id INTEGER,
    product_name TEXT NOT NULL,
    product_group TEXT,
    quantity REAL DEFAULT 1,
    price REAL DEFAULT 0,
    sum REAL DEFAULT 0,
    currency TEXT DEFAULT 'RUB',
    is_cross_sale BOOLEAN DEFAULT 0,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bitrix_deal_id) REFERENCES deals(bitrix_deal_id) ON DELETE CASCADE
)`;

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
    is_cross_sale BOOLEAN DEFAULT 0,
    dadata_enriched BOOLEAN DEFAULT 0,
    created_at DATETIME,
    stage_changed_at DATETIME,
    last_activity_at DATETIME
);

${DEAL_PRODUCTS_DDL};
CREATE TABLE IF NOT EXISTS companies (
    inn TEXT PRIMARY KEY,
    company_name TEXT,
    okved TEXT,
    okved_name TEXT,
    okved_type TEXT,
    dadata_found BOOLEAN DEFAULT 0,
    enriched_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts DATETIME DEFAULT CURRENT_TIMESTAMP,
    entity TEXT NOT NULL,
    status TEXT NOT NULL,
    processed INTEGER DEFAULT 0,
    duration_ms INTEGER,
    message TEXT
);

CREATE TABLE IF NOT EXISTS bases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    main_product_id INTEGER
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    bitrix_id INTEGER,
    product_group TEXT
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

function tableInfo(table: string): any[] {
    try {
        return db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    } catch (e) {
        return [];
    }
}

function ensureColumns(table: string, expected: Record<string, string>): void {
    const cols = tableInfo(table);
    if (cols.length === 0) return;
    const existing = new Set(cols.map((c: any) => c.name));
    for (const [name, type] of Object.entries(expected)) {
        if (existing.has(name)) continue;
        try {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
            console.log(`🔧 ${table}: добавлена колонка ${name}`);
        } catch (e: any) {
            console.error(`⚠️ Не удалось добавить ${table}.${name}: ${e.message}`);
        }
    }
}

ensureColumns('users', {
    bitrix_id: 'INTEGER',
    department_id: 'INTEGER',
    qualification: "TEXT DEFAULT 'обычный'"
});

ensureColumns('calls', {
    manager_id: 'INTEGER',
    direction: 'TEXT',
    duration_seconds: 'INTEGER',
    started_at: 'DATETIME',
    owner_type: 'TEXT',
    owner_id: 'INTEGER'
});

ensureColumns('leads', {
    segmentation: 'TEXT',
    base_id: 'INTEGER',
    product_id: 'INTEGER',
    inn: 'TEXT',
    status_id: 'TEXT',
    status_semantic: 'TEXT',
    manager_id: 'INTEGER',
    is_quality: 'BOOLEAN DEFAULT 0',
    refusal_reason_id: 'INTEGER',
    created_at: 'DATETIME',
    last_activity_at: 'DATETIME'
});

ensureColumns('deals', {
    lead_id: 'INTEGER',
    manager_id: 'INTEGER',
    inn: 'TEXT',
    company_title: 'TEXT',
    tm_mark: 'BOOLEAN DEFAULT 0',
    category_id: 'INTEGER',
    category_name: 'TEXT',
    stage_id: 'TEXT',
    stage_name: 'TEXT',
    stage_semantic: 'TEXT',
    products_list: 'TEXT',
    product_field: 'TEXT',
    amount: 'REAL DEFAULT 0',
    payment_source: 'TEXT',
    okved: 'TEXT',
    is_cross_sale: 'BOOLEAN DEFAULT 0',
    dadata_enriched: 'BOOLEAN DEFAULT 0',
    created_at: 'DATETIME',
    stage_changed_at: 'DATETIME',
    last_activity_at: 'DATETIME'
});

ensureColumns('products', {
    bitrix_id: 'INTEGER',
    product_group: 'TEXT'
});

ensureColumns('bases', {
    main_product_id: 'INTEGER'
});

ensureColumns('companies', {
    company_name: 'TEXT',
    okved: 'TEXT',
    okved_name: 'TEXT',
    okved_type: 'TEXT',
    dadata_found: 'BOOLEAN DEFAULT 0',
    enriched_at: 'DATETIME',
    created_at: 'DATETIME'
});

ensureColumns('sync_log', {
    ts: 'DATETIME',
    entity: 'TEXT',
    status: 'TEXT',
    processed: 'INTEGER DEFAULT 0',
    duration_ms: 'INTEGER',
    message: 'TEXT'
});

ensureColumns('daily_stats', {
    manager_id: 'INTEGER',
    base_id: 'INTEGER',
    product_id: 'INTEGER',
    work_type: 'TEXT',
    total_calls: 'INTEGER DEFAULT 0',
    valid_conversations: 'INTEGER DEFAULT 0',
    unique_leads: 'INTEGER DEFAULT 0',
    quality_leads: 'INTEGER DEFAULT 0',
    transfers: 'INTEGER DEFAULT 0',
    paid_deals: 'INTEGER DEFAULT 0',
    amount_sum: 'REAL DEFAULT 0'
});

ensureColumns('plans', {
    working_days: 'INTEGER DEFAULT 21',
    calls_norm: 'INTEGER DEFAULT 0',
    leads_norm: 'INTEGER DEFAULT 0'
});

ensureColumns('conversion_rules', {
    calc_type: 'TEXT',
    product_type: "TEXT DEFAULT 'all'",
    cycle_type: "TEXT DEFAULT 'all'",
    excluded_statuses: "TEXT DEFAULT '[\"IMPORT\"]'",
    version: 'INTEGER DEFAULT 1'
});

const DP_EXPECTED = [
    'bitrix_row_id', 'bitrix_deal_id', 'bitrix_product_id', 'product_name',
    'product_group', 'quantity', 'price', 'sum', 'currency', 'is_cross_sale', 'synced_at'
];
const DP_FILLED = [
    'bitrix_row_id', 'bitrix_deal_id', 'bitrix_product_id', 'product_name',
    'product_group', 'quantity', 'price', 'sum', 'currency', 'is_cross_sale'
];

try {
    const dpCols = tableInfo('deal_products');
    if (dpCols.length > 0) {
        const names = dpCols.map((c: any) => c.name);
        const missing = DP_EXPECTED.filter(c => !names.includes(c));
        const blockers = dpCols.filter((c: any) =>
            c.notnull === 1 && c.dflt_value === null && c.name !== 'id' && !DP_FILLED.includes(c.name)
        ).map((c: any) => c.name);

        if (missing.length > 0 || blockers.length > 0) {
            const legacy = db.prepare(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='deal_products'"
            ).get() as any;
            console.log('⚠️ Структура deal_products не совпадает с текущей схемой.');
            if (missing.length) console.log('   Нет колонок:', missing.join(', '));
            if (blockers.length) console.log('   Мешают NOT NULL колонки:', blockers.join(', '));
            console.log('   Текущая структура:', legacy?.sql);

            db.exec('DROP INDEX IF EXISTS idx_deal_products_row');
            db.exec('DROP INDEX IF EXISTS idx_deal_products_deal');

            try {
                db.exec('ALTER TABLE deal_products RENAME TO deal_products_legacy');
                console.log('📦 Старая таблица сохранена как deal_products_legacy');
            } catch (e) {
                db.exec('DROP TABLE deal_products');
                console.log('🗑️ Старая таблица deal_products удалена');
            }

            db.exec(DEAL_PRODUCTS_DDL);
            const reset = db.prepare('UPDATE deals SET products_list = NULL, is_cross_sale = 0').run();
            console.log(`✅ deal_products пересоздана. Товары перезагрузятся для ${reset.changes} сделок`);
        }
    }
} catch (e: any) {
    console.error('⚠️ Проверка структуры deal_products:', e.message);
}

try {
    const duplicated = db.prepare(`
        SELECT bitrix_row_id FROM deal_products
        WHERE bitrix_row_id IS NOT NULL
        GROUP BY bitrix_row_id HAVING COUNT(*) > 1
    `).all() as any[];

    if (duplicated.length > 0) {
        const affectedDeals = db.prepare(`
            SELECT DISTINCT bitrix_deal_id FROM deal_products
            WHERE bitrix_row_id IN (
                SELECT bitrix_row_id FROM deal_products
                WHERE bitrix_row_id IS NOT NULL
                GROUP BY bitrix_row_id HAVING COUNT(*) > 1
            )
        `).all() as any[];

        db.transaction(() => {
            const info = db.prepare(`
                DELETE FROM deal_products
                WHERE bitrix_row_id IS NOT NULL
                  AND id NOT IN (
                      SELECT MAX(id) FROM deal_products
                      WHERE bitrix_row_id IS NOT NULL
                      GROUP BY bitrix_row_id
                  )
            `).run();
            const reset = db.prepare('UPDATE deals SET products_list = NULL WHERE bitrix_deal_id = ?');
            for (const d of affectedDeals) reset.run(d.bitrix_deal_id);
            console.log(`🧹 deal_products: удалено дублей ${info.changes}; товары перезагрузятся для ${affectedDeals.length} сделок`);
        })();
    }

    const orphans = db.prepare(`
        DELETE FROM deal_products
        WHERE bitrix_deal_id NOT IN (SELECT bitrix_deal_id FROM deals)
    `).run();
    if (orphans.changes > 0) console.log(`🧹 deal_products: удалено товаров без сделки — ${orphans.changes}`);

    const badDept = db.prepare(`
        UPDATE users SET department_id = NULL
        WHERE department_id IS NOT NULL AND department_id NOT IN (SELECT id FROM departments)
    `).run();
    if (badDept.changes > 0) console.log(`🧹 users: сброшены несуществующие отделы у ${badDept.changes} сотрудников`);

    const badRules = db.prepare(`
        DELETE FROM conversion_rules WHERE base_id NOT IN (SELECT id FROM bases)
    `).run();
    if (badRules.changes > 0) console.log(`🧹 conversion_rules: удалено правил без базы — ${badRules.changes}`);
} catch (e: any) {
    console.error('⚠️ Очистка данных пропущена:', e.message);
}


const indexes = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_products_row ON deal_products(bitrix_row_id) WHERE bitrix_row_id IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_deal_products_deal ON deal_products(bitrix_deal_id)',
    'CREATE INDEX IF NOT EXISTS idx_deals_inn ON deals(inn)',
    'CREATE INDEX IF NOT EXISTS idx_deals_manager ON deals(manager_id)',
    'CREATE INDEX IF NOT EXISTS idx_deals_semantic ON deals(stage_semantic)',
    'CREATE INDEX IF NOT EXISTS idx_leads_inn ON leads(inn)',
    'CREATE INDEX IF NOT EXISTS idx_leads_manager ON leads(manager_id)',
    'CREATE INDEX IF NOT EXISTS idx_calls_owner ON calls(owner_type, owner_id)',
    'CREATE INDEX IF NOT EXISTS idx_calls_manager ON calls(manager_id)',
    'CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date)',
    'CREATE INDEX IF NOT EXISTS idx_deals_lead_id ON deals(lead_id)',
    'CREATE INDEX IF NOT EXISTS idx_deals_created_at ON deals(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_deals_stage_semantic ON deals(stage_semantic)',
    'CREATE INDEX IF NOT EXISTS idx_deals_manager_id ON deals(manager_id)',
    'CREATE INDEX IF NOT EXISTS idx_deals_inn ON deals(inn)',
    
    'CREATE INDEX IF NOT EXISTS idx_leads_base_id ON leads(base_id)',
    'CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_leads_status_semantic ON leads(status_semantic)',
    'CREATE INDEX IF NOT EXISTS idx_leads_manager_id ON leads(manager_id)',
    'CREATE INDEX IF NOT EXISTS idx_leads_inn ON leads(inn)',
    
    'CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at)',
    'CREATE INDEX IF NOT EXISTS idx_calls_manager_id ON calls(manager_id)',
    'CREATE INDEX IF NOT EXISTS idx_calls_owner ON calls(owner_type, owner_id)',
    
    'CREATE INDEX IF NOT EXISTS idx_users_bitrix_id ON users(bitrix_id)',
    
    'CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date)',
    'CREATE INDEX IF NOT EXISTS idx_daily_stats_manager ON daily_stats(manager_id)',
    'CREATE INDEX IF NOT EXISTS idx_daily_stats_base ON daily_stats(base_id)',
    
    'CREATE INDEX IF NOT EXISTS idx_deal_products_deal_id ON deal_products(bitrix_deal_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_products_row_id ON deal_products(bitrix_row_id) WHERE bitrix_row_id IS NOT NULL'
];

for (const sql of indexes) {
    try {
        db.exec(sql);
    } catch (e: any) {
        console.error(`⚠️ Не удалось создать индекс: ${e.message}\nSQL: ${sql}`);
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

const dpFinal = tableInfo('deal_products').map((c: any) => c.name);
const dpIndexes = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='deal_products' AND name NOT LIKE 'sqlite_%'"
).all() as any[];
console.log('📋 deal_products, колонки:', dpFinal.join(', '));
console.log('📋 deal_products, индексы:', dpIndexes.map((i: any) => i.name).join(', ') || 'нет');

console.log("✅ База данных и таблицы успешно инициализированы!");
export default db;