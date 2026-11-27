<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import ManagerDashboard from './components/ManagerDashboard.vue';
import DictionariesManager from './components/DictionariesManager.vue';
import DirectorDashboard from './components/DirectorDashboard.vue';
import PlansManager from './components/PlansManager.vue';
import RatingsBoard from './components/RatingsBoard.vue';
import DepartmentsManager from './components/DepartmentsManager.vue';
import StuckEntities from './components/StuckEntities.vue';
import TeamsFunnel from './components/TeamsFunnel.vue';

// ---------- Авторизация ----------
const token = ref('');
const authError = ref('');
const loginUser = ref('');
const loginPass = ref('');
const showLoginPass = ref(false);
const showNewUserPass = ref(false);

const userRole = ref('');
const currentManagerId = ref('');
const activeTab = ref('dashboard');

// ---------- Сотрудники и справочники ----------
const bitrixUsers = ref<any[]>([]);
const departments = ref<any[]>([]);
const newUser = ref({ login: '', password: '', role: 'MANAGER', bitrix_id: '', qualification: 'обычный', department_id: '' });

const searchQuery = ref('');
const showDropdown = ref(false);
const creatingUser = ref(false);
const createSuccess = ref('');

// ---------- Синхронизация ----------
const lastSync = ref<any>(null);

const filteredBitrixUsers = computed(() => {
  if (!searchQuery.value.trim()) return bitrixUsers.value;
  const q = searchQuery.value.toLowerCase();
  return bitrixUsers.value.filter(u => u.name && u.name.toLowerCase().includes(q));
});

const selectedBitrixUser = computed(() =>
  bitrixUsers.value.find(u => u.id === newUser.value.bitrix_id) || null
);

const userInitials = computed(() => {
  const name = selectedBitrixUser.value?.name || '';
  if (!name.trim()) return '?';
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
});

const activeTabTitle = computed(() => {
  const map: Record<string, string> = {
    dashboard: 'Дашборд', ratings: 'Доска почёта', teams: 'Команды и воронки',
    stuck: 'Зависшие карточки', users: 'Сотрудники', departments: 'Отделы',
    plans: 'Планы и нормативы', dictionaries: 'Справочники'
  };
  return map[activeTab.value] || 'CRM';
});

const lastSyncText = computed(() => {
  if (!lastSync.value) return '';
  const raw = lastSync.value.ts || lastSync.value.timestamp || lastSync.value.created_at || lastSync.value.time;
  if (!raw) return '';
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
});

const qualificationHint = computed(() =>
  newUser.value.qualification === 'ведущий'
    ? 'Разговор засчитывается от 59 секунд'
    : 'Разговор засчитывается от 44 секунд'
);

const roleLabel = (r: string) =>
  ({ MANAGER: 'Менеджер', HEAD_OF_DEPT: 'Руководитель отдела', DIRECTOR: 'Директор' } as any)[r] || r;

// Роли, которые текущий пользователь вправе назначать:
// руководитель отдела создаёт только менеджеров (иначе сервер вернёт 403)
const availableRoles = computed(() => {
  const roles = [{ value: 'MANAGER', label: 'Менеджер' }];
  if (userRole.value === 'DIRECTOR') {
    roles.push({ value: 'HEAD_OF_DEPT', label: 'Руководитель отдела' });
    roles.push({ value: 'DIRECTOR', label: 'Директор' });
  }
  return roles;
});

const onRoleChange = () => {
  // Квалификация имеет смысл только для менеджеров
  if (newUser.value.role !== 'MANAGER') newUser.value.qualification = 'обычный';
};

// ---------- Иконки ----------
const ensureFontAwesome = () => {
  if (document.getElementById('fa-cdn')) return;
  const link = document.createElement('link');
  link.id = 'fa-cdn';
  link.rel = 'stylesheet';
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
  document.head.appendChild(link);
};

// ---------- Загрузка данных ----------
const loadBitrixUsers = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/bitrix-users', {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    if (res.ok) bitrixUsers.value = await res.json();
  } catch (e) { console.error('Ошибка загрузки сотрудников', e); }
};

const loadDepartments = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/departments');
    if (res.ok) departments.value = await res.json();
  } catch (e) { console.error('Ошибка загрузки отделов', e); }
};

const loadSyncStatus = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/sync-log');
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data) && data.length) lastSync.value = data[0];
    else if (data && !Array.isArray(data)) lastSync.value = data;
  } catch { /* эндпоинт может отсутствовать */ }
};

// ---------- Вход / выход ----------
const parseRoleAndId = (data: any) => {
  try {
    const payload = JSON.parse(atob(data.token.split('.')[1]));
    userRole.value = payload.role;
    currentManagerId.value = (payload.role === 'DIRECTOR' || payload.role === 'HEAD_OF_DEPT')
      ? '' : (payload.bitrix_id || payload.id || '');
  } catch {
    userRole.value = data.role || 'MANAGER';
    currentManagerId.value = (userRole.value === 'DIRECTOR' || userRole.value === 'HEAD_OF_DEPT')
      ? '' : (data.bitrix_id || data.id || '');
  }
};

const login = async () => {
  authError.value = '';
  if (!loginUser.value.trim() || !loginPass.value) {
    authError.value = 'Введите логин и пароль';
    return;
  }
  try {
    const res = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginUser.value, password: loginPass.value })
    });
    const data = await res.json();
    if (!res.ok) { authError.value = data.error || 'Ошибка входа'; return; }
    token.value = data.token;
    parseRoleAndId(data);
    activeTab.value = 'dashboard';
    if (userRole.value === 'DIRECTOR' || userRole.value === 'HEAD_OF_DEPT') {
      await Promise.all([loadBitrixUsers(), loadDepartments()]);
    }
    await loadSyncStatus();
  } catch {
    authError.value = 'Нет связи с сервером';
  }
};

const logout = () => {
  token.value = '';
  userRole.value = '';
  currentManagerId.value = '';
  activeTab.value = 'dashboard';
  lastSync.value = null;
};

// ---------- Добавление сотрудника ----------
const transliterate = (text: string) => {
  const ru = 'А-а-Б-б-В-в-Г-г-Д-д-Е-е-Ё-ё-Ж-ж-З-з-И-и-Й-й-К-к-Л-л-М-м-Н-н-О-о-П-п-Р-р-С-с-Т-т-У-у-Ф-ф-Х-х-Ц-ц-Ч-ч-Ш-ш-Щ-щ-Ъ-ъ-Ы-ы-Ь-ь-Э-э-Ю-ю-Я-я'.split('-');
  const en = 'A-a-B-b-V-v-G-g-D-d-E-e-E-e-Zh-zh-Z-z-I-i-Y-y-K-k-L-l-M-m-N-n-O-o-P-p-R-r-S-s-T-t-U-u-F-f-Kh-kh-Ts-ts-Ch-ch-Sh-sh-Sch-sch---Y-y---E-e-Yu-yu-Ya-ya'.split('-');
  let res = '';
  for (let i = 0; i < text.length; i++) {
    const s = text.charAt(i); const n = ru.indexOf(s);
    res += n >= 0 ? en[n] : s;
  }
  return res.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.').replace(/(^\.|\.$)/g, '');
};

const selectUser = (user: any) => {
  newUser.value.bitrix_id = user.id;
  searchQuery.value = user.name;
  showDropdown.value = false;
  if (user.name && !newUser.value.login) newUser.value.login = transliterate(user.name);
};

const clearSelectedUser = () => {
  newUser.value.bitrix_id = '';
  searchQuery.value = '';
  createSuccess.value = '';
};

const hideDropdown = () => { setTimeout(() => { showDropdown.value = false; }, 200); };

const generatePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let p = '';
  for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
  newUser.value.password = p;
  showNewUserPass.value = true;
};

const createUser = async () => {
  if (!newUser.value.bitrix_id) return;
  if (!newUser.value.login.trim()) { alert('Укажите системный логин.'); return; }
  if (!newUser.value.password) { alert('Укажите или сгенерируйте пароль.'); return; }
  creatingUser.value = true;
  createSuccess.value = '';
  try {
    const res = await fetch('http://localhost:3000/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({
        ...newUser.value,
        // Квалификация нужна только менеджерам — порог разговора 44/59 сек
        qualification: newUser.value.role === 'MANAGER' ? newUser.value.qualification : null,
        department_id: newUser.value.department_id || null
      })
    });
    const data = await res.json();
    if (res.ok) {
      createSuccess.value = `Сотрудник «${selectedBitrixUser.value?.name || newUser.value.login}» добавлен. Передайте ему временный пароль.`;
      newUser.value = { login: '', password: '', role: 'MANAGER', bitrix_id: '', qualification: 'обычный', department_id: '' };
      searchQuery.value = '';
      showNewUserPass.value = false;
    } else {
      alert(data.error || 'Ошибка сохранения');
    }
  } catch {
    alert('Нет связи с сервером');
  } finally {
    creatingUser.value = false;
  }
};

// ---------- Навигация ----------
const navGroups = computed(() => {
  const canManage = userRole.value === 'DIRECTOR' || userRole.value === 'HEAD_OF_DEPT';
  return [
    {
      title: 'Аналитика',
      items: [
        { key: 'dashboard', icon: 'fa-gauge-high', label: 'Дашборд', show: true },
        { key: 'ratings', icon: 'fa-trophy', label: 'Доска почёта', show: true },
        { key: 'teams', icon: 'fa-rocket', label: 'Команды и воронки', show: canManage },
        { key: 'stuck', icon: 'fa-hourglass-half', label: 'Зависшие', show: canManage }
      ].filter(i => i.show)
    },
    {
      title: 'Управление',
      items: [
        { key: 'users', icon: 'fa-users', label: 'Сотрудники', show: canManage },
        { key: 'departments', icon: 'fa-building', label: 'Отделы', show: canManage },
        { key: 'plans', icon: 'fa-calendar-days', label: 'Планы и нормативы', show: canManage },
        { key: 'dictionaries', icon: 'fa-folder-open', label: 'Справочники', show: canManage }
      ].filter(i => i.show)
    }
  ].filter(g => g.items.length);
});

onMounted(() => { ensureFontAwesome(); });
</script>

<template>
  <div class="app-layout">
    <!-- ================= САЙДБАР ================= -->
    <aside v-if="token" class="sidebar">
      <div class="sidebar-brand">
        <span class="brand-icon"><i class="fas fa-chart-pie"></i></span>
        <span class="brand-text">CRM System</span>
      </div>

      <div class="user-profile">
        <div class="avatar">{{ (loginUser || 'U').charAt(0).toUpperCase() }}</div>
        <div class="user-meta">
          <div class="user-name">{{ loginUser || 'Профиль' }}</div>
          <div class="user-role">{{ roleLabel(userRole) }}</div>
        </div>
      </div>

      <nav class="nav-menu">
        <template v-for="group in navGroups" :key="group.title">
          <div class="nav-section-title">{{ group.title }}</div>
          <button
            v-for="item in group.items" :key="item.key"
            @click="activeTab = item.key"
            :class="['nav-btn', { active: activeTab === item.key }]"
          >
            <i :class="['fas', item.icon, 'nav-icon']"></i>
            <span>{{ item.label }}</span>
          </button>
        </template>
      </nav>

      <div class="sidebar-footer">
        <div v-if="lastSyncText" class="sync-status">
          <i class="fas fa-arrows-rotate"></i>
          <span>Синхронизация: {{ lastSyncText }}</span>
        </div>
        <button @click="logout" class="btn-logout">
          <i class="fas fa-right-from-bracket"></i> Выйти
        </button>
      </div>
    </aside>

    <!-- ================= ЭКРАН ВХОДА ================= -->
    <div v-if="!token" class="login-screen">
      <div class="login-decor decor-1"></div>
      <div class="login-decor decor-2"></div>
      <div class="login-decor decor-3"></div>

      <div class="login-card">
        <div class="login-logo"><i class="fas fa-chart-pie"></i></div>
        <h1 class="login-title">Вход в систему</h1>
        <p class="login-subtitle">Дашборд телемаркетинга и продаж</p>

        <form @submit.prevent="login" class="login-form">
          <label class="field">
            <span class="field-label">Логин</span>
            <div class="field-input">
              <i class="fas fa-user"></i>
              <input v-model="loginUser" placeholder="Введите логин" autocomplete="username" />
            </div>
          </label>

          <label class="field">
            <span class="field-label">Пароль</span>
            <div class="field-input">
              <i class="fas fa-lock"></i>
              <input
                v-model="loginPass"
                :type="showLoginPass ? 'text' : 'password'"
                placeholder="Введите пароль"
                autocomplete="current-password"
                @keyup.enter="login"
              />
              <button type="button" class="field-eye" @click="showLoginPass = !showLoginPass">
                <i :class="showLoginPass ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
              </button>
            </div>
          </label>

          <div v-if="authError" class="login-error">
            <i class="fas fa-circle-exclamation"></i> {{ authError }}
          </div>

          <button type="submit" class="login-btn">
            <i class="fas fa-arrow-right-to-bracket"></i> Войти в систему
          </button>
        </form>

        <p class="login-hint">
          <i class="fas fa-circle-info"></i> Данные обновляются из модуля интеграции Битрикс24
        </p>
      </div>
    </div>

    <!-- ================= ОСНОВНАЯ ОБЛАСТЬ ================= -->
    <div v-else class="main-content">
      <header class="topbar">
        <h1 class="topbar-title">{{ activeTabTitle }}</h1>
        <div v-if="lastSyncText" class="topbar-sync">
          <i class="fas fa-clock"></i> Обновлено: {{ lastSyncText }}
        </div>
      </header>

      <div class="content-wrapper">
        <!-- ===== ЭКРАН ДОБАВЛЕНИЯ СОТРУДНИКОВ ===== -->
        <div v-if="activeTab === 'users' && (userRole === 'DIRECTOR' || userRole === 'HEAD_OF_DEPT')" class="users-screen">
          <div class="users-header">
            <h2><i class="fas fa-user-plus"></i> Добавление сотрудника</h2>
            <p>Выберите человека из Битрикс24, задайте учётные данные и права доступа. Метрики привяжутся по ID.</p>
          </div>

          <div v-if="createSuccess" class="create-success">
            <i class="fas fa-circle-check"></i> {{ createSuccess }}
          </div>

          <!-- Шаг 1 -->
          <section class="form-section">
            <div class="section-head">
              <span class="section-num">1</span>
              <div>
                <h3>Сотрудник Битрикс24</h3>
                <p>Начните вводить имя — система найдёт совпадения</p>
              </div>
            </div>

            <div class="autocomplete">
              <div class="field-input">
                <i class="fas fa-magnifying-glass"></i>
                <input
                  v-model="searchQuery"
                  @focus="showDropdown = true"
                  @blur="hideDropdown"
                  placeholder="Например: Иван Петров"
                />
              </div>
              <div v-if="showDropdown && filteredBitrixUsers.length" class="dropdown">
                <div
                  v-for="user in filteredBitrixUsers" :key="user.id"
                  @mousedown.prevent="selectUser(user)"
                  class="dropdown-item"
                >
                  <span class="di-name">{{ user.name }}</span>
                  <span class="di-id">ID {{ user.id }}</span>
                </div>
              </div>
              <div v-if="showDropdown && !filteredBitrixUsers.length" class="dropdown dropdown-empty">
                Сотрудник не найден
              </div>
            </div>

            <div v-if="selectedBitrixUser" class="selected-user-card">
              <div class="su-avatar">{{ userInitials }}</div>
              <div class="su-info">
                <div class="su-name">{{ selectedBitrixUser.name }}</div>
                <div class="su-id">Bitrix24 ID: {{ selectedBitrixUser.id }}</div>
              </div>
              <button @click="clearSelectedUser" class="su-clear" title="Убрать выбор">
                <i class="fas fa-xmark"></i>
              </button>
            </div>
          </section>

          <!-- Шаг 2 -->
          <section class="form-section">
            <div class="section-head">
              <span class="section-num">2</span>
              <div>
                <h3>Учётные данные для входа</h3>
                <p>Логин заполняется автоматически, пароль можно сгенерировать</p>
              </div>
            </div>

            <div class="fields-grid">
              <label class="field">
                <span class="field-label">Системный логин</span>
                <div class="field-input">
                  <i class="fas fa-at"></i>
                  <input v-model="newUser.login" placeholder="ivan.petrov" />
                </div>
              </label>

              <label class="field">
                <span class="field-label">Временный пароль</span>
                <div class="field-input">
                  <i class="fas fa-key"></i>
                  <input v-model="newUser.password" :type="showNewUserPass ? 'text' : 'password'" placeholder="Минимум 6 символов" />
                  <button type="button" class="field-eye" @click="showNewUserPass = !showNewUserPass">
                    <i :class="showNewUserPass ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
                  </button>
                </div>
              </label>
            </div>
            <button type="button" class="link-btn" @click="generatePassword">
              <i class="fas fa-dice"></i> Сгенерировать надёжный пароль
            </button>
          </section>

          <!-- Шаг 3 -->
          <section class="form-section">
            <div class="section-head">
              <span class="section-num">3</span>
              <div>
                <h3>Права доступа и квалификация</h3>
                <p>Квалификация определяет порог разговора и нужна только менеджерам</p>
              </div>
            </div>

            <div class="fields-grid">
              <label class="field">
                <span class="field-label">Уровень доступа</span>
                <div class="field-input">
                  <i class="fas fa-shield-halved"></i>
                  <select v-model="newUser.role" @change="onRoleChange">
                    <option v-for="r in availableRoles" :key="r.value" :value="r.value">{{ r.label }}</option>
                  </select>
                </div>
              </label>

              <label v-if="newUser.role === 'MANAGER'" class="field">
                <span class="field-label">Квалификация</span>
                <div class="field-input">
                  <i class="fas fa-medal"></i>
                  <select v-model="newUser.qualification">
                    <option value="обычный">Обычный менеджер</option>
                    <option value="ведущий">Ведущий менеджер</option>
                  </select>
                </div>
                <span class="field-hint">{{ qualificationHint }}</span>
              </label>

              <div v-else class="field">
                <span class="field-label">Квалификация</span>
                <div class="field-note-box">
                  <i class="fas fa-circle-info"></i>
                  <span>Для роли «{{ roleLabel(newUser.role) }}» не требуется — порог разговора применяется только к менеджерам</span>
                </div>
              </div>
            </div>
          </section>

          <!-- Шаг 4 -->
          <section class="form-section">
            <div class="section-head">
              <span class="section-num">4</span>
              <div>
                <h3>Отдел</h3>
                <p>Можно оставить без отдела и назначить позже</p>
              </div>
            </div>

            <label class="field">
              <span class="field-label">Подразделение</span>
              <div class="field-input">
                <i class="fas fa-building"></i>
                <select v-model="newUser.department_id">
                  <option value="">Без отдела</option>
                  <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
                </select>
              </div>
            </label>
          </section>

          <div class="form-footer">
            <button
              @click="createUser"
              class="save-btn"
              :disabled="creatingUser || !newUser.bitrix_id"
            >
              <i v-if="!creatingUser" class="fas fa-user-plus"></i>
              <i v-else class="fas fa-spinner fa-spin"></i>
              {{ creatingUser ? 'Сохранение…' : 'Сохранить сотрудника' }}
            </button>
            <span v-if="!newUser.bitrix_id" class="footer-note">Сначала выберите сотрудника из Битрикс24</span>
          </div>
        </div>

        <!-- ===== ОСТАЛЬНЫЕ ВКЛАДКИ ===== -->
        <div v-if="activeTab === 'teams' && (userRole === 'DIRECTOR' || userRole === 'HEAD_OF_DEPT')" class="w-full centered-content">
          <TeamsFunnel />
        </div>
        <div v-if="activeTab === 'stuck' && (userRole === 'DIRECTOR' || userRole === 'HEAD_OF_DEPT')" class="w-full centered-content">
          <StuckEntities />
        </div>
        <div v-if="activeTab === 'departments' && (userRole === 'DIRECTOR' || userRole === 'HEAD_OF_DEPT')" class="w-full centered-content">
          <DepartmentsManager />
        </div>
        <div v-if="activeTab === 'plans' && (userRole === 'DIRECTOR' || userRole === 'HEAD_OF_DEPT')" class="w-full centered-content">
          <PlansManager />
        </div>
        <div v-if="activeTab === 'dictionaries' && (userRole === 'DIRECTOR' || userRole === 'HEAD_OF_DEPT')" class="w-full centered-content">
          <DictionariesManager />
        </div>
        <div v-if="activeTab === 'dashboard'" class="w-full centered-content">
          <ManagerDashboard v-if="userRole === 'MANAGER'" :managerId="currentManagerId" />
          <DirectorDashboard v-else />
        </div>
        <div v-if="activeTab === 'ratings'" class="w-full centered-content">
          <RatingsBoard />
        </div>
      </div>
    </div>
  </div>
</template>

<!-- Глобальный сброс -->
<style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
#app { width: 100%; max-width: none; margin: 0; padding: 0; }
</style>

<style scoped>
.app-layout { display: flex; min-height: 100vh; width: 100%; }

/* ---------- Сайдбар ---------- */
.sidebar {
  width: 260px; min-width: 260px; display: flex; flex-direction: column;
  padding: 20px 16px; box-sizing: border-box;
  position: sticky; top: 0; height: 100vh; overflow-y: auto;
  background: linear-gradient(180deg, var(--sidebar-from), var(--sidebar-to));
}
.sidebar-brand { display: flex; align-items: center; gap: 12px; padding: 4px 12px 20px; border-bottom: 1px solid rgba(255,255,255,.08); }
.brand-icon {
  width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--accent), #7b93ff); color: #fff; font-size: 18px;
  box-shadow: 0 4px 14px rgba(76,111,255,.4);
}
.brand-text { color: #fff; font-weight: 700; font-size: 18px; letter-spacing: -.01em; }
.user-profile { display: flex; align-items: center; gap: 12px; padding: 18px 12px; }
.avatar {
  width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--accent), #7b93ff); color: #fff; font-weight: 700;
}
.user-meta { min-width: 0; }
.user-name { color: #fff; font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.user-role { color: #9fb0cf; font-size: 12px; margin-top: 2px; }
.nav-menu { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.nav-section-title { color: #7c8aa8; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; padding: 14px 12px 6px; }
.nav-btn {
  display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box;
  background: transparent; border: none; color: #c4d0e9; text-align: left;
  padding: 11px 14px; border-radius: 10px; cursor: pointer; font-size: 14px; font-family: inherit;
  transition: background .2s, color .2s; position: relative;
}
.nav-btn:hover { background: rgba(255,255,255,.08); color: #fff; }
.nav-btn.active { background: linear-gradient(135deg, var(--accent), var(--accent-hover)); color: #fff; box-shadow: 0 4px 14px rgba(76,111,255,.4); }
.nav-btn.active::before { content: ''; position: absolute; left: -16px; top: 15%; bottom: 15%; width: 3px; background: var(--accent); border-radius: 0 3px 3px 0; }
.nav-icon { width: 20px; text-align: center; font-size: 15px; opacity: .9; }
.sidebar-footer { display: flex; flex-direction: column; gap: 12px; padding-top: 16px; }
.sync-status { display: flex; align-items: center; gap: 8px; color: #8b9ab8; font-size: 12px; background: rgba(255,255,255,.05); padding: 8px 12px; border-radius: 8px; }
.sync-status i { color: #5ce1a2; }
.btn-logout {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  background: rgba(229,72,77,.15); color: #ff9a9e; border: 1px solid rgba(229,72,77,.3);
  border-radius: 10px; padding: 11px; cursor: pointer; font-weight: 600; font-family: inherit;
}
.btn-logout:hover { background: var(--danger); color: #fff; }

/* ---------- ЭКРАН ВХОДА ---------- */
.login-screen {
  flex: 1; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 40px 20px; box-sizing: border-box; position: relative; overflow: hidden;
  background: linear-gradient(135deg, #101d4a 0%, #1e3a8a 40%, #2f5ce0 75%, #4c6fff 100%);
}
.login-decor { position: absolute; border-radius: 50%; background: rgba(255, 255, 255, 0.06); pointer-events: none; }
.decor-1 { width: 560px; height: 560px; top: -180px; right: -140px; }
.decor-2 { width: 380px; height: 380px; bottom: -140px; left: -100px; background: rgba(255,255,255,0.05); }
.decor-3 { width: 180px; height: 180px; top: 30%; left: 12%; background: rgba(255,255,255,0.04); }

.login-card {
  position: relative; z-index: 2; width: 100%; max-width: 460px;
  background: var(--surface); border: 1px solid rgba(255,255,255,0.6); border-radius: 24px;
  box-shadow: 0 30px 70px rgba(5, 12, 40, 0.45); padding: 48px 44px; box-sizing: border-box;
  animation: loginFadeUp .5s ease both;
}
@keyframes loginFadeUp {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: translateY(0); }
}
.login-logo {
  width: 72px; height: 72px; margin: 0 auto 22px; border-radius: 20px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--accent), #7b93ff); color: #fff; font-size: 32px;
  box-shadow: 0 10px 28px rgba(76,111,255,.35);
}
.login-title { text-align: center; margin: 0; font-size: 26px; font-weight: 700; color: var(--text); }
.login-subtitle { text-align: center; color: var(--text-muted); margin: 8px 0 32px; font-size: 15px; }
.login-form { display: flex; flex-direction: column; gap: 20px; }
.login-error {
  display: flex; align-items: center; gap: 8px; background: #fdecec; color: var(--danger);
  border: 1px solid #f8c9cb; border-radius: 10px; padding: 11px 14px; font-size: 13px; font-weight: 600;
}
.login-btn {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  background: linear-gradient(135deg, var(--accent), var(--accent-hover)); color: #fff;
  border: none; border-radius: 12px; padding: 15px; font-size: 16px; font-weight: 700;
  cursor: pointer; font-family: inherit; box-shadow: 0 6px 18px rgba(76,111,255,.35);
  transition: transform .18s, box-shadow .18s;
}
.login-btn:hover { transform: translateY(-1px); box-shadow: 0 9px 24px rgba(76,111,255,.4); }
.login-hint { display: flex; align-items: center; justify-content: center; gap: 7px; color: var(--text-muted); font-size: 12px; margin: 26px 0 0; }

/* ---------- Контент ---------- */
.main-content { flex: 1; padding: 32px 40px; box-sizing: border-box; overflow-x: hidden; min-width: 0; background: var(--bg); }
.content-wrapper { width: 100%; }
.topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 10px; }
.topbar-title { margin: 0; font-size: 26px; font-weight: 700; color: var(--text); letter-spacing: -.02em; }
.topbar-sync { display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 13px; }
.topbar-sync i { color: var(--accent); }
.centered-content { max-width: 1400px; margin: 0 auto; }
.w-full { width: 100%; }

/* ---------- Общие поля ---------- */
.field { display: flex; flex-direction: column; gap: 7px; }
.field-label { font-size: 13px; font-weight: 600; color: var(--text-muted); }
.field-input {
  display: flex; align-items: center; gap: 11px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 12px; padding: 0 14px; height: 48px;
  transition: border-color .18s, box-shadow .18s;
}
.field-input:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(76,111,255,.15); }
.field-input > i { color: var(--text-muted); font-size: 15px; width: 18px; text-align: center; }
.field-input input, .field-input select {
  flex: 1; border: none; outline: none; background: transparent; font-size: 15px;
  color: var(--text); font-family: inherit; min-width: 0; padding: 0;
}
.field-eye { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 15px; padding: 6px; }
.field-eye:hover { color: var(--accent); }
.field-hint { font-size: 12px; color: var(--text-muted); }
.field-note-box {
  display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 10px 14px;
  background: #f4f6fb; border: 1px dashed var(--border); border-radius: 12px;
  color: var(--text-muted); font-size: 13px; line-height: 1.4;
}
.field-note-box i { color: var(--accent); flex-shrink: 0; }

/* ---------- ЭКРАН ДОБАВЛЕНИЯ СОТРУДНИКОВ ---------- */
.users-screen { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
.users-header h2 { display: flex; align-items: center; gap: 12px; margin: 0 0 6px; font-size: 24px; color: var(--text); }
.users-header h2 i { color: var(--accent); }
.users-header p { margin: 0 0 4px; color: var(--text-muted); font-size: 14px; line-height: 1.5; }

.create-success {
  display: flex; align-items: center; gap: 10px; background: #e7f7ef; color: var(--success);
  border: 1px solid #b8e6cf; border-radius: 12px; padding: 13px 16px; font-size: 14px; font-weight: 600;
}

.form-section {
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
  padding: 22px 24px; box-shadow: var(--shadow-card);
}
.section-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 18px; }
.section-num {
  flex-shrink: 0; width: 30px; height: 30px; border-radius: 9px;
  background: linear-gradient(135deg, var(--accent), var(--accent-hover)); color: #fff;
  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px;
}
.section-head h3 { margin: 2px 0 3px; font-size: 16px; color: var(--text); }
.section-head p { margin: 0; font-size: 13px; color: var(--text-muted); }

.fields-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 620px) { .fields-grid { grid-template-columns: 1fr; } }

.autocomplete { position: relative; }
.dropdown {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 50;
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  max-height: 260px; overflow-y: auto; box-shadow: var(--shadow-lift);
}
.dropdown-item { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 16px; cursor: pointer; }
.dropdown-item:hover { background: var(--accent-soft); }
.di-name { font-weight: 600; color: var(--text); }
.di-id { font-size: 12px; color: var(--text-muted); }
.dropdown-empty { padding: 14px 16px; color: var(--text-muted); font-size: 14px; }

.selected-user-card {
  display: flex; align-items: center; gap: 14px; margin-top: 14px;
  background: var(--accent-soft); border: 1px solid #dfe5ff; border-radius: 12px; padding: 12px 16px;
}
.su-avatar {
  width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, var(--accent), #7b93ff); color: #fff;
  display: flex; align-items: center; justify-content: center; font-weight: 700;
}
.su-info { flex: 1; min-width: 0; }
.su-name { font-weight: 700; color: var(--text); }
.su-id { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.su-clear { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; padding: 6px; }
.su-clear:hover { color: var(--danger); }

.link-btn {
  background: none; border: none; color: var(--accent); cursor: pointer; font-size: 13px; font-weight: 600;
  padding: 0; margin-top: 12px; display: inline-flex; align-items: center; gap: 7px; font-family: inherit;
}
.link-btn:hover { color: var(--accent-hover); text-decoration: underline; }

.form-footer { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 4px 2px 12px; }
.save-btn {
  display: flex; align-items: center; gap: 10px;
  background: linear-gradient(135deg, var(--success), #0d9460); color: #fff;
  border: none; border-radius: 12px; padding: 14px 26px; font-size: 15px; font-weight: 700;
  cursor: pointer; font-family: inherit; box-shadow: 0 6px 18px rgba(15,169,104,.3);
  transition: transform .18s, box-shadow .18s;
}
.save-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 9px 24px rgba(15,169,104,.35); }
.save-btn:disabled { background: #b9c0cc; box-shadow: none; cursor: not-allowed; }
.footer-note { font-size: 13px; color: var(--text-muted); }

@media (max-width: 768px) {
  .app-layout { flex-direction: column; }
  .sidebar { width: 100%; min-width: 100%; height: auto; position: static; }
  .main-content { padding: 20px 14px; }
  .login-card { padding: 32px 22px; }
  .login-screen { padding: 24px 14px; }
}
</style>