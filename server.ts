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

app.get('/api/sync-calls', async (req: any, res: any) => {
    try {
        const response = await fetch(`${process.env.API_URL}/calls?limit=100`, {
            headers: {
                'Authorization': `Bearer ${process.env.API_TOKEN}`
            }
        });
        
        const data = await response.json();

        if (!data.ok || !data.calls) {
            return res.status(400).json({ error: 'Ошибка от API Битрикса' });
        }

        const stmt = db.prepare(`
            INSERT OR IGNORE INTO calls 
            (bitrix_call_id, manager_id, direction, duration_seconds, started_at, owner_type, owner_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        let insertedCount = 0;

        const insertMany = db.transaction((calls) => {
            for (const call of calls) {
                const startTime = new Date(call.startTime).getTime();
                const endTime = new Date(call.endTime).getTime();
                const durationSeconds = Math.max(0, Math.round((endTime - startTime) / 1000));
                
                const ownerType = call.owner ? call.owner.type : null;
                const ownerId = call.owner ? call.owner.id : null;

                const info = stmt.run(
                    call.id,
                    call.responsibleId,
                    call.direction,
                    durationSeconds,
                    call.startTime,
                    ownerType,
                    ownerId
                );
                
                if (info.changes > 0) insertedCount++;
            }
        });

        insertMany(data.calls);

        res.json({ 
            message: 'Синхронизация успешна', 
            total_fetched: data.calls.length, 
            new_inserted: insertedCount 
        });

    } catch (error) {
        console.error('Ошибка синхронизации звонков:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
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
app.get('/api/sync-leads', async (req: any, res: any) => {
    try {
        const response = await fetch(`${process.env.API_URL}/leads?limit=100`, {
            headers: {
                'Authorization': `Bearer ${process.env.API_TOKEN}`
            }
        });
        
        const data = await response.json();

        if (!data.ok || !data.leads) {
            return res.status(400).json({ error: 'Ошибка от API Битрикса' });
        }

        const stmt = db.prepare(`
            INSERT INTO leads (bitrix_lead_id, inn, status_id, manager_id, segmentation) 
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(bitrix_lead_id) DO UPDATE SET
                status_id = excluded.status_id,
                manager_id = excluded.manager_id,
                segmentation = excluded.segmentation
        `);

        const insertMany = db.transaction((leads) => {
            for (const lead of leads) {
                const segmentsStr = lead.segments ? JSON.stringify(lead.segments) : null;
                const statusId = lead.status ? lead.status.id : null;

                stmt.run(
                    lead.id,
                    lead.inn || null,
                    statusId,
                    lead.assignedById,
                    segmentsStr
                );
            }
        });

        insertMany(data.leads);

        res.json({ 
            message: 'Синхронизация лидов успешна', 
            total_fetched: data.leads.length
        });

    } catch (error) {
        console.error('Ошибка синхронизации лидов:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});
app.get('/api/sync-leads', async (req: any, res: any) => {
    try {
        const response = await fetch(`${process.env.API_URL}/leads?limit=100`, {
            headers: {
                'Authorization': `Bearer ${process.env.API_TOKEN}`
            }
        });
        
        const data = await response.json();

        if (!data.ok || !data.leads) {
            return res.status(400).json({ error: 'Ошибка от API Битрикса' });
        }

        const stmt = db.prepare(`
            INSERT INTO leads (bitrix_lead_id, inn, status_id, manager_id, segmentation) 
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(bitrix_lead_id) DO UPDATE SET
                status_id = excluded.status_id,
                manager_id = excluded.manager_id,
                segmentation = excluded.segmentation
        `);

        const insertMany = db.transaction((leads) => {
            for (const lead of leads) {
                const segmentsStr = lead.segments ? JSON.stringify(lead.segments) : null;
                const statusId = lead.status ? lead.status.id : null;

                stmt.run(
                    lead.id,
                    lead.inn || null,
                    statusId,
                    lead.assignedById,
                    segmentsStr
                );
            }
        });

        insertMany(data.leads);

        res.json({ 
            message: 'Синхронизация лидов успешна', 
            total_fetched: data.leads.length
        });

    } catch (error) {
        console.error('Ошибка синхронизации лидов:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});
app.get('/api/sync-deals', async (req: any, res: any) => {
    try {
        const response = await fetch(`${process.env.API_URL}/deals?limit=100`, {
            headers: {
                'Authorization': `Bearer ${process.env.API_TOKEN}`
            }
        });
        
        const data = await response.json();

        if (!data.ok || !data.deals) {
            return res.status(400).json({ error: 'Ошибка от API Битрикса' });
        }

        const stmt = db.prepare(`
            INSERT INTO deals (bitrix_deal_id, lead_id, manager_id, inn, stage_id, amount) 
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(bitrix_deal_id) DO UPDATE SET
                stage_id = excluded.stage_id,
                manager_id = excluded.manager_id,
                amount = excluded.amount
        `);

        const insertMany = db.transaction((deals) => {
            for (const deal of deals) {
                const stageId = deal.stage ? deal.stage.id : null;
                
                stmt.run(
                    deal.id,
                    deal.leadId || null,
                    deal.assignedById,
                    deal.inn || null,
                    stageId,
                    deal.amount || 0
                );
            }
        });

        insertMany(data.deals);

        res.json({ 
            message: 'Синхронизация сделок успешна', 
            total_fetched: data.deals.length
        });

    } catch (error) {
        console.error('Ошибка синхронизации сделок:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
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

app.listen(3000, () => {
    console.log('Сервер запущен на http://localhost:3000');
});