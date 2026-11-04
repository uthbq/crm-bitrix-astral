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