import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import db from './database';
import { registerSyncRoutes, runBackgroundSync, calculateDailyStats } from './sync';
import { registerAnalyticsRoutes } from './analytics';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'super-secret-key-123';
const SYNC_INTERVAL_MIN = Number(process.env.SYNC_INTERVAL_MIN) || 15;

const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена доступа' });
    jwt.verify(token, SECRET_KEY, (err: any, user: any) => {
        if (err) return res.status(403).json({ error: 'Токен недействителен' });
        req.user = user;
        next();
    });
};

const requireRole = (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Недостаточно прав для этого действия' });
    }
    next();
};

const trimOrNull = (v: any): string | null => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s || null;
};

function recalcCrossForBase(baseId: number): void {
    const main = db.prepare(`
        SELECT p.name, p.bitrix_id
        FROM bases b LEFT JOIN products p ON b.main_product_id = p.id
        WHERE b.id = ?
    `).get(baseId) as any;
    const mainName = main?.name ?? null;
    const mainBitrixId = main?.bitrix_id ?? null;

    db.transaction(() => {
        db.prepare(`
            UPDATE deal_products SET is_cross_sale = CASE
                WHEN ? IS NULL THEN 0
                WHEN ? IS NOT NULL AND bitrix_product_id = ? THEN 0
                WHEN norm_name(product_name) = norm_name(?) THEN 0
                ELSE 1
            END
            WHERE bitrix_deal_id IN (
                SELECT d.bitrix_deal_id FROM deals d
                JOIN leads l ON d.lead_id = l.bitrix_lead_id
                WHERE l.base_id = ?
            )
        `).run(mainName, mainBitrixId, mainBitrixId, mainName, baseId);

        db.prepare(`
            UPDATE deals SET is_cross_sale = COALESCE((
                SELECT MAX(dp.is_cross_sale) FROM deal_products dp
                WHERE dp.bitrix_deal_id = deals.bitrix_deal_id
            ), 0)
            WHERE bitrix_deal_id IN (
                SELECT d.bitrix_deal_id FROM deals d
                JOIN leads l ON d.lead_id = l.bitrix_lead_id
                WHERE l.base_id = ?
            )
        `).run(baseId);
    })();
}

app.post('/api/auth/login', async (req: any, res: any): Promise<any> => {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
    const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login) as any;
    if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Неверный пароль' });
    const token = jwt.sign(
        { id: user.id, role: user.role, bitrix_id: user.bitrix_id },
        SECRET_KEY,
        { expiresIn: '24h' }
    );
    res.json({
        message: 'Успешный вход', token, role: user.role,
        bitrix_id: user.bitrix_id, qualification: user.qualification || 'обычный'
    });
});

app.get('/api/users', (req: any, res: any) => {
    try {
        res.json(db.prepare(`
            SELECT u.id, u.bitrix_id, u.login, u.role, u.department_id,
                COALESCE(u.qualification, 'обычный') as qualification,
                d.name as department_name
            FROM users u
            LEFT JOIN departments d ON u.department_id = d.id
            WHERE u.role IN ('MANAGER', 'HEAD_OF_DEPT')
            ORDER BY u.login ASC
        `).all());
    } catch (e) {
        console.error('Ошибка получения пользователей:', e);
        res.status(500).json({ error: 'Ошибка получения пользователей' });
    }
});

app.post('/api/users', authenticateToken, async (req: any, res: any): Promise<any> => {
    const creatorRole = req.user.role;
    const { bitrix_id, login, password, role, department_id, qualification } = req.body;
    if (creatorRole === 'MANAGER') return res.status(403).json({ error: 'Нет прав на создание сотрудников' });
    if (creatorRole === 'HEAD_OF_DEPT' && role !== 'MANAGER') {
        return res.status(403).json({ error: 'Руководитель отдела может создавать только менеджеров' });
    }
    if (!login || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
    if (qualification && !['обычный', 'ведущий'].includes(qualification)) {
        return res.status(400).json({ error: 'Квалификация: обычный или ведущий' });
    }
    try {
        const hash = await bcrypt.hash(password, 10);
        db.prepare(`
            INSERT INTO users (bitrix_id, login, password_hash, role, department_id, qualification)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(bitrix_id || null, login, hash, role || 'MANAGER', department_id || null, qualification || 'обычный');
        res.json({ message: `Пользователь ${login} успешно создан` });
    } catch (err: any) {
        res.status(400).json({ error: 'Ошибка сохранения: ' + err.message });
    }
});

app.put('/api/users/:id', authenticateToken, requireRole('DIRECTOR', 'HEAD_OF_DEPT'), async (req: any, res: any): Promise<any> => {
    const id = Number(req.params.id);
    const { role, qualification, department_id, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!user) return res.status(404).json({ error: 'Сотрудник не найден' });
    if (role && req.user.role !== 'DIRECTOR') {
        return res.status(403).json({ error: 'Менять роль может только директор' });
    }
    if (qualification && !['обычный', 'ведущий'].includes(qualification)) {
        return res.status(400).json({ error: 'Квалификация: обычный или ведущий' });
    }
    try {
        db.prepare(`
            UPDATE users SET
                role = ?,
                qualification = ?,
                department_id = ?
            WHERE id = ?
        `).run(
            role || user.role,
            qualification || user.qualification || 'обычный',
            department_id === undefined ? user.department_id : (department_id || null),
            id
        );
        if (password) {
            const hash = await bcrypt.hash(password, 10);
            db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
        }
        if (qualification && qualification !== user.qualification) {
            calculateDailyStats(); // пороги 44/59 изменились — пересчитываем разговоры
        }
        res.json({ message: 'Данные сотрудника обновлены' });
    } catch (e: any) {
        console.error('Ошибка обновления сотрудника:', e.message);
        res.status(500).json({ error: 'Ошибка обновления сотрудника' });
    }
});

app.get('/api/users/:bitrix_id/info', (req: any, res: any) => {
    try {
        const user = db.prepare('SELECT qualification FROM users WHERE bitrix_id = ?').get(req.params.bitrix_id) as any;
        const qualification = user?.qualification || null;
        res.json({
            qualification: qualification || 'обычный',
            threshold: qualification === 'ведущий' ? 59 : 44,
            qualification_missing: !qualification 
        });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/departments', (req: any, res: any) => {
    try {
        res.json(db.prepare(`
            SELECT d.id, d.name, COUNT(u.id) as members_count
            FROM departments d
            LEFT JOIN users u ON u.department_id = d.id
            GROUP BY d.id ORDER BY d.id ASC
        `).all());
    } catch (e) {
        res.status(500).json({ error: 'Ошибка загрузки отделов' });
    }
});

app.post('/api/departments', (req: any, res: any) => {
    const name = trimOrNull(req.body.name);
    if (!name) return res.status(400).json({ error: 'Название отдела обязательно' });
    try {
        const info = db.prepare('INSERT INTO departments (name) VALUES (?)').run(name);
        res.json({ id: info.lastInsertRowid, name, message: 'Отдел создан' });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка создания отдела' });
    }
});

app.delete('/api/departments/:id', (req: any, res: any) => {
    try {
        db.transaction(() => {
            db.prepare('UPDATE users SET department_id = NULL WHERE department_id = ?').run(req.params.id);
            db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
        })();
        res.json({ message: 'Отдел удален' });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка удаления отдела' });
    }
});

app.put('/api/departments/:id/members', (req: any, res: any) => {
    const deptId = Number(req.params.id);
    const { userIds } = req.body;
    if (!Array.isArray(userIds)) return res.status(400).json({ error: 'Ожидается массив userIds' });
    try {
        db.transaction(() => {
            db.prepare('UPDATE users SET department_id = NULL WHERE department_id = ?').run(deptId);
            const upd = db.prepare('UPDATE users SET department_id = ? WHERE id = ?');
            for (const uid of userIds) upd.run(deptId, uid);
        })();
        res.json({ message: 'Состав отдела успешно обновлен' });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка обновления состава отдела' });
    }
});

app.get('/api/products', (req: any, res: any) => {
    try {
        res.json(db.prepare(`
            SELECT p.id, p.name, p.bitrix_id, p.product_group,
                (SELECT COUNT(*) FROM bases b WHERE b.main_product_id = p.id) as bases_count
            FROM products p ORDER BY p.name ASC
        `).all());
    } catch (e) {
        res.status(500).json({ error: 'Ошибка получения списка продуктов' });
    }
});

app.post('/api/products', (req: any, res: any) => {
    const name = trimOrNull(req.body.name);
    if (!name) return res.status(400).json({ error: 'Имя продукта обязательно' });
    try {
        const info = db.prepare(`
            INSERT INTO products (name, bitrix_id, product_group) VALUES (?, ?, ?)
        `).run(name, req.body.bitrix_id || null, trimOrNull(req.body.product_group));
        res.json({ id: info.lastInsertRowid, name, message: 'Продукт успешно добавлен' });
    } catch (e: any) {
        res.status(500).json({ error: e.message.includes('UNIQUE') ? 'Такой продукт уже существует' : 'Ошибка создания' });
    }
});

app.put('/api/products/:id', (req: any, res: any) => {
    const id = Number(req.params.id);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
    if (!product) return res.status(404).json({ error: 'Продукт не найден' });
    const name = trimOrNull(req.body.name) || product.name;
    try {
        db.prepare(`
            UPDATE products SET name = ?, bitrix_id = ?, product_group = ? WHERE id = ?
        `).run(
            name,
            req.body.bitrix_id === undefined ? product.bitrix_id : (req.body.bitrix_id || null),
            req.body.product_group === undefined ? product.product_group : trimOrNull(req.body.product_group),
            id
        );
        // Сопоставление изменилось — пересчитываем кросс по базам с этим продуктом
        const affected = db.prepare('SELECT id FROM bases WHERE main_product_id = ?').all(id) as any[];
        for (const b of affected) recalcCrossForBase(b.id);
        res.json({ message: 'Продукт обновлен', recalculated_bases: affected.length });
    } catch (e: any) {
        res.status(500).json({ error: e.message.includes('UNIQUE') ? 'Такое название уже занято' : 'Ошибка обновления' });
    }
});

app.delete('/api/products/:id', (req: any, res: any) => {
    const id = Number(req.params.id);
    try {
        const affected = db.prepare('SELECT id FROM bases WHERE main_product_id = ?').all(id) as any[];
        db.transaction(() => {
            db.prepare('UPDATE bases SET main_product_id = NULL WHERE main_product_id = ?').run(id);
            db.prepare('DELETE FROM products WHERE id = ?').run(id);
        })();
        for (const b of affected) recalcCrossForBase(b.id);
        res.json({ message: 'Продукт удален', affected_bases: affected.length });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});

app.get('/api/products/:id/deals', (req: any, res: any) => {
    const id = Number(req.params.id);
    try {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
        if (!product) return res.status(404).json({ error: 'Продукт не найден' });
        res.json(db.prepare(`
            SELECT d.bitrix_deal_id, d.company_title, d.inn, d.okved, d.amount,
                d.stage_name, d.category_name, d.created_at, d.is_cross_sale,
                dp.product_name, dp.quantity, dp.price, dp.sum as row_sum, dp.is_cross_sale as row_cross,
                b.name as base_name,
                COALESCE(u.login, 'ID ' || d.manager_id) as manager_name
            FROM deal_products dp
            JOIN deals d ON d.bitrix_deal_id = dp.bitrix_deal_id
            LEFT JOIN leads l ON d.lead_id = l.bitrix_lead_id
            LEFT JOIN bases b ON l.base_id = b.id
            LEFT JOIN users u ON d.manager_id = u.bitrix_id
            WHERE (? IS NOT NULL AND dp.bitrix_product_id = ?)
               OR norm_name(dp.product_name) = norm_name(?)
            ORDER BY d.created_at DESC LIMIT 200
        `).all(product.bitrix_id, product.bitrix_id, product.name));
    } catch (e) {
        res.status(500).json({ error: 'Ошибка загрузки продаж продукта' });
    }
});

app.get('/api/bases', (req: any, res: any) => {
    try {
        res.json(db.prepare(`
            SELECT b.id, b.name, b.main_product_id, p.name as main_product_name
            FROM bases b
            LEFT JOIN products p ON b.main_product_id = p.id
            ORDER BY b.name ASC
        `).all());
    } catch (e) {
        res.status(500).json({ error: 'Ошибка получения списка баз' });
    }
});

app.post('/api/bases', (req: any, res: any) => {
    const name = trimOrNull(req.body.name);
    if (!name) return res.status(400).json({ error: 'Имя базы обязательно' });
    try {
        const info = db.prepare('INSERT INTO bases (name, main_product_id) VALUES (?, ?)')
            .run(name, req.body.main_product_id || null);
        if (req.body.main_product_id) recalcCrossForBase(Number(info.lastInsertRowid));
        res.json({ id: info.lastInsertRowid, name, message: 'База успешно добавлена' });
    } catch (e: any) {
        res.status(500).json({ error: e.message.includes('UNIQUE') ? 'Такая база уже существует' : 'Ошибка создания' });
    }
});

app.put('/api/bases/:id', (req: any, res: any) => {
    const id = Number(req.params.id);
    const base = db.prepare('SELECT * FROM bases WHERE id = ?').get(id) as any;
    if (!base) return res.status(404).json({ error: 'База не найдена' });
    const name = trimOrNull(req.body.name) || base.name;
    const mainProductId = req.body.main_product_id === undefined
        ? base.main_product_id
        : (req.body.main_product_id || null);
    try {
        db.prepare('UPDATE bases SET name = ?, main_product_id = ? WHERE id = ?')
            .run(name, mainProductId, id);
        if (mainProductId !== base.main_product_id) recalcCrossForBase(id);
        res.json({ message: 'База обновлена. Кросс-продажи пересчитаны по товарам.' });
    } catch (e: any) {
        res.status(500).json({ error: e.message.includes('UNIQUE') ? 'Такое название уже занято' : 'Ошибка обновления' });
    }
});

app.delete('/api/bases/:id', (req: any, res: any) => {
    try {
        db.prepare('DELETE FROM bases WHERE id = ?').run(req.params.id);
        res.json({ message: 'База удалена' });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});

app.get('/api/segments', (req: any, res: any) => {
    try {
        res.json(db.prepare('SELECT * FROM segments ORDER BY name ASC').all());
    } catch (e) {
        res.status(500).json({ error: 'Ошибка загрузки сегментов' });
    }
});

app.post('/api/segments', (req: any, res: any) => {
    const name = trimOrNull(req.body.name);
    if (!name) return res.status(400).json({ error: 'Название сегмента обязательно' });
    try {
        db.prepare(`
            INSERT INTO segments (name, entity) VALUES (?, ?)
            ON CONFLICT(name) DO UPDATE SET entity = excluded.entity
        `).run(name, trimOrNull(req.body.entity) || 'lead');
        res.json({ message: 'Сегмент сохранен' });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка сохранения сегмента' });
    }
});

app.delete('/api/segments/:id', (req: any, res: any) => {
    try {
        db.prepare('DELETE FROM segments WHERE id = ?').run(req.params.id);
        res.json({ message: 'Сегмент удален' });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});

app.get('/api/refusal-reasons', (req: any, res: any) => {
    try {
        res.json(db.prepare('SELECT * FROM refusal_reasons ORDER BY name ASC').all());
    } catch (e) {
        res.status(500).json({ error: 'Ошибка загрузки причин отказов' });
    }
});

app.post('/api/refusal-reasons', (req: any, res: any) => {
    const name = trimOrNull(req.body.name);
    if (!name) return res.status(400).json({ error: 'Название обязательно' });
    try {
        db.prepare('INSERT INTO refusal_reasons (name) VALUES (?)').run(name);
        res.json({ message: 'Причина успешно добавлена' });
    } catch (e: any) {
        res.status(e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 400 : 500)
            .json({ error: e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'Такая причина уже существует' : 'Ошибка сохранения' });
    }
});

app.put('/api/refusal-reasons/:id', (req: any, res: any) => {
    const name = trimOrNull(req.body.name);
    if (!name) return res.status(400).json({ error: 'Название обязательно' });
    try {
        db.prepare('UPDATE refusal_reasons SET name = ? WHERE id = ?').run(name, req.params.id);
        res.json({ message: 'Причина обновлена' });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка обновления' });
    }
});

app.delete('/api/refusal-reasons/:id', (req: any, res: any) => {
    try {
        db.transaction(() => {
            db.prepare('UPDATE leads SET refusal_reason_id = NULL WHERE refusal_reason_id = ?').run(req.params.id);
            db.prepare('DELETE FROM refusal_reasons WHERE id = ?').run(req.params.id);
        })();
        res.json({ message: 'Причина удалена' });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});

const NUMERATORS = ['quality_leads', 'paid_deals', 'transfers'];
const DENOMINATORS = ['unique_leads', 'quality_leads', 'total_calls', 'valid_conversations'];
const CALC_TYPES = ['уникальные лиды', 'события', 'сделки'];

app.get('/api/conversions', (req: any, res: any) => {
    try {
        res.json(db.prepare(`
            SELECT c.*, b.name as base_name
            FROM conversion_rules c
            JOIN bases b ON c.base_id = b.id
            ORDER BY b.name ASC
        `).all());
    } catch (e) {
        res.status(500).json({ error: 'Ошибка загрузки правил конверсии' });
    }
});

app.post('/api/conversions', (req: any, res: any) => {
    try {
        const { base_id, numerator, denominator, calc_type, product_type, cycle_type } = req.body;
        if (!base_id || !numerator || !denominator) {
            return res.status(400).json({ error: 'Заполните базу, числитель и знаменатель' });
        }
        if (!NUMERATORS.includes(numerator) || !DENOMINATORS.includes(denominator)) {
            return res.status(400).json({ error: 'Недопустимая метрика в формуле' });
        }
        if (numerator === 'paid_deals' && ['total_calls', 'valid_conversations'].includes(denominator)) {
            return res.status(400).json({ error: 'Ошибка логики: нельзя делить оплаты на звонки без правила связи.' });
        }
        if (calc_type && !CALC_TYPES.includes(calc_type)) {
            return res.status(400).json({ error: 'Недопустимый способ подсчёта' });
        }
        let excluded: string[] = [];
        try { excluded = JSON.parse(req.body.excluded_statuses || '[]'); } catch (e) { excluded = []; }
        if (!Array.isArray(excluded)) excluded = [];
        if (!excluded.includes('IMPORT')) excluded.push('IMPORT');

        db.prepare(`
            INSERT INTO conversion_rules
                (base_id, numerator, denominator, calc_type, product_type, cycle_type, excluded_statuses, version)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(base_id) DO UPDATE SET
                numerator = excluded.numerator,
                denominator = excluded.denominator,
                calc_type = excluded.calc_type,
                product_type = excluded.product_type,
                cycle_type = excluded.cycle_type,
                excluded_statuses = excluded.excluded_statuses,
                version = conversion_rules.version + 1
        `).run(
            base_id, numerator, denominator,
            calc_type || 'уникальные лиды',
            product_type || 'all',
            cycle_type || 'all',
            JSON.stringify(excluded)
        );
        res.json({ message: 'Правило успешно сохранено' });
    } catch (e) {
        console.error('Ошибка сохранения правила:', e);
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.delete('/api/conversions/:id', (req: any, res: any) => {
    try {
        db.prepare('DELETE FROM conversion_rules WHERE id = ?').run(req.params.id);
        res.json({ message: 'Правило удалено' });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка удаления правила' });
    }
});

app.get('/api/plans', (req: any, res: any) => {
    const { manager_id, month } = req.query;
    if (!manager_id || !month) return res.status(400).json({ error: 'Нужны manager_id и month' });
    try {
        const plan = db.prepare('SELECT * FROM plans WHERE manager_id = ? AND month = ?').get(manager_id, month);
        res.json(plan || { manager_id, month, working_days: 21, calls_norm: 0, leads_norm: 0 });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка получения плана' });
    }
});

app.post('/api/plans', (req: any, res: any) => {
    const { manager_id, month, working_days, calls_norm, leads_norm } = req.body;
    if (!manager_id || !month) return res.status(400).json({ error: 'Обязательные поля: manager_id, month' });
    const days = Number(working_days) || 21;
    if (days < 1 || days > 31) return res.status(400).json({ error: 'Рабочих дней должно быть от 1 до 31' });
    try {
        db.prepare(`
            INSERT INTO plans (manager_id, month, working_days, calls_norm, leads_norm)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(manager_id, month) DO UPDATE SET
                working_days = excluded.working_days,
                calls_norm = excluded.calls_norm,
                leads_norm = excluded.leads_norm
        `).run(manager_id, month, days, Math.max(0, Number(calls_norm) || 0), Math.max(0, Number(leads_norm) || 0));
        res.json({ message: 'План успешно сохранен' });
    } catch (e) {
        console.error('Ошибка сохранения плана:', e);
        res.status(500).json({ error: 'Ошибка сохранения плана' });
    }
});

app.get('/api/manager/:manager_id/remainder', (req: any, res: any) => {
    try {
        const managerId = req.params.manager_id;
        const user = db.prepare('SELECT qualification FROM users WHERE bitrix_id = ?').get(managerId) as any;
        const threshold = user?.qualification === 'ведущий' ? 59 : 44;
        const stats = db.prepare(`
            SELECT
                COUNT(l.id) as total,
                SUM(CASE WHEN l.status_id LIKE '%NEW%' OR l.status_id LIKE '%IMPORT%' THEN 1 ELSE 0 END) as import_count,
                SUM(CASE WHEN l.is_quality = 1 THEN 1 ELSE 0 END) as quality_count,
                SUM(CASE WHEN l.refusal_reason_id IS NOT NULL OR l.status_semantic = 'F' THEN 1 ELSE 0 END) as refusal_count,
                SUM(CASE WHEN l.status_semantic = 'P' AND l.is_quality = 0
                          AND l.status_id NOT LIKE '%NEW%' AND l.status_id NOT LIKE '%IMPORT%' THEN 1 ELSE 0 END) as in_progress_count,
                -- Недозвоны: звонки были, но ни один не дотянул до порога разговора
                SUM(CASE WHEN l.status_semantic = 'P' AND l.status_id NOT LIKE '%NEW%'
                          AND EXISTS (SELECT 1 FROM calls c WHERE c.owner_type = 'lead' AND c.owner_id = l.bitrix_lead_id)
                          AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.owner_type = 'lead' AND c.owner_id = l.bitrix_lead_id
                                          AND c.direction = 'outgoing' AND c.duration_seconds >= ?)
                         THEN 1 ELSE 0 END) as no_answer_count
            FROM leads l
            WHERE l.manager_id = ?
        `).get(threshold, managerId);
        res.json(stats || { total: 0, import_count: 0, quality_count: 0, refusal_count: 0, in_progress_count: 0, no_answer_count: 0 });
    } catch (e) {
        console.error('Ошибка остатка базы:', e);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/manager/:manager_id/work-list', (req: any, res: any) => {
    try {
        const leads = db.prepare(`
            SELECT l.bitrix_lead_id,
                COALESCE(b.name, 'Без базы') as base_name,
                COALESCE(p.name, 'Не назначен') as product_name,
                l.created_at, l.status_id,
                COUNT(c.id) as calls_count,
                MAX(c.started_at) as last_call_at
            FROM leads l
            LEFT JOIN bases b ON l.base_id = b.id
            LEFT JOIN products p ON b.main_product_id = p.id
            LEFT JOIN calls c ON c.owner_type = 'lead' AND c.owner_id = l.bitrix_lead_id
            WHERE l.manager_id = ?
              AND l.status_semantic = 'P'
              AND l.is_quality = 0
              AND l.status_id NOT LIKE '%NEW%'
              AND l.status_id NOT LIKE '%IMPORT%'
            GROUP BY l.id
            ORDER BY l.created_at DESC
            LIMIT 100
        `).all(req.params.manager_id) as any[];

        const isReturn = (l: any) => String(l.status_id || '').toLowerCase().includes('return');
        res.json({
            returns: leads.filter(l => isReturn(l) || l.calls_count > 5),
            retries: leads.filter(l => l.calls_count > 0 && l.calls_count <= 5 && !isReturn(l)),
            new_in_work: leads.filter(l => l.calls_count === 0 && !isReturn(l))
        });
    } catch (e) {
        console.error('Ошибка рабочих списков:', e);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/sync-status', (req: any, res: any) => {
    try {
        const entities = ['calls', 'leads', 'deals', 'segments'];
        const items = entities.map(entity => {
            const last = db.prepare(`
                SELECT ts, status, processed, message FROM sync_log
                WHERE entity = ? ORDER BY id DESC LIMIT 1
            `).get(entity) as any;
            const success = db.prepare(`
                SELECT ts FROM sync_log WHERE entity = ? AND status = 'success'
                ORDER BY id DESC LIMIT 1
            `).get(entity) as any;
            return {
                entity,
                last_ts: last?.ts ?? null,
                last_status: last?.status ?? 'never',
                processed: last?.processed ?? 0,
                message: last?.message ?? '',
                last_success_ts: success?.ts ?? null,
                data_incomplete: String(last?.message || '').includes('dataComplete=false')
            };
        });
        const pending = db.prepare(`
            SELECT COUNT(*) as cnt FROM deals
            WHERE products_list IS NULL AND (amount > 0 OR stage_semantic IN ('S', 'P'))
        `).get() as any;
        res.json({
            items,
            products_pending: pending?.cnt ?? 0,
            incomplete: items.some(i => i.data_incomplete || !i.last_success_ts) || (pending?.cnt ?? 0) > 0
        });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка получения состояния синхронизации' });
    }
});

app.get('/api/health', (req: any, res: any) => {
    res.json({ ok: true, ts: new Date().toISOString() });
});

app.get('/api/okved', (req: any, res: any) => {
    try {
        res.json(db.prepare('SELECT code, name FROM okved ORDER BY code ASC').all());
    } catch (e) {
        res.status(500).json({ error: 'Ошибка загрузки ОКВЭД' });
    }
});

app.post('/api/okved', (req: any, res: any) => {
    const code = String(req.body.code || '').trim();
    const name = req.body.name ? String(req.body.name).trim() : null;
    if (!code) return res.status(400).json({ error: 'Код ОКВЭД обязателен' });
    try {
        db.prepare(`
            INSERT INTO okved (code, name) VALUES (?, ?)
            ON CONFLICT(code) DO UPDATE SET name = COALESCE(excluded.name, okved.name)
        `).run(code, name);
        res.json({ message: 'ОКВЭД сохранён' });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.delete('/api/okved/:code', (req: any, res: any) => {
    try {
        db.prepare('DELETE FROM okved WHERE code = ?').run(req.params.code);
        res.json({ message: 'ОКВЭД удалён' });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});


registerSyncRoutes(app, authenticateToken); 
registerAnalyticsRoutes(app);                
setTimeout(() => {
    runBackgroundSync();
    setInterval(runBackgroundSync, SYNC_INTERVAL_MIN * 60 * 1000);
}, 10000);

app.get('/api/okved/load-names', async (req: any, res: any) => {
    try {
        console.log('🌐 Загрузка справочника ОКВЭД...');
        const response = await fetch('https://raw.githubusercontent.com/epogrebniy/okved/master/okved2.json');
        if (!response.ok) {
            return res.status(500).json({ error: `Не удалось скачать справочник: HTTP ${response.status}` });
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
            return res.status(500).json({ error: 'Неверный формат справочника' });
        }

        const stmt = db.prepare(`
            INSERT INTO okved (code, name) VALUES (?, ?)
            ON CONFLICT(code) DO UPDATE SET name = COALESCE(excluded.name, okved.name)
        `);

        let updated = 0;
        let inserted = 0;
        
        db.transaction(() => {
            for (const item of data) {
                if (!item.code || !item.name) continue;
                const existing = db.prepare('SELECT code FROM okved WHERE code = ?').get(item.code);
                stmt.run(item.code, item.name);
                if (existing) updated++;
                else inserted++;
            }
        })();

        console.log(`✅ ОКВЭД обновлен: добавлено ${inserted}, обновлено ${updated}`);
        res.json({
            message: `Загружено: добавлено ${inserted}, обновлено ${updated} кодов`,
            inserted,
            updated,
            total: data.length
        });
    } catch (e: any) {
        console.error('❌ Ошибка загрузки ОКВЭД:', e.message);
        res.status(500).json({ error: `Ошибка: ${e.message}` });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`⏱️ Автосинхронизация каждые ${SYNC_INTERVAL_MIN} мин`);
    if (!process.env.DADATA_TOKEN) console.warn('⚠️ DADATA_TOKEN не задан — ОКВЭД обогащаться не будет');
});