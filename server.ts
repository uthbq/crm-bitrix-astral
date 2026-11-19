import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import db from './database';

const app = express();
app.use(cors());
app.use(express.json());

const SECRET_KEY = 'super-secret-key-123';
const CACHE_LIFETIME_MS = 60 * 60 * 1000;
let cachedUsers: any = null;
let cacheTime = 0;

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

app.post('/api/auth/login', async (req, res): Promise<any> => {
    const { login, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login) as any;

    if (!user) return res.status(401).json({ error: 'Пользователь не найден' });

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) return res.status(401).json({ error: 'Неверный пароль' });

    const token = jwt.sign(
        { id: user.id, role: user.role, bitrix_id: user.bitrix_id },
        SECRET_KEY,
        { expiresIn: '24h' }
    );

    res.json({ message: 'Успешный вход', token, role: user.role });
});

app.get('/api/bitrix-users', authenticateToken, async (req: any, res: any) => {
    const now = Date.now();
    
    if (cachedUsers && (now - cacheTime < CACHE_LIFETIME_MS)) {
        return res.json(cachedUsers);
    }

    try {
        const response = await fetch(`${process.env.API_URL}/users`, {
            headers: {
                'Authorization': `Bearer ${process.env.API_TOKEN}`
            }
        });
        
        const data = await response.json();
        console.log("Ответ от API:", data);

        if (!data.ok) {
            throw new Error(data.message || 'Ошибка со стороны API Битрикса');
        }

        const users = data.users.map((u: any) => ({
            id: u.id,
            name: u.name || 'Без имени'
        }));

        cachedUsers = users;
        cacheTime = now;
        res.json(cachedUsers);
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ error: 'Ошибка загрузки из API' });
    }
});

app.get('/api/calls-test', async (req: any, res: any) => {
    try {
        const response = await fetch(`${process.env.API_URL}/calls?limit=5`, {
            headers: {
                'Authorization': `Bearer ${process.env.API_TOKEN}`
            }
        });
        
        const data = await response.json();
        
        res.json(data);
    } catch (error) {
        console.error('Ошибка загрузки звонков:', error);
        res.status(500).json({ error: 'Не удалось получить звонки' });
    }
});

app.get('/api/sync-calls', (req: any, res: any) => {
    res.json({ message: 'Умная синхронизация звонков запущена в фоне.' });

    (async () => {
        try {
            const maxIdResult = db.prepare("SELECT MAX(bitrix_call_id) as maxId FROM calls").get() as any;
            
            let afterId = maxIdResult.maxId || 0; 
            
            console.log(`🚀 Умная синхронизация звонков началась. Стартуем с afterId=${afterId}...`);
            
            let hasMore = true;
            let totalInserted = 0;

            const stmt = db.prepare(`
                INSERT OR IGNORE INTO calls 
                (bitrix_call_id, manager_id, direction, duration_seconds, started_at, owner_type, owner_id) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            while (hasMore) {
                const url = `${process.env.API_URL}/calls?limit=500` + (afterId ? `&afterId=${afterId}` : '');
                
                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${process.env.API_TOKEN}` }
                });
                
                const data = await response.json();

                if (!data.ok || !data.calls || data.calls.length === 0) {
                    break;
                }

                let insertedInChunk = 0;
                db.transaction((callsChunk) => {
                    for (const call of callsChunk) {
                        const startTime = call.startTime ? new Date(call.startTime).getTime() : 0;
                        const endTime = call.endTime ? new Date(call.endTime).getTime() : startTime;
                        const dur = startTime ? Math.max(0, Math.round((endTime - startTime) / 1000)) : 0;
                        
                        const info = stmt.run(
                            call.id, call.responsibleId, call.direction, 
                            dur, call.startTime || null, call.owner?.type || null, call.owner?.id || null
                        );
                        if (info.changes > 0) insertedInChunk++;
                    }
                })(data.calls);

                totalInserted += insertedInChunk;
                
                if (data.dataComplete === true) {
                    hasMore = false;
                } else {
                    afterId = Math.max(...data.calls.map((c: any) => c.id));
                }
            }

            console.log(`✅ Синхронизация завершена! Новых звонков скачано: ${totalInserted}`);
      
            if (totalInserted > 0) {
                await fetch('http://localhost:3000/api/calculate-daily-stats');
                console.log('🔄 Статистика обновлена с учетом новых звонков.');
            }
        } catch (err) {
            console.error('❌ Ошибка синхронизации:', err);
        }
    })();
});
app.get('/api/stats/calls', async (req: any, res: any) => {
    try {
        const stmt = db.prepare(`
            SELECT 
                manager_id,
                COUNT(*) as total_outbound,
                SUM(CASE WHEN duration_seconds >= 44 THEN 1 ELSE 0 END) as valid_conversations
            FROM calls 
            WHERE direction = 'outgoing'
            GROUP BY manager_id
        `);
        
        const stats = stmt.all();
        res.json(stats);
    } catch (error) {
        console.error('Ошибка расчета статистики:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});
app.get('/api/sync-leads', (req: any, res: any) => {
    res.json({ message: 'Синхронизация лидов запущена в фоне.' });

    (async () => {
        try {
            const maxIdResult = db.prepare("SELECT MAX(bitrix_lead_id) as maxId FROM leads").get() as any;
            let afterId = req.query.force === 'true' ? 0 : (maxIdResult.maxId || 0); 
            console.log(`🚀 Синхронизация лидов началась. afterId=${afterId}...`);
            
            let hasMore = true;
            let totalProcessed = 0;

            const stmtLead = db.prepare(`
                INSERT INTO leads (bitrix_lead_id, inn, status_id, status_semantic, manager_id, segmentation, base_id, is_quality, refusal_reason_id, created_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(bitrix_lead_id) DO UPDATE SET
                    status_id = excluded.status_id,
                    status_semantic = excluded.status_semantic,
                    manager_id = excluded.manager_id,
                    segmentation = excluded.segmentation,
                    base_id = excluded.base_id,
                    is_quality = excluded.is_quality,
                    refusal_reason_id = excluded.refusal_reason_id
            `);

            const stmtReasonInsert = db.prepare('INSERT OR IGNORE INTO refusal_reasons (name) VALUES (?)');
            const stmtReasonSelect = db.prepare('SELECT id FROM refusal_reasons WHERE name = ?');
            const stmtBaseInsert = db.prepare('INSERT OR IGNORE INTO bases (name) VALUES (?)');
            const stmtBaseSelect = db.prepare('SELECT id FROM bases WHERE name = ?');

            while (hasMore) {
                const url = `${process.env.API_URL}/leads?limit=500&fields=yes` + (afterId ? `&afterId=${afterId}` : '');
                const response = await fetch(url, { headers: { 'Authorization': `Bearer ${process.env.API_TOKEN}` } });
                const data = await response.json();

                if (!data.ok || !data.leads || data.leads.length === 0) break;

                let processedInChunk = 0;
                
                db.transaction((leadsChunk) => {
                    for (const lead of leadsChunk) {
                        const statusId = lead.status ? lead.status.id : null;
                        const statusSemantic = lead.status ? lead.status.semantic : null;
                        const isQuality = (statusSemantic === 'S' || lead.isConverted) ? 1 : 0;
                        
                        const segmentsStr = lead.segments ? JSON.stringify(lead.segments) : null;
                        
                        let baseId = null;
                        let extractedBaseName = null;
                        
                        if (Array.isArray(lead.segments) && lead.segments.length > 0) {
                            const firstSeg = lead.segments[0];
                            if (typeof firstSeg === 'string') {
                                extractedBaseName = firstSeg;
                            } else if (firstSeg && typeof firstSeg === 'object') {
                                extractedBaseName = firstSeg.name || firstSeg.value || null;
                            }
                        }
                        if (extractedBaseName) {
                            const bName = extractedBaseName.trim();
                            stmtBaseInsert.run(bName); 
                            const baseRow = stmtBaseSelect.get(bName) as any;
                            if (baseRow) baseId = baseRow.id;
                        }
                        
                        let refusalReasonId = null;
                        let rawReasonText = null;

                        if (lead.fields) {
                            for (const key in lead.fields) {
                                const fieldTitle = lead.fields[key].title?.toLowerCase() || '';
                                if (fieldTitle.includes('отказ') || fieldTitle.includes('причин') || fieldTitle.includes('почему')) {
                                    rawReasonText = lead.fields[key].value;
                                    break;
                                }
                            }
                        }

                        if (!rawReasonText && statusSemantic === 'F' && lead.status?.name) {
                            const sName = lead.status.name;
                            if (sName !== 'Некачественный лид' && sName !== 'Провал' && sName !== 'Junk') {
                                rawReasonText = sName;
                            }
                        }

                        if (rawReasonText && typeof rawReasonText === 'string') {
                            const trimmedReason = rawReasonText.trim();
                            stmtReasonInsert.run(trimmedReason);
                            const row = stmtReasonSelect.get(trimmedReason) as any;
                            if (row) refusalReasonId = row.id;
                        }

                        const info = stmtLead.run(
                            lead.id, 
                            lead.inn || null, 
                            statusId, 
                            statusSemantic, 
                            lead.assignedById, 
                            segmentsStr, 
                            baseId,      
                            isQuality, 
                            refusalReasonId,
                            lead.createdAt || null
                        );
                        if (info.changes > 0) processedInChunk++;
                    }
                })(data.leads);

                totalProcessed += processedInChunk;
                
                if (data.dataComplete === true || data.leads.length === 0) {
                    hasMore = false;
                } else {
                    afterId = Math.max(...data.leads.map((l: any) => l.id));
                }
            }

            console.log(`✅ Синхронизация лидов завершена! Обработано/обновлено: ${totalProcessed}`);
            if (totalProcessed > 0) await fetch('http://localhost:3000/api/calculate-daily-stats');
        } catch (error) {
            console.error('❌ Ошибка синхронизации лидов:', error);
        }
    })();
});

app.get('/api/sync-deals', (req: any, res: any) => {
    res.json({ message: 'Умная синхронизация сделок запущена в фоне.' });

    (async () => {
        try {
            const maxIdResult = db.prepare("SELECT MAX(bitrix_deal_id) as maxId FROM deals").get() as any;
            let afterId = maxIdResult.maxId || 0; 
            console.log(`🚀 Умная синхронизация сделок началась. Стартуем с afterId=${afterId}...`);
            
            let hasMore = true;
            let totalInserted = 0;

            const stmt = db.prepare(`
                INSERT INTO deals (bitrix_deal_id, lead_id, manager_id, inn, stage_id, amount, created_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(bitrix_deal_id) DO UPDATE SET
                    stage_id = excluded.stage_id,
                    manager_id = excluded.manager_id,
                    amount = excluded.amount
            `);

            while (hasMore) {
                const url = `${process.env.API_URL}/deals?limit=500` + (afterId ? `&afterId=${afterId}` : '');
                const response = await fetch(url, { headers: { 'Authorization': `Bearer ${process.env.API_TOKEN}` } });
                const data = await response.json();

                if (!data.ok || !data.deals || data.deals.length === 0) break;

                let insertedInChunk = 0;
                db.transaction((dealsChunk) => {
                    for (const deal of dealsChunk) {
                        const stageId = deal.stage ? deal.stage.id : null;
                        const info = stmt.run(
                            deal.id, deal.leadId || null, deal.assignedById, deal.inn || null, 
                            stageId, deal.amount || 0, deal.createdAt || null
                        );
                        if (info.changes > 0) insertedInChunk++;
                    }
                })(data.deals);

                totalInserted += insertedInChunk;
                
                if (data.dataComplete === true) {
                    hasMore = false;
                } else {
                    afterId = Math.max(...data.deals.map((d: any) => d.id));
                }
            }

            console.log(`✅ Синхронизация сделок завершена! Обраработано: ${totalInserted}`);
            if (totalInserted > 0) await fetch('http://localhost:3000/api/calculate-daily-stats');
        } catch (error) {
            console.error('❌ Ошибка синхронизации сделок:', error);
        }
    })();
});
app.post('/api/users', authenticateToken, async (req: any, res: any): Promise<any> => {
    const creatorRole = req.user.role;
    const { bitrix_id, login, password, role, department_id } = req.body;

    if (creatorRole === 'MANAGER') {
        return res.status(403).json({ error: 'Нет прав на создание сотрудников' });
    }
    if (creatorRole === 'HEAD_OF_DEPT' && role !== 'MANAGER') {
        return res.status(403).json({ error: 'Руководитель отдела может создавать только менеджеров' });
    }

    const hash = await bcrypt.hash(password, 10);

    try {
        const stmt = db.prepare('INSERT INTO users (bitrix_id, login, password_hash, role, department_id) VALUES (?, ?, ?, ?, ?)');
        stmt.run(bitrix_id, login, hash, role, department_id || null);
        res.json({ message: `Пользователь ${login} успешно создан` });
    } catch (err: any) {
        res.status(400).json({ error: 'Ошибка сохранения: ' + err.message });
    }
});
app.get('/api/sync-segments', async (req: any, res: any) => {
    try {
        const response = await fetch(`${process.env.API_URL}/segments`, {
            headers: {
                'Authorization': `Bearer ${process.env.API_TOKEN}`
            }
        });
        
        const data = await response.json();

        if (!data.ok || !data.segments) {
            return res.status(400).json({ error: 'Ошибка от API Битрикса' });
        }

        const stmtSegment = db.prepare(`
            INSERT INTO segments (name, entity) 
            VALUES (?, ?)
            ON CONFLICT(name) DO UPDATE SET
                entity = excluded.entity
        `);
        const stmtBase = db.prepare(`
            INSERT OR IGNORE INTO bases (name) 
            VALUES (?)
        `);

        const insertMany = db.transaction((segments) => {
            for (const segment of segments) {
                if (!segment.name) continue;
                stmtSegment.run(segment.name, segment.entity);
                stmtBase.run(segment.name); // База создастся сама!
            }
        });

        insertMany(data.segments);

        res.json({ 
            message: 'Синхронизация сегментов и баз успешна', 
            total_fetched: data.segments.length
        });

    } catch (error) {
        console.error('Ошибка синхронизации сегментов:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});
app.get('/api/calculate-daily-stats', (req: any, res: any) => {
    try {
        const calculateAll = db.transaction(() => {
            db.prepare('DELETE FROM daily_stats').run();
            db.prepare(`
                INSERT INTO daily_stats (
                    date, manager_id, base_id, product_id, work_type, total_calls, valid_conversations
                )
                SELECT 
                    date(c.started_at), 
                    c.manager_id, 
                    COALESCE(l.base_id, 0) as base_id, 
                    0, 
                    'primary', 
                    COUNT(c.id),
                    SUM(
                        CASE 
                            WHEN u.qualification = 'ведущий' AND c.duration_seconds >= 59 THEN 1
                            WHEN (u.qualification = 'обычный' OR u.qualification IS NULL) AND c.duration_seconds >= 44 THEN 1
                            ELSE 0 
                        END
                    )
                FROM calls c
                LEFT JOIN users u ON c.manager_id = u.bitrix_id
                LEFT JOIN leads l ON c.owner_type = 'lead' AND c.owner_id = l.bitrix_lead_id
                WHERE c.manager_id IS NOT NULL
                GROUP BY date(c.started_at), c.manager_id, COALESCE(l.base_id, 0)
            `).run();
            
            db.prepare(`
                INSERT INTO daily_stats (
                    date, manager_id, base_id, product_id, work_type, unique_leads, quality_leads, transfers
                )
                SELECT 
                    date(created_at), 
                    manager_id, 
                    COALESCE(base_id, 0), 
                    0, 
                    'primary', 
                    SUM(CASE WHEN status_id NOT LIKE '%NEW%' THEN 1 ELSE 0 END), 
                    SUM(CASE WHEN is_quality = 1 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status_semantic = 'S' THEN 1 ELSE 0 END)
                FROM leads WHERE manager_id IS NOT NULL AND created_at IS NOT NULL
                GROUP BY date(created_at), manager_id, COALESCE(base_id, 0)
                ON CONFLICT(date, manager_id, base_id, product_id, work_type) DO UPDATE SET
                    unique_leads = excluded.unique_leads,
                    quality_leads = excluded.quality_leads,
                    transfers = excluded.transfers
            `).run();

            db.prepare(`
                INSERT INTO daily_stats (
                    date, manager_id, base_id, product_id, work_type, paid_deals, amount_sum
                )
                SELECT 
                    date(d.created_at), 
                    d.manager_id, 
                    COALESCE(l.base_id, 0), 
                    0, 
                    'primary', 
                    COUNT(d.id), 
                    SUM(d.amount)
                FROM deals d
                LEFT JOIN leads l ON d.lead_id = l.bitrix_lead_id
                WHERE d.manager_id IS NOT NULL AND d.created_at IS NOT NULL AND d.amount > 0
                GROUP BY date(d.created_at), d.manager_id, COALESCE(l.base_id, 0)
                ON CONFLICT(date, manager_id, base_id, product_id, work_type) DO UPDATE SET
                    paid_deals = excluded.paid_deals,
                    amount_sum = excluded.amount_sum
            `).run();
        });

        calculateAll();
        res.json({ message: 'Агрегация данных завершена (старая статистика очищена и пересчитана).' });
    } catch (error) {
        console.error('Ошибка агрегации:', error);
        res.status(500).json({ error: 'Ошибка агрегации данных' });
    }
});

app.get('/api/dashboard', (req: any, res: any) => {
    try {
        const { manager_id, startDate, endDate, base_id } = req.query;
        let where = [];
        let params: any[] = [];

        if (manager_id) { where.push('manager_id = ?'); params.push(manager_id); }
        if (startDate) { where.push('date >= ?'); params.push(startDate); }
        if (endDate) { where.push('date <= ?'); params.push(endDate); }
        if (base_id) { where.push('base_id = ?'); params.push(base_id); }

        const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

        const stats = db.prepare(`
            SELECT 
                date,
                SUM(total_calls) as total_outbound,
                SUM(valid_conversations) as valid_conversations,
                SUM(unique_leads) as unique_leads,
                SUM(quality_leads) as quality_leads,
                SUM(transfers) as transfers,
                SUM(paid_deals) as paid_deals,
                SUM(amount_sum) as amount_sum
            FROM daily_stats
            ${whereClause}
            GROUP BY date
            ORDER BY date DESC
        `).all(...params);
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка дашборда' });
    }
});
app.get('/api/products', (req: any, res: any) => {
    try {
        const products = db.prepare('SELECT * FROM products').all();
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения списка продуктов' });
    }
});

app.post('/api/products', (req: any, res: any) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Имя продукта обязательно' });
        
        const info = db.prepare('INSERT INTO products (name) VALUES (?)').run(name);
        res.json({ id: info.lastInsertRowid, name, message: 'Продукт успешно добавлен' });
    } catch (error: any) {
        res.status(500).json({ error: error.message.includes('UNIQUE') ? 'Такой продукт уже существует' : 'Ошибка создания' });
    }
});

app.delete('/api/products/:id', (req: any, res: any) => {
    try {
        db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
        res.json({ message: 'Продукт удален' });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});

app.get('/api/bases', (req: any, res: any) => {
    try {
        const bases = db.prepare('SELECT * FROM bases').all();
        res.json(bases);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения списка баз' });
    }
});

app.post('/api/bases', (req: any, res: any) => {
    try {
        const { name, main_product_id } = req.body;
        if (!name) return res.status(400).json({ error: 'Имя базы обязательно' });

        const info = db.prepare('INSERT INTO bases (name, main_product_id) VALUES (?, ?)')
                       .run(name, main_product_id || null);
        res.json({ id: info.lastInsertRowid, name, main_product_id, message: 'База успешно добавлена' });
    } catch (error: any) {
        res.status(500).json({ error: error.message.includes('UNIQUE') ? 'Такая база уже существует' : 'Ошибка создания' });
    }
});

app.delete('/api/bases/:id', (req: any, res: any) => {
    try {
        db.prepare('DELETE FROM bases WHERE id = ?').run(req.params.id);
        res.json({ message: 'База удалена' });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});

app.get('/api/conversions', (req: any, res: any) => {
    try {
        const rules = db.prepare(`
            SELECT c.*, b.name as base_name 
            FROM conversion_rules c 
            JOIN bases b ON c.base_id = b.id
        `).all();
        res.json(rules);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка загрузки правил конверсии' });
    }
});

app.post('/api/conversions', (req: any, res: any) => {
    try {
        const { base_id, numerator, denominator, calc_type, product_type, cycle_type } = req.body;
        if (!base_id || !numerator || !denominator) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }

        if (numerator === 'paid_deals' && (denominator === 'total_calls' || denominator === 'valid_conversations')) {
            return res.status(400).json({ error: 'Ошибка логики: Нельзя делить оплаты на звонки без правила связи.' });
        }

        db.prepare(`
            INSERT INTO conversion_rules (base_id, numerator, denominator, calc_type, product_type, cycle_type, version) 
            VALUES (?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(base_id) DO UPDATE SET 
                numerator = excluded.numerator, 
                denominator = excluded.denominator, 
                calc_type = excluded.calc_type,
                product_type = excluded.product_type, 
                cycle_type = excluded.cycle_type, 
                version = version + 1
        `).run(
            base_id, 
            numerator, 
            denominator, 
            calc_type || 'уникальные лиды', 
            product_type || 'all', 
            cycle_type || 'all'
        );
        
        res.json({ message: 'Правило успешно сохранено' });
    } catch (error) {
        console.error('Ошибка сохранения правила:', error);
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.get('/api/analytics/managers', (req: any, res: any) => {
    try {
        const { startDate, endDate, base_id } = req.query;
        let where = [];
        let params: any[] = [];

        if (startDate) { where.push('ds.date >= ?'); params.push(startDate); }
        if (endDate) { where.push('ds.date <= ?'); params.push(endDate); }
        if (base_id) { where.push('ds.base_id = ?'); params.push(base_id); }

        const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

        const stats = db.prepare(`
            SELECT 
                ds.manager_id,
                COALESCE(u.login, 'ID ' || ds.manager_id) as manager_name,
                SUM(ds.total_calls) as total_calls,
                SUM(ds.valid_conversations) as valid_conversations,
                SUM(ds.unique_leads) as unique_leads,
                SUM(ds.quality_leads) as quality_leads,
                SUM(ds.transfers) as transfers,
                SUM(ds.paid_deals) as paid_deals,
                SUM(ds.amount_sum) as amount_sum
            FROM daily_stats ds
            LEFT JOIN users u ON ds.manager_id = u.bitrix_id
            ${whereClause}
            GROUP BY ds.manager_id
            ORDER BY amount_sum DESC, quality_leads DESC, valid_conversations DESC, total_calls DESC
        `).all(...params);
        res.json(stats);
    } catch (error) {
        console.error('Ошибка рейтинга:', error);
        res.status(500).json({ error: 'Ошибка получения рейтинга' });
    }
});

app.get('/api/analytics/bases', (req: any, res: any) => {
    try {
        const { startDate, endDate, manager_id } = req.query;
        
        let whereL = []; let paramsL: any[] = [];
        let whereD = ['d.amount > 0']; let paramsD: any[] = [];

        if (startDate) { 
            whereL.push('date(l.created_at) >= ?'); paramsL.push(startDate);
            whereD.push('date(d.created_at) >= ?'); paramsD.push(startDate);
        }
        if (endDate) { 
            whereL.push('date(l.created_at) <= ?'); paramsL.push(endDate);
            whereD.push('date(d.created_at) <= ?'); paramsD.push(endDate);
        }
        if (manager_id) {
            whereL.push('l.manager_id = ?'); paramsL.push(manager_id);
            whereD.push('d.manager_id = ?'); paramsD.push(manager_id);
        }

        const whereClauseL = whereL.length ? 'WHERE ' + whereL.join(' AND ') : '';
        const whereClauseD = whereD.length ? 'WHERE ' + whereD.join(' AND ') : '';

        const query = `
            WITH LeadsStats AS (
                SELECT 
                    b.id as base_id,
                    b.name as base_name,
                    SUM(CASE WHEN l.is_quality = 1 THEN 1 ELSE 0 END) as quality_leads
                FROM bases b
                LEFT JOIN leads l ON b.id = l.base_id
                ${whereClauseL}
                GROUP BY b.id
            ),
            DealsStats AS (
                SELECT 
                    b.id as base_id,
                    COUNT(d.id) as paid_deals,
                    SUM(d.amount) as amount_sum,
                    SUM(CASE WHEN d.product_field IS NOT NULL AND CAST(d.product_field AS TEXT) != CAST(b.main_product_id AS TEXT) THEN d.amount ELSE 0 END) as cross_amount,
                    SUM(CASE WHEN d.product_field IS NULL OR CAST(d.product_field AS TEXT) = CAST(b.main_product_id AS TEXT) OR b.main_product_id IS NULL THEN d.amount ELSE 0 END) as main_amount
                FROM bases b
                LEFT JOIN leads l ON b.id = l.base_id
                JOIN deals d ON l.bitrix_lead_id = d.lead_id
                ${whereClauseD}
                GROUP BY b.id
            )
            SELECT 
                ls.base_id,
                ls.base_name,
                ls.quality_leads,
                COALESCE(ds.paid_deals, 0) as paid_deals,
                COALESCE(ds.amount_sum, 0) as amount_sum,
                COALESCE(ds.main_amount, 0) as main_amount,
                COALESCE(ds.cross_amount, 0) as cross_amount
            FROM LeadsStats ls
            LEFT JOIN DealsStats ds ON ls.base_id = ds.base_id
            ORDER BY amount_sum DESC, quality_leads DESC
        `;

        const stats = db.prepare(query).all(...paramsL, ...paramsD);
        res.json(stats);
    } catch (error) {
        console.error('Ошибка аналитики баз:', error);
        res.status(500).json({ error: 'Ошибка получения аналитики баз' });
    }
});

app.get('/api/plans', (req: any, res: any) => {
    try {
        const { manager_id, month } = req.query;
        if (!manager_id || !month) {
            return res.status(400).json({ error: 'Нужны manager_id и month' });
        }

        const plan = db.prepare('SELECT * FROM plans WHERE manager_id = ? AND month = ?').get(manager_id, month);
        res.json(plan || { manager_id, month, working_days: 21, calls_norm: 0, leads_norm: 0 });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения плана' });
    }
});

app.post('/api/plans', (req: any, res: any) => {
    try {
        const { manager_id, month, working_days, calls_norm, leads_norm } = req.body;
        if (!manager_id || !month) {
            return res.status(400).json({ error: 'Обязательные поля: manager_id, month' });
        }

        db.prepare(`
            INSERT INTO plans (manager_id, month, working_days, calls_norm, leads_norm)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(month, manager_id) DO UPDATE SET
                working_days = excluded.working_days,
                calls_norm = excluded.calls_norm,
                leads_norm = excluded.leads_norm
        `).run(manager_id, month, working_days || 21, calls_norm || 0, leads_norm || 0);

        res.json({ message: 'План успешно сохранен' });
    } catch (error) {
        console.error('Ошибка сохранения плана:', error);
        res.status(500).json({ error: 'Ошибка сохранения плана' });
    }
});

app.get('/api/users', (req: any, res: any) => {
    try {
        const users = db.prepare(`
            SELECT id, bitrix_id, login, role 
            FROM users 
            WHERE role IN ('MANAGER', 'HEAD_OF_DEPT')
        `).all();
        res.json(users);
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ error: 'Ошибка получения пользователей' });
    }
});

app.get('/api/refusal-reasons', (req: any, res: any) => {
    try {
        const reasons = db.prepare('SELECT * FROM refusal_reasons').all();
        res.json(reasons);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка загрузки причин отказов' });
    }
});

app.post('/api/refusal-reasons', (req: any, res: any) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Название обязательно' });
        
        db.prepare('INSERT INTO refusal_reasons (name) VALUES (?)').run(name.trim());
        res.json({ message: 'Причина успешно добавлена' });
    } catch (error: any) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(400).json({ error: 'Такая причина уже существует' });
        } else {
            res.status(500).json({ error: 'Ошибка сохранения' });
        }
    }
});

app.delete('/api/refusal-reasons/:id', (req: any, res: any) => {
    try {
        db.prepare('DELETE FROM refusal_reasons WHERE id = ?').run(req.params.id);
        res.json({ message: 'Причина удалена' });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});

app.get('/api/analytics/refusals', (req: any, res: any) => {
    try {
        const { startDate, endDate, base_id, manager_id } = req.query;
        let where = ['l.refusal_reason_id IS NOT NULL'];
        let params: any[] = [];

        if (startDate) { where.push('date(l.created_at) >= ?'); params.push(startDate); }
        if (endDate) { where.push('date(l.created_at) <= ?'); params.push(endDate); }
        if (base_id) { where.push('l.base_id = ?'); params.push(base_id); }
        if (manager_id) { where.push('l.manager_id = ?'); params.push(manager_id); }

        const whereClause = 'WHERE ' + where.join(' AND ');

        const stats = db.prepare(`
            SELECT 
                r.id,
                r.name as reason_name,
                COUNT(l.id) as count
            FROM leads l
            JOIN refusal_reasons r ON l.refusal_reason_id = r.id
            ${whereClause}
            GROUP BY r.id
            ORDER BY count DESC
        `).all(...params);
        
        res.json(stats);
    } catch (error) {
        console.error('Ошибка аналитики отказов:', error);
        res.status(500).json({ error: 'Ошибка получения аналитики отказов' });
    }
});

app.get('/api/analytics/refusals/:reason_id/details', (req: any, res: any) => {
    try {
        const { startDate, endDate } = req.query;
        const reason_id = req.params.reason_id;
        let where = ['l.refusal_reason_id = ?'];
        let params: any[] = [reason_id];
        
        if (startDate) { where.push('date(l.created_at) >= ?'); params.push(startDate); }
        if (endDate) { where.push('date(l.created_at) <= ?'); params.push(endDate); }
        
        const leads = db.prepare(`
            SELECT 
                l.bitrix_lead_id,
                l.created_at,
                l.segmentation as base_name,
                COALESCE(u.login, 'ID ' || l.manager_id) as manager_name
            FROM leads l
            LEFT JOIN users u ON l.manager_id = u.bitrix_id
            WHERE ${where.join(' AND ')}
            ORDER BY l.created_at DESC
            LIMIT 100
        `).all(...params);
        
        res.json(leads);
    } catch (error) {
        console.error('Ошибка детализации отказов:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/analytics/refusals/silent', (req: any, res: any) => {
    try {
        const { startDate, endDate } = req.query;
        let where = ["l.refusal_reason_id IS NULL AND l.status_semantic = 'F'"];
        let params: any[] = [];
        
        if (startDate) { where.push('date(l.created_at) >= ?'); params.push(startDate); }
        if (endDate) { where.push('date(l.created_at) <= ?'); params.push(endDate); }

        const stats = db.prepare(`
            SELECT 
                l.manager_id,
                COALESCE(u.login, 'ID ' || l.manager_id) as manager_name,
                COUNT(l.id) as silent_count
            FROM leads l
            LEFT JOIN users u ON l.manager_id = u.bitrix_id
            WHERE ${where.join(' AND ')}
            GROUP BY l.manager_id
            ORDER BY silent_count DESC
            LIMIT 5
        `).all(...params);
        
        res.json(stats);
    } catch (error) {
        console.error('Ошибка аналитики молчунов:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/manager/:manager_id/remainder', (req: any, res: any) => {
    try {
        const manager_id = req.params.manager_id;
        const stats = db.prepare(`
            SELECT 
                COUNT(id) as total,
                SUM(CASE WHEN status_id LIKE '%NEW%' THEN 1 ELSE 0 END) as import_count,
                SUM(CASE WHEN is_quality = 1 THEN 1 ELSE 0 END) as quality_count,
                SUM(CASE WHEN refusal_reason_id IS NOT NULL OR status_semantic = 'F' THEN 1 ELSE 0 END) as refusal_count,
                -- Взятые в работу: в процессе, не качественные, и НЕ новые (не импорт)
                SUM(CASE WHEN status_semantic = 'P' AND is_quality = 0 AND status_id NOT LIKE '%NEW%' THEN 1 ELSE 0 END) as in_progress_count
            FROM leads
            WHERE manager_id = ?
        `).get(manager_id);
        
        res.json(stats || { total: 0, import_count: 0, quality_count: 0, refusal_count: 0, in_progress_count: 0 });
    } catch (error) {
        console.error('Ошибка остатка базы:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/manager/:manager_id/work-list', (req: any, res: any) => {
    try {
        const manager_id = req.params.manager_id;
        const leads = db.prepare(`
            SELECT 
                l.bitrix_lead_id, 
                l.segmentation as base_name, 
                l.created_at, 
                l.status_id,
                COUNT(c.id) as calls_count
            FROM leads l
            LEFT JOIN calls c ON c.owner_type = 'lead' AND c.owner_id = l.bitrix_lead_id
            WHERE l.manager_id = ?
              AND l.status_semantic = 'P'
              AND l.is_quality = 0
              AND l.status_id NOT LIKE '%NEW%' -- Исключаем только что импортированные
            GROUP BY l.id
            ORDER BY l.created_at DESC
            LIMIT 100
        `).all(manager_id);
        
        const workList = {
            returns: leads.filter(l => l.status_id.toLowerCase().includes('return') || l.calls_count > 5),
            retries: leads.filter(l => l.calls_count > 0 && l.calls_count <= 5 && !l.status_id.toLowerCase().includes('return')),
            new_in_work: leads.filter(l => l.calls_count === 0 && !l.status_id.toLowerCase().includes('return'))
        };
        
        res.json(workList);
    } catch (error) {
        console.error('Ошибка рабочих списков:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});
app.get('/api/users/:bitrix_id/info', (req: any, res: any) => {
    try {
        const user = db.prepare('SELECT qualification FROM users WHERE bitrix_id = ?').get(req.params.bitrix_id) as any;
        res.json({ qualification: user ? user.qualification : 'обычный' });
    } catch(e) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/analytics/products-and-calls', (req: any, res: any) => {
    try {
        const { startDate, endDate, manager_id } = req.query;
        let where = ['l.is_quality = 1']; let params: any[] = [];
        
        if (startDate) { where.push('date(created_at) >= ?'); params.push(startDate); }
        if (endDate) { where.push('date(created_at) <= ?'); params.push(endDate); }
        if (manager_id) { where.push('manager_id = ?'); params.push(manager_id); }

        const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

        const leadsByProduct = db.prepare(`
            SELECT 
                COALESCE(p.name, 'Без продукта') as product_name,
                COUNT(l.id) as quality_leads
            FROM leads l
            LEFT JOIN bases b ON l.base_id = b.id
            LEFT JOIN products p ON b.main_product_id = p.id
            ${whereClause.replace(/created_at/g, 'l.created_at').replace(/manager_id/g, 'l.manager_id')}
            AND l.is_quality = 1
            GROUP BY p.id
            ORDER BY quality_leads DESC
        `).all(...params);

        let callsWhere = []; let callsParams: any[] = [];
        if (startDate) { callsWhere.push('date(started_at) >= ?'); callsParams.push(startDate); }
        if (endDate) { callsWhere.push('date(started_at) <= ?'); callsParams.push(endDate); }
        if (manager_id) { callsWhere.push('manager_id = ?'); callsParams.push(manager_id); }
        
        const callsWhereClause = callsWhere.length ? 'WHERE ' + callsWhere.join(' AND ') : '';

        const callsStats = db.prepare(`
            SELECT 
                COUNT(id) as total_calls,
                SUM(CASE WHEN owner_type IS NULL OR owner_id IS NULL THEN 1 ELSE 0 END) as unassigned_calls,
                SUM(CASE WHEN owner_type IS NOT NULL AND owner_id IS NOT NULL THEN 1 ELSE 0 END) as assigned_calls
            FROM calls
            ${callsWhereClause}
        `).get(...callsParams);

        res.json({ leadsByProduct, callsStats });
    } catch (error) {
        console.error('Ошибка аналитики продуктов/звонков:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

const autoSyncUsers = async () => {
    console.log('👥 Проверка новых сотрудников в Битрикс24...');
    try {
        const response = await fetch(`${process.env.API_URL}/users`, {
            headers: { 'Authorization': `Bearer ${process.env.API_TOKEN}` }
        });
        const data = await response.json();
        
        const defaultPassword = await bcrypt.hash('crm12345', 10);
        const checkBitrixId = db.prepare('SELECT id FROM users WHERE bitrix_id = ?');
        const checkLogin = db.prepare('SELECT id FROM users WHERE login = ?');
        const insertUser = db.prepare('INSERT INTO users (bitrix_id, login, password_hash, role) VALUES (?, ?, ?, ?)');

        let added = 0;

        if (data.ok && data.users) {
            const transliterate = (text: string) => {
                const ru = 'А-а-Б-б-В-в-Г-г-Д-д-Е-е-Ё-ё-Ж-ж-З-з-И-и-Й-й-К-к-Л-л-М-м-Н-н-О-о-П-п-Р-р-С-с-Т-т-У-у-Ф-ф-Х-х-Ц-ц-Ч-ч-Ш-ш-Щ-щ-Ъ-ъ-Ы-ы-Ь-ь-Э-э-Ю-ю-Я-я'.split('-');
                const en = 'A-a-B-b-V-v-G-g-D-d-E-e-E-e-Zh-zh-Z-z-I-i-Y-y-K-k-L-l-M-m-N-n-O-o-P-p-R-r-S-s-T-t-U-u-F-f-Kh-kh-Ts-ts-Ch-ch-Sh-sh-Sch-sch---Y-y---E-e-Yu-yu-Ya-ya'.split('-');
                let res = '';
                for(let i = 0; i < text.length; i++) {
                    let s = text.charAt(i), n = ru.indexOf(s);
                    res += (n >= 0) ? en[n] : s;
                }
                return res.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.').replace(/(^\.|\.$)/g, '');
            };

            db.transaction((usersList) => {
                for (const u of usersList) {
                    if (!u.id) continue; 
                    if (checkBitrixId.get(u.id)) continue;

                    // Если имя пустое или состоит из спецсимволов — даем заглушку
                    let baseName = u.name ? transliterate(u.name) : '';
                    if (!baseName || baseName.length === 0) {
                        baseName = `user_${u.id}`;
                    }
                    
                    let login = baseName;
                    if (checkLogin.get(login)) {
                        login = `${login}.${u.id}`;
                    }

                    insertUser.run(u.id, login, defaultPassword, 'MANAGER');
                    added++;
                }
            })(data.users);
        }

        const info = db.prepare(`
            INSERT INTO users (bitrix_id, login, password_hash, role)
            SELECT DISTINCT manager_id, 'system_bot_' || manager_id, ?, 'MANAGER'
            FROM (
                SELECT manager_id FROM leads WHERE manager_id IS NOT NULL
                UNION
                SELECT manager_id FROM deals WHERE manager_id IS NOT NULL
                UNION
                SELECT manager_id FROM calls WHERE manager_id IS NOT NULL
            )
            WHERE manager_id NOT IN (SELECT bitrix_id FROM users WHERE bitrix_id IS NOT NULL)
        `).run(defaultPassword);

        if (added > 0 || info.changes > 0) {
            console.log(`✅ Обновлена база сотрудников! Из API добавлено: ${added}, Восстановлено системных/удаленных: ${info.changes}`);
        }
    } catch (error) {
        console.error('❌ Ошибка авто-синхронизации пользователей:', error);
    }
};

app.get('/api/analytics/drilldown', (req: any, res: any) => {
    try {
        const { startDate, endDate, manager_id, base_id, metric } = req.query;

        if (metric === 'quality_leads') {
            let where = ['l.is_quality = 1'];
            let params: any[] = [];
            if (startDate) { where.push('date(l.created_at) >= ?'); params.push(startDate); }
            if (endDate) { where.push('date(l.created_at) <= ?'); params.push(endDate); }
            if (manager_id) { where.push('l.manager_id = ?'); params.push(manager_id); }
            if (base_id) { where.push('l.base_id = ?'); params.push(base_id); }

            const q = `
                SELECT l.bitrix_lead_id as b24_id, l.created_at, 'lead' as type, b.name as base_name, u.login as manager_name
                FROM leads l
                LEFT JOIN bases b ON l.base_id = b.id
                LEFT JOIN users u ON l.manager_id = u.bitrix_id
                WHERE ${where.join(' AND ')}
                ORDER BY l.created_at DESC LIMIT 100
            `;
            res.json(db.prepare(q).all(...params));

        } else if (metric === 'paid_deals') {
            let where = ['d.amount > 0'];
            let params: any[] = [];
            if (startDate) { where.push('date(d.created_at) >= ?'); params.push(startDate); }
            if (endDate) { where.push('date(d.created_at) <= ?'); params.push(endDate); }
            if (manager_id) { where.push('d.manager_id = ?'); params.push(manager_id); }
            if (base_id) { where.push('l.base_id = ?'); params.push(base_id); }

            const q = `
                SELECT d.bitrix_deal_id as b24_id, d.created_at, 'deal' as type, d.amount, l.bitrix_lead_id as lead_id, b.name as base_name, u.login as manager_name
                FROM deals d
                LEFT JOIN leads l ON d.lead_id = l.bitrix_lead_id
                LEFT JOIN bases b ON l.base_id = b.id
                LEFT JOIN users u ON d.manager_id = u.bitrix_id
                WHERE ${where.join(' AND ')}
                ORDER BY d.created_at DESC LIMIT 100
            `;
            res.json(db.prepare(q).all(...params));
        } else {
            res.json([]);
        }
    } catch (e) {
        console.error('Ошибка детализации:', e);
        res.status(500).json({ error: 'Ошибка детализации' });
    }
});

app.get('/api/data-issues', (req: any, res: any) => {
    try {
        const issues = {
            noBase: db.prepare("SELECT bitrix_lead_id as id, created_at, manager_id FROM leads WHERE base_id IS NULL AND status_id NOT LIKE '%NEW%' LIMIT 50").all(),
            noManager: db.prepare("SELECT bitrix_lead_id as id, created_at FROM leads WHERE manager_id IS NULL LIMIT 50").all(),
            dealsNoInn: db.prepare("SELECT bitrix_deal_id as id, created_at, amount FROM deals WHERE inn IS NULL AND amount > 0 LIMIT 50").all()
        };
        
        const total = issues.noBase.length + issues.noManager.length + issues.dealsNoInn.length;
        res.json({ total, details: issues });
    } catch (error) {
        console.error('Ошибка проверки качества данных:', error);
        res.status(500).json({ error: 'Ошибка проверки качества данных' });
    }
});

const runBackgroundSync = async () => {
    console.log('🔄 Запуск фоновой синхронизации данных...');
    try {
        await autoSyncUsers();
        await fetch('http://localhost:3000/api/sync-calls');
        await fetch('http://localhost:3000/api/sync-segments');
        await fetch('http://localhost:3000/api/sync-leads');
        await fetch('http://localhost:3000/api/sync-deals');
        await fetch('http://localhost:3000/api/calculate-daily-stats'); 
        console.log('✅ Фоновая синхронизация завершена успешно');
    } catch (error) {
        console.error('❌ Ошибка фоновой синхронизации:', error);
    }
};

setTimeout(() => {
    runBackgroundSync();
    setInterval(runBackgroundSync, 15 * 60 * 1000);
}, 10000);

app.listen(3000, () => {
    console.log('Сервер запущен на http://localhost:3000');
});