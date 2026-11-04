import db from './database';
import bcrypt from 'bcrypt';

async function createAdmin() {
    const login = 'DIRECTOR';
    const rawPassword = 'qwerty123';
    const saltRounds = 10;
    
    const hash = await bcrypt.hash(rawPassword, saltRounds);
    
    const stmt = db.prepare(`
        INSERT INTO users (login, password_hash, role) 
        VALUES (?, ?, ?)
    `);
    
    try {
        stmt.run(login, hash, 'DIRECTOR');
        console.log(`DIRECTOR '${login}' успешно создан с зашифрованным паролем!`);
    } catch (err: any) {
        console.error('Ошибка (возможно, такой логин уже существует):', err.message);
    }
}

createAdmin();