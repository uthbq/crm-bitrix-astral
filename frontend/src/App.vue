<script setup lang="ts">
import { ref, computed } from 'vue';
import ManagerDashboard from './components/ManagerDashboard.vue';
import DictionariesManager from './components/DictionariesManager.vue';
import DirectorDashboard from './components/DirectorDashboard.vue';
import PlansManager from './components/PlansManager.vue';

const token = ref('');
const authError = ref('');
const loginUser = ref('');
const loginPass = ref('');

const showLoginPass = ref(false);
const showNewUserPass = ref(false);

const bitrixUsers = ref<any[]>([]);
const newUser = ref({ login: '', password: '', role: 'MANAGER', bitrix_id: '' });

const activeTab = ref('dashboard'); 
const userRole = ref('');
const currentManagerId = ref('');

const searchQuery = ref('');
const showDropdown = ref(false);

const filteredBitrixUsers = computed(() => {
  if (!searchQuery.value) return bitrixUsers.value;
  const query = searchQuery.value.toLowerCase();
  return bitrixUsers.value.filter(u => u.name && u.name.toLowerCase().includes(query));
});

const selectUser = (user: any) => {
  newUser.value.bitrix_id = user.id;
  searchQuery.value = user.name;
  showDropdown.value = false;
  onUserSelect();
};

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
  try {
    const response = await fetch('http://localhost:3000/api/bitrix-users', {
      headers: { 'Authorization': `Bearer ${token.value}` }
    });
    bitrixUsers.value = await response.json();
  } catch (err) {
    console.error('Ошибка загрузки пользователей', err);
  }
};

const login = async () => {
  try {
    const response = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginUser.value, password: loginPass.value })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      token.value = data.token;
      authError.value = '';
      
      try {
        const payload = JSON.parse(atob(data.token.split('.')[1]));
        userRole.value = payload.role; 
        
        if (payload.role === 'DIRECTOR' || payload.role === 'HEAD_OF_DEPT') {
          currentManagerId.value = ''; 
        } else {
          currentManagerId.value = payload.bitrix_id || payload.id || ''; 
        }
      } catch (e) {
        userRole.value = data.role || 'MANAGER';
        if (userRole.value === 'DIRECTOR' || userRole.value === 'HEAD_OF_DEPT') {
          currentManagerId.value = '';
        } else {
          currentManagerId.value = data.bitrix_id || data.id || '';
        }
      }
      
      activeTab.value = 'dashboard';
      
      if (userRole.value === 'DIRECTOR' || userRole.value === 'HEAD_OF_DEPT') {
        await loadBitrixUsers();
      }
    } else {
      authError.value = data.error || 'Ошибка входа';
    }
  } catch (err) {
    authError.value = 'Нет связи с сервером';
  }
};

const createUser = async () => {
  if (!newUser.value.bitrix_id) {
    alert('Пожалуйста, выберите сотрудника из списка!');
    return;
  }
  const response = await fetch('http://localhost:3000/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.value}` },
    body: JSON.stringify(newUser.value)
  });
  const data = await response.json();
  alert(data.message || data.error);
  if (response.ok) {
    searchQuery.value = '';
    newUser.value = { login: '', password: '', role: 'MANAGER', bitrix_id: '' };
  }
};

const logout = () => {
  token.value = '';
  userRole.value = '';
  currentManagerId.value = '';
  activeTab.value = 'dashboard';
};
</script>

<template>
  <div class="app-layout">
    
    <!-- Боковое меню -->
    <div v-if="token" class="sidebar">
      <h2 class="sidebar-title">CRM System</h2>
      
      <div class="user-profile">
        <div class="avatar">👤</div>
        <div>
          <div class="user-name">Мой профиль</div>
          <div class="user-role">{{ loginUser }} ({{ userRole }})</div>
        </div>
      </div>
      
      <nav class="nav-menu">
        <button 
          @click="activeTab = 'dashboard'" 
          :class="['nav-btn', { active: activeTab === 'dashboard' }]"
        >
          📊 Дашборд
        </button>
        
        <button 
          v-if="userRole === 'DIRECTOR' || userRole === 'HEAD_OF_DEPT'" 
          @click="activeTab = 'users'" 
          :class="['nav-btn', { active: activeTab === 'users' }]"
        >
          👥 Сотрудники
        </button>

        <button 
          v-if="userRole === 'DIRECTOR' || userRole === 'HEAD_OF_DEPT'" 
          @click="activeTab = 'plans'" 
          :class="['nav-btn', { active: activeTab === 'plans' }]"
        >
          📅 Планы и Нормативы
        </button>

        <button 
          v-if="userRole === 'DIRECTOR' || userRole === 'HEAD_OF_DEPT'" 
          @click="activeTab = 'dictionaries'" 
          :class="['nav-btn', { active: activeTab === 'dictionaries' }]"
        >
          📁 Справочники
        </button>
      </nav>
      
      <button @click="logout" class="btn-logout">Выйти</button>
    </div>

    <div class="main-content">
      
      <div v-if="!token" class="login-card">
        <h2 class="login-title">Вход в систему</h2>
        <input v-model="loginUser" placeholder="Логин" class="input-dark" />
        <div class="password-input">
          <input v-model="loginPass" :type="showLoginPass ? 'text' : 'password'" placeholder="Пароль" class="input-dark no-margin-bottom" @keyup.enter="login" />
          <button @click="showLoginPass = !showLoginPass" class="btn-eye">{{ showLoginPass ? '🙈' : '👁️' }}</button>
        </div>
        <button @click="login" class="btn-primary w-full">Войти</button>
        <p class="error-msg">{{ authError }}</p>
      </div>

      <div v-else class="content-wrapper">
        
        <div v-if="activeTab === 'users' && (userRole === 'DIRECTOR' || userRole === 'HEAD_OF_DEPT')" class="card add-user-card">
          <h3 class="card-title">Добавление менеджера</h3>
          
          <label class="form-label">Поиск по сотрудникам Битрикс24</label>
          <div class="autocomplete-wrapper">
            <input 
              v-model="searchQuery" 
              @focus="showDropdown = true" 
              @blur="setTimeout(() => showDropdown = false, 200)"
              placeholder="Начните вводить имя..." 
              class="input-light"
            />
            
            <div v-if="showDropdown && filteredBitrixUsers.length" class="dropdown-list">
              <div 
                v-for="user in filteredBitrixUsers" 
                :key="user.id" 
                @click="selectUser(user)" 
                class="dropdown-item"
              >
                {{ user.name }} <span class="text-muted">(ID: {{ user.id }})</span>
              </div>
            </div>
            
            <div v-if="showDropdown && !filteredBitrixUsers.length" class="dropdown-list empty-state">
              Сотрудник не найден
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Системный логин</label>
              <input v-model="newUser.login" placeholder="Генерируется..." class="input-dark" />
            </div>
            <div class="form-group">
              <label class="form-label">Временный пароль</label>
              <div class="password-input">
                <input v-model="newUser.password" :type="showNewUserPass ? 'text' : 'password'" class="input-dark no-margin-bottom" />
                <button @click="showNewUserPass = !showNewUserPass" class="btn-eye">{{ showNewUserPass ? '🙈' : '👁️' }}</button>
              </div>
            </div>
          </div>
          
          <label class="form-label">Уровень доступа</label>
          <select v-model="newUser.role" class="input-light mb-4">
            <option value="MANAGER">Менеджер</option>
            <option value="HEAD_OF_DEPT">Руководитель отдела</option>
            <option value="DIRECTOR">Директор</option>
          </select>
          <button @click="createUser" class="btn-success w-full">Сохранить в базу</button>
        </div>

        <div v-if="activeTab === 'plans' && (userRole === 'DIRECTOR' || userRole === 'HEAD_OF_DEPT')" class="w-full max-w-1000 bg-transparent">
          <PlansManager />
        </div>

        <div v-if="activeTab === 'dictionaries' && (userRole === 'DIRECTOR' || userRole === 'HEAD_OF_DEPT')" class="w-full max-w-1000 bg-transparent">
          <DictionariesManager />
        </div>

        <div v-if="activeTab === 'dashboard'" class="card w-full max-w-1000">
          <ManagerDashboard v-if="userRole === 'MANAGER'" :managerId="currentManagerId" />
          <DirectorDashboard v-else />
        </div>

      </div>
    </div>
  </div>
</template>

<style>
/* Базовые стили */

/* Лейаут */
.app-layout {
  display: flex;
  min-height: 100vh;
}

/* Боковое меню */
.sidebar {
  width: 260px;
  background-color: #2c3e50;
  color: white;
  display: flex;
  flex-direction: column;
  padding: 20px;
  box-sizing: border-box;
}
.sidebar-title {
  margin-top: 0;
  padding-bottom: 20px;
  border-bottom: 1px solid #34495e;
}
.user-profile {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-bottom: 30px;
}
.avatar {
  width: 45px;
  height: 45px;
  background: #3498db;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 20px;
}
.user-name {
  font-weight: bold;
  font-size: 16px;
}
.user-role {
  font-size: 13px;
  color: #bdc3c7;
}

/* Навигация */
.nav-menu {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.nav-btn {
  background: transparent;
  border: none;
  color: white;
  text-align: left;
  padding: 12px 15px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 15px;
  transition: background 0.2s;
  width: 100%;
  box-sizing: border-box;
}
.nav-btn.active, .nav-btn:hover {
  background: #34495e;
}
.btn-logout {
  margin-top: auto;
  background: #e74c3c;
  border: none;
  color: white;
  padding: 12px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: bold;
  transition: background 0.2s;
  width: 100%;
}
.btn-logout:hover {
  background: #c0392b;
}

/* Основной контент */
.main-content {
  flex: 1;
  background-color: #f5f6fa;
  padding: 40px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  box-sizing: border-box;
  overflow-x: hidden;
}
.content-wrapper {
  width: 100%;
  display: flex;
  justify-content: center;
}
.card {
  background: white;
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.05);
}
.card-title {
  margin-top: 0;
  color: #2c3e50;
  border-bottom: 2px solid #f5f6fa;
  padding-bottom: 15px;
}
.login-card {
  background: white;
  padding: 40px;
  border-radius: 12px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.05);
  width: 100%;
  max-width: 350px;
  margin-top: 10vh;
}
.login-title {
  text-align: center;
  margin-top: 0;
  color: #2c3e50;
}
.add-user-card {
  width: 100%;
  max-width: 500px;
}

/* Формы и поля ввода */
.form-label {
  display: block;
  margin-bottom: 5px;
  color: #7f8c8d;
  font-size: 14px;
}
.form-row {
  display: flex;
  gap: 15px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.form-group {
  flex: 1;
  min-width: 200px;
}
.input-dark {
  width: 100%;
  padding: 12px;
  margin-bottom: 15px;
  background: #2c3e50;
  color: white;
  border: 1px solid #34495e;
  border-radius: 6px;
  box-sizing: border-box;
  outline: none;
}
.input-dark.no-margin-bottom {
  margin-bottom: 0;
  border-radius: 6px 0 0 6px;
}
.input-light {
  width: 100%;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  box-sizing: border-box;
  outline: none;
  font-size: 15px;
}
.password-input {
  display: flex;
  margin-bottom: 20px;
  width: 100%;
}
.btn-eye {
  background: #34495e;
  border: none;
  color: white;
  padding: 0 12px;
  border-radius: 0 6px 6px 0;
  cursor: pointer;
}

.autocomplete-wrapper {
  position: relative;
  margin-bottom: 20px;
}
.dropdown-list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #ddd;
  border-radius: 6px;
  max-height: 250px;
  overflow-y: auto;
  z-index: 1000;
  box-shadow: 0 8px 16px rgba(0,0,0,0.1);
  margin-top: 5px;
}
.dropdown-item {
  padding: 12px;
  cursor: pointer;
  border-bottom: 1px solid #f5f6fa;
  font-size: 14px;
}
.dropdown-item:last-child {
  border-bottom: none;
}
.dropdown-item:hover {
  background-color: #f0f4f8;
}
.empty-state {
  padding: 12px;
  color: #7f8c8d;
}

.btn-primary {
  background: #3498db;
  color: white;
  border: none;
  padding: 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
}
.btn-primary:hover {
  background: #2980b9;
}
.btn-success {
  background: #2ecc71;
  color: white;
  border: none;
  padding: 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
}
.btn-success:hover {
  background: #27ae60;
}
.w-full {
  width: 100%;
}
.max-w-1000 {
  max-width: 1000px;
}
.mb-4 {
  margin-bottom: 25px;
}
.bg-transparent {
  background: transparent;
  padding: 0;
}
.text-muted {
  color: #95a5a6;
  font-size: 12px;
}
.error-msg {
  color: #e74c3c;
  text-align: center;
  margin-bottom: 0;
  min-height: 20px;
  margin-top: 10px;
}

@media (max-width: 768px) {
  .app-layout {
    flex-direction: column;
  }
  .sidebar {
    width: 100%;
    padding: 15px;
  }
  .main-content {
    padding: 20px 10px;
  }
  .form-row {
    flex-direction: column;
    gap: 0;
  }
  .form-group {
    width: 100%;
  }
}
</style>