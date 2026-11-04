<script setup lang="ts">
import { ref } from 'vue';

const token = ref('');
const authError = ref('');
const loginUser = ref('');
const loginPass = ref('');

const showLoginPass = ref(false);
const showNewUserPass = ref(false);

const bitrixUsers = ref<any[]>([]);
const newUser = ref({ login: '', password: '', role: 'MANAGER', bitrix_id: '' });

const transliterate = (text: string) => {
  const ru = 'А-а-Б-б-В-в-Г-г-Д-д-Е-е-Ё-ё-Ж-ж-З-з-И-и-Й-й-К-к-Л-л-М-м-Н-н-О-о-П-п-Р-р-С-с-Т-т-У-у-Ф-ф-Х-х-Ц-ц-Ч-ч-Ш-ш-Щ-щ-Ъ-ъ-Ы-ы-Ь-ь-Э-э-Ю-ю-Я-я'.split('-');
  const en = 'A-a-B-b-V-v-G-g-D-d-E-e-E-e-Zh-zh-Z-z-I-i-Y-y-K-k-L-l-M-m-N-n-O-o-P-p-R-r-S-s-T-t-U-u-F-f-Kh-kh-Ts-ts-Ch-ch-Sh-sh-Sch-sch---Y-y---E-e-Yu-yu-Ya-ya'.split('-');
  let res = '';
  for(let i=0, l=text.length; i<l; i++) {
    let s = text.charAt(i), n = ru.indexOf(s);
    res += (n >= 0) ? en[n] : s;
  }
  return res.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.');
};

const onUserSelect = () => {
  const selectedUser = bitrixUsers.value.find(u => u.id === newUser.value.bitrix_id);
  if (selectedUser && selectedUser.name) {
    newUser.value.login = transliterate(selectedUser.name);
  }
};

const loadBitrixUsers = async () => {
  const response = await fetch('http://localhost:3000/api/bitrix-users', {
    headers: { 'Authorization': `Bearer ${token.value}` }
  });
  bitrixUsers.value = await response.json();
};

const login = async () => {
  const response = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginUser.value, password: loginPass.value })
  });
  const data = await response.json();
  if (response.ok) {
    token.value = data.token;
    authError.value = '';
    await loadBitrixUsers();
  } else {
    authError.value = data.error;
  }
};

const createUser = async () => {
  const response = await fetch('http://localhost:3000/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.value}` },
    body: JSON.stringify(newUser.value)
  });
  const data = await response.json();
  alert(data.message || data.error);
};
</script>

<template>
  <div style="display: flex; min-height: 100vh; font-family: Arial, sans-serif; margin: -8px;">
    
    <div v-if="token" style="width: 260px; background-color: #2c3e50; color: white; display: flex; flex-direction: column; padding: 20px;">
      <h2 style="margin-top: 0; padding-bottom: 20px; border-bottom: 1px solid #34495e;">CRM System</h2>
      <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 30px;">
        <div style="width: 45px; height: 45px; background: #3498db; border-radius: 50%; display: flex; justify-content: center; align-items: center; font-size: 20px;">👤</div>
        <div>
          <div style="font-weight: bold; font-size: 16px;">Мой профиль</div>
          <div style="font-size: 13px; color: #bdc3c7;">{{ loginUser }}</div>
        </div>
      </div>
      <button style="background: #34495e; border: none; color: white; text-align: left; padding: 12px 15px; border-radius: 6px; cursor: pointer; font-size: 15px; margin-bottom: 10px;">👥 Сотрудники</button>
      <button style="background: transparent; border: none; color: #7f8c8d; text-align: left; padding: 12px 15px; border-radius: 6px; font-size: 15px;">📞 Звонки (скоро)</button>
      <button @click="token = ''" style="margin-top: auto; background: #e74c3c; border: none; color: white; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: bold;">Выйти</button>
    </div>

    <div style="flex: 1; background-color: #f5f6fa; padding: 40px; display: flex; justify-content: center; align-items: flex-start;">
      
      <div v-if="!token" style="background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); width: 100%; max-width: 350px; margin-top: 10vh;">
        <h2 style="text-align: center; margin-top: 0; color: #2c3e50;">Вход в систему</h2>
        
        <input v-model="loginUser" placeholder="Логин (например, director)" style="width: 100%; padding: 12px; margin-bottom: 15px; background: #2c3e50; color: white; border: 1px solid #34495e; border-radius: 6px; box-sizing: border-box; outline: none;" />
        
        <div style="display: flex; margin-bottom: 20px;">
          <input v-model="loginPass" :type="showLoginPass ? 'text' : 'password'" placeholder="Пароль" style="flex: 1; padding: 12px; background: #2c3e50; color: white; border: 1px solid #34495e; border-radius: 6px 0 0 6px; box-sizing: border-box; outline: none;" />
          <button @click="showLoginPass = !showLoginPass" style="background: #34495e; border: none; color: white; padding: 0 12px; border-radius: 0 6px 6px 0; cursor: pointer;">
            {{ showLoginPass ? '🙈' : '👁️' }}
          </button>
        </div>

        <button @click="login" style="width: 100%; background: #3498db; color: white; border: none; padding: 14px; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold;">Войти</button>
        <p style="color: #e74c3c; text-align: center; margin-bottom: 0;">{{ authError }}</p>
      </div>

      <div v-else style="background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); width: 100%; max-width: 500px;">
        <h3 style="margin-top: 0; color: #2c3e50; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px;">Добавление менеджера</h3>
        
        <label style="display: block; margin-bottom: 5px; color: #7f8c8d; font-size: 14px;">Выберите из API Битрикс24</label>
        <select v-model="newUser.bitrix_id" @change="onUserSelect" style="width: 100%; padding: 12px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; outline: none;">
          <option disabled value="">Выберите сотрудника</option>
          <option v-for="user in bitrixUsers" :key="user.id" :value="user.id">{{ user.name }}</option>
        </select>
        
        <div style="display: flex; gap: 15px; margin-bottom: 20px;">
          <div style="flex: 1;">
            <label style="display: block; margin-bottom: 5px; color: #7f8c8d; font-size: 14px;">Системный логин</label>
            <input v-model="newUser.login" placeholder="Генерируется..." style="width: 100%; padding: 12px; background: #2c3e50; color: white; border: 1px solid #34495e; border-radius: 6px; box-sizing: border-box; outline: none;" />
          </div>
          <div style="flex: 1;">
            <label style="display: block; margin-bottom: 5px; color: #7f8c8d; font-size: 14px;">Временный пароль</label>
            
            <div style="display: flex;">
              <input v-model="newUser.password" :type="showNewUserPass ? 'text' : 'password'" style="flex: 1; padding: 12px; background: #2c3e50; color: white; border: 1px solid #34495e; border-radius: 6px 0 0 6px; box-sizing: border-box; outline: none;" />
              <button @click="showNewUserPass = !showNewUserPass" style="background: #34495e; border: none; color: white; padding: 0 12px; border-radius: 0 6px 6px 0; cursor: pointer;">
                {{ showNewUserPass ? '🙈' : '👁️' }}
              </button>
            </div>
            
          </div>
        </div>

        <label style="display: block; margin-bottom: 5px; color: #7f8c8d; font-size: 14px;">Уровень доступа</label>
        <select v-model="newUser.role" style="width: 100%; padding: 12px; margin-bottom: 25px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; outline: none;">
          <option value="MANAGER">Менеджер</option>
          <option value="HEAD_OF_DEPT">Руководитель отдела</option>
          <option value="DIRECTOR">Директор</option>
        </select>
        
        <button @click="createUser" style="width: 100%; background: #2ecc71; color: white; border: none; padding: 14px; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold;">Сохранить в базу</button>
      </div>

    </div>
  </div>
</template>