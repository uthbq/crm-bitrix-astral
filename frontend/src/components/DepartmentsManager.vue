<template>
    <div class="departments-manager">
        <div class="header-row">
            <div>
                <h2 style="margin: 0; color: #2c3e50;">🏢 Отделы и состав команд</h2>
                <p class="subtitle">Поиск по ФИО, логину и ID Битрикс24. Сотрудников, которых нет в базе, можно создать прямо здесь.</p>
            </div>
            <div class="header-actions">
                <button @click="loadData" class="btn-refresh" :disabled="loading">🔄 Обновить</button>
                <div v-if="toast" :class="['toast', toast.type]">{{ toast.text }}</div>
            </div>
        </div>

        <div v-if="duplicateBitrixIds.length > 0" class="warn-banner">
            ⚠️ Найдены дубли учёток с одинаковым Bitrix ID: {{ duplicateBitrixIds.join(', ') }}.
            Метрики по такому сотруднику могут раздваиваться — оставьте одну учётку.
        </div>

        <div class="split-layout">
            <div class="card" style="flex: 1; min-width: 300px;">
                <h3>Отделы компании</h3>
                <div class="add-form">
                    <input v-model="newDeptName" placeholder="Например, Телемаркетинг" @keyup.enter="createDepartment" />
                    <button @click="createDepartment" class="btn-add">Создать</button>
                </div>
                <div class="dept-list">
                    <div v-if="departments.length === 0" class="empty">Отделы ещё не созданы</div>
                    <div v-for="dept in departments" :key="dept.id"
                         :class="['dept-item', { active: selectedDept?.id === dept.id }]"
                         @click="selectDepartment(dept)">
                        <div>
                            <strong>{{ dept.name }}</strong>
                            <div class="dept-meta">Сотрудников: {{ dept.members_count }}</div>
                        </div>
                        <button @click.stop="deleteDepartment(dept.id)" class="btn-delete" title="Удалить отдел">✖</button>
                    </div>
                </div>
            </div>

            <div class="card" style="flex: 2; min-width: 340px;">
                <div v-if="!selectedDept" class="empty-state">
                    👈 Выберите отдел слева, чтобы посмотреть состав и добавить сотрудников.
                </div>
                <div v-else>
                    <div class="dept-header">
                        <h3 style="margin: 0;">Отдел: <span style="color: #3498db;">{{ selectedDept.name }}</span></h3>
                        <button @click="toggleAddPanel" :class="showAddPanel ? 'btn-cancel' : 'btn-primary-sm'">
                            {{ showAddPanel ? 'Закрыть поиск' : '+ Добавить сотрудников' }}
                        </button>
                    </div>

                    <div v-if="showAddPanel" class="add-members-panel">
                        <div class="panel-head">
                            <strong>Поиск сотрудника</strong>
                            <span class="selected-counter">Выбрано: {{ usersToAdd.length }}</span>
                        </div>

                        <input v-model="userSearch" class="search-input"
                               placeholder="ФИО, логин или ID Битрикс24 — например 12345" />

                        <div class="panel-options">
                            <label class="checkbox-line">
                                <input type="checkbox" v-model="includeOtherDepts" />
                                <span>Показывать сотрудников других отделов</span>
                            </label>
                            <label class="checkbox-line">
                                <input type="checkbox" v-model="onlyWithoutDept" />
                                <span>Только без отдела</span>
                            </label>
                            <span class="found-counter">
                                Найдено {{ filteredAvailableUsers.length }} из {{ availableUsers.length }}
                            </span>
                        </div>

                        <div class="users-checklist">
                            <label v-for="user in filteredAvailableUsers" :key="user.id"
                                   :class="['user-row', { checked: usersToAdd.includes(user.id) }]">
                                <input type="checkbox" :value="user.id" v-model="usersToAdd" />
                                <div class="user-main">
                                    <span class="user-login">{{ displayName(user) }}</span>
                                    <span class="user-sub">
                                        {{ user.login }} · ID {{ user.bitrix_id || '—' }}
                                        <template v-if="user.qualification"> · {{ user.qualification }}</template>
                                    </span>
                                </div>
                                <span v-if="isSystemBot(user)" class="badge gray" title="Создан из ответственного в данных, ФИО подтянуто из Битрикс24">системная</span>
                                <span v-if="user.department_name" class="badge warn">Сейчас: {{ user.department_name }}</span>
                                <span v-else class="badge ok">без отдела</span>
                            </label>
                            <div v-if="filteredAvailableUsers.length === 0" class="empty">
                                Никого не найдено. Если сотрудника нет в списке ниже — создайте его из Битрикс24.
                            </div>
                        </div>

                        <div class="panel-actions">
                            <button @click="addSelectedMembers" class="btn-save" :disabled="usersToAdd.length === 0">
                                Добавить выбранных ({{ usersToAdd.length }})
                            </button>
                            <button @click="usersToAdd = []" class="btn-cancel" :disabled="usersToAdd.length === 0">
                                Сбросить выбор
                            </button>
                        </div>

                        <div class="missing-block">
                            <div class="panel-head">
                                <strong>Есть в Битрикс24, но нет в базе дашборда</strong>
                                <span class="found-counter">{{ missingPortalUsers.length }}</span>
                            </div>
                            <p class="hint">
                                Обычно сотрудник появляется сам при синхронизации. Если его нет — создайте учётку
                                и он сразу попадёт в отдел «{{ selectedDept.name }}».
                            </p>
                            <input v-model="portalSearch" class="search-input" placeholder="Поиск по ФИО или ID портала" />
                            <div v-if="!portalLoaded" class="empty">
                                {{ portalError || 'Загрузка сотрудников портала…' }}
                            </div>
                            <div v-else class="users-checklist">
                                <div v-for="u in filteredMissingPortalUsers" :key="u.id" class="user-row">
                                    <div class="user-main">
                                        <span class="user-login">{{ u.name || 'Без имени' }}</span>
                                        <span class="user-sub">ID {{ u.id }} · логин будет: {{ proposeLogin(u) }}</span>
                                    </div>
                                    <button @click="createAndAdd(u)" class="btn-create" :disabled="creatingId === u.id">
                                        {{ creatingId === u.id ? 'Создание…' : 'Создать и добавить' }}
                                    </button>
                                </div>
                                <div v-if="filteredMissingPortalUsers.length === 0" class="empty">
                                    Все сотрудники портала уже есть в базе дашборда
                                </div>
                            </div>
                            <div v-if="createdCredentials" class="credentials">
                                Учётка создана: <strong>{{ createdCredentials.login }}</strong>,
                                пароль <code>{{ createdCredentials.password }}</code> — передайте сотруднику лично.
                            </div>
                        </div>
                    </div>

                    <div class="current-members-section">
                        <div class="panel-head">
                            <h4 class="section-subtitle" style="margin: 0;">Текущий состав ({{ currentMembers.length }})</h4>
                            <input v-if="currentMembers.length > 3" v-model="memberSearch"
                                   class="search-input small" placeholder="Фильтр по ФИО / логину / ID" />
                        </div>
                        <div v-if="currentMembers.length === 0" class="empty-state" style="padding: 25px;">
                            В отделе пока нет сотрудников. Нажмите «+ Добавить сотрудников».
                        </div>
                        <div v-else class="members-list">
                            <div v-for="member in filteredCurrentMembers" :key="member.id" class="member-item">
                                <div class="member-info">
                                    <span class="member-login">{{ displayName(member) }}</span>
                                    <span class="member-sub">{{ member.login }} · ID {{ member.bitrix_id || '—' }}</span>
                                    <span class="member-role">{{ roleLabel(member.role) }}</span>
                                    <span :class="['badge', member.qualification === 'ведущий' ? 'purple' : 'gray']">
                                        {{ member.qualification === 'ведущий' ? '59 сек' : '44 сек' }}
                                    </span>
                                </div>
                                <button @click="removeMember(member.id)" class="btn-remove-member">Убрать ✖</button>
                            </div>
                            <div v-if="filteredCurrentMembers.length === 0" class="empty">По фильтру никого нет</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

const API = 'http://localhost:3000/api';

interface Department { id: number; name: string; members_count: number; }
interface User {
    id: number; bitrix_id: number | null; login: string; role: string;
    department_id: number | null; department_name: string | null; qualification?: string;
}
interface PortalUser { id: number; name: string; }

const departments = ref<Department[]>([]);
const users = ref<User[]>([]);
const portalUsers = ref<PortalUser[]>([]);
const portalLoaded = ref(false);
const portalError = ref('');
const loading = ref(false);

const newDeptName = ref('');
const selectedDept = ref<Department | null>(null);
const showAddPanel = ref(false);
const usersToAdd = ref<number[]>([]);
const userSearch = ref('');
const memberSearch = ref('');
const portalSearch = ref('');
const includeOtherDepts = ref(true);
const onlyWithoutDept = ref(false);
const creatingId = ref<number | null>(null);
const createdCredentials = ref<{ login: string; password: string } | null>(null);

const toast = ref<{ text: string; type: 'success' | 'error' } | null>(null);
let toastTimer: any = null;
const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    toast.value = { text, type };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.value = null; }, 5000);
};

const authToken = () => localStorage.getItem('crm_token') || '';
const roleLabel = (r: string) => ({ DIRECTOR: 'Директор', HEAD_OF_DEPT: 'Руководитель', MANAGER: 'Менеджер' } as any)[r] || r;
const isSystemBot = (u: User) => String(u.login || '').startsWith('system_bot_');

const portalNameById = computed(() => {
    const map: Record<number, string> = {};
    portalUsers.value.forEach(u => { if (u.id) map[u.id] = u.name || ''; });
    return map;
});
const displayName = (u: User) => {
    const name = u.bitrix_id ? portalNameById.value[u.bitrix_id] : '';
    return name || u.login;
};

const duplicateBitrixIds = computed(() => {
    const counts: Record<number, number> = {};
    users.value.forEach(u => { if (u.bitrix_id) counts[u.bitrix_id] = (counts[u.bitrix_id] || 0) + 1; });
    return Object.keys(counts).filter(k => counts[Number(k)] > 1);
});

const matches = (u: User, query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [
        u.login,
        u.bitrix_id,
        u.department_name,
        u.bitrix_id ? portalNameById.value[u.bitrix_id] : ''
    ].some(v => String(v ?? '').toLowerCase().includes(q));
};

const currentMembers = computed(() =>
    selectedDept.value ? users.value.filter(u => u.department_id === selectedDept.value!.id) : []
);
const filteredCurrentMembers = computed(() =>
    currentMembers.value.filter(u => matches(u, memberSearch.value))
);

const availableUsers = computed(() => {
    if (!selectedDept.value) return [];
    let list = users.value.filter(u => u.department_id !== selectedDept.value!.id);
    if (onlyWithoutDept.value) list = list.filter(u => !u.department_id);
    else if (!includeOtherDepts.value) list = list.filter(u => !u.department_id);
    return list;
});
const filteredAvailableUsers = computed(() =>
    availableUsers.value.filter(u => matches(u, userSearch.value))
);

// Сотрудники портала, которых нет в локальной базе
const missingPortalUsers = computed(() => {
    const known = new Set(users.value.map(u => u.bitrix_id).filter(Boolean));
    return portalUsers.value.filter(u => u.id && !known.has(u.id));
});
const filteredMissingPortalUsers = computed(() => {
    const q = portalSearch.value.trim().toLowerCase();
    const list = q
        ? missingPortalUsers.value.filter(u => [u.name, u.id].some(v => String(v ?? '').toLowerCase().includes(q)))
        : missingPortalUsers.value;
    return list.slice(0, 100);
});

const transliterate = (text: string): string => {
    const ru = 'А-а-Б-б-В-в-Г-г-Д-д-Е-е-Ё-ё-Ж-ж-З-з-И-и-Й-й-К-к-Л-л-М-м-Н-н-О-о-П-п-Р-р-С-с-Т-т-У-у-Ф-ф-Х-х-Ц-ц-Ч-ч-Ш-ш-Щ-щ-Ъ-ъ-Ы-ы-Ь-ь-Э-э-Ю-ю-Я-я'.split('-');
    const en = 'A-a-B-b-V-v-G-g-D-d-E-e-E-e-Zh-zh-Z-z-I-i-Y-y-K-k-L-l-M-m-N-n-O-o-P-p-R-r-S-s-T-t-U-u-F-f-Kh-kh-Ts-ts-Ch-ch-Sh-sh-Sch-sch---Y-y---E-e-Yu-yu-Ya-ya'.split('-');
    let res = '';
    for (let i = 0; i < text.length; i++) {
        const s = text.charAt(i), n = ru.indexOf(s);
        res += (n >= 0) ? en[n] : s;
    }
    return res.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.').replace(/(^\.|\.$)/g, '');
};
const proposeLogin = (u: PortalUser) => {
    let base = transliterate(u.name || '') || `user_${u.id}`;
    const taken = new Set(users.value.map(x => x.login));
    return taken.has(base) ? `${base}.${u.id}` : base;
};
const generatePassword = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
};

const loadData = async () => {
    loading.value = true;
    try {
        const [resDepts, resUsers] = await Promise.all([
            fetch(`${API}/departments`), fetch(`${API}/users`)
        ]);
        if (resDepts.ok) departments.value = await resDepts.json();
        if (resUsers.ok) users.value = await resUsers.json();
        if (selectedDept.value) {
            selectedDept.value = departments.value.find(d => d.id === selectedDept.value!.id) || null;
        }
    } catch (e) {
        showToast('Нет связи с сервером', 'error');
    } finally {
        loading.value = false;
    }
    await loadPortalUsers();
};

const loadPortalUsers = async () => {
    if (!authToken()) {
        portalError.value = 'Нет токена — войдите в систему заново, чтобы видеть ФИО и сотрудников портала.';
        return;
    }
    try {
        const res = await fetch(`${API}/bitrix-users`, {
            headers: { Authorization: `Bearer ${authToken()}` }
        });
        if (res.ok) {
            portalUsers.value = await res.json();
            portalLoaded.value = true;
            portalError.value = '';
        } else {
            portalError.value = res.status === 401
                ? 'Сессия истекла — войдите заново.'
                : 'Не удалось загрузить сотрудников портала.';
        }
    } catch (e) {
        portalError.value = 'Сервер недоступен для загрузки сотрудников портала.';
    }
};

const createDepartment = async () => {
    if (!newDeptName.value.trim()) return;
    try {
        const res = await fetch(`${API}/departments`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newDeptName.value.trim() })
        });
        const data = await res.json();
        if (res.ok) {
            newDeptName.value = '';
            await loadData();
            showToast('Отдел создан');
        } else showToast(data.error || 'Ошибка создания', 'error');
    } catch (e) { showToast('Нет связи с сервером', 'error'); }
};

const deleteDepartment = async (id: number) => {
    if (!confirm('Удалить отдел? Сотрудники останутся в системе, но без привязки к отделу.')) return;
    try {
        const res = await fetch(`${API}/departments/${id}`, { method: 'DELETE' });
        if (res.ok) {
            if (selectedDept.value?.id === id) {
                selectedDept.value = null;
                showAddPanel.value = false;
                usersToAdd.value = [];
            }
            await loadData();
            showToast('Отдел удалён');
        }
    } catch (e) { showToast('Нет связи с сервером', 'error'); }
};

const selectDepartment = (dept: Department) => {
    selectedDept.value = dept;
    showAddPanel.value = false;
    usersToAdd.value = [];
    userSearch.value = '';
    memberSearch.value = '';
    portalSearch.value = '';
    createdCredentials.value = null;
};

const toggleAddPanel = () => {
    showAddPanel.value = !showAddPanel.value;
    usersToAdd.value = [];
    userSearch.value = '';
    createdCredentials.value = null;
    if (showAddPanel.value && !portalLoaded.value) loadPortalUsers();
};

const updateDepartmentMembers = async (newMemberIds: number[], successText: string) => {
    if (!selectedDept.value) return;
    try {
        const res = await fetch(`${API}/departments/${selectedDept.value.id}/members`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: newMemberIds })
        });
        if (res.ok) {
            await loadData();
            showToast(successText);
        } else showToast((await res.json()).error || 'Ошибка сохранения', 'error');
    } catch (e) { showToast('Нет связи с сервером', 'error'); }
};

const addSelectedMembers = async () => {
    if (usersToAdd.value.length === 0) return;
    const merged = Array.from(new Set([...currentMembers.value.map(u => u.id), ...usersToAdd.value]));
    await updateDepartmentMembers(merged, `Добавлено сотрудников: ${usersToAdd.value.length}`);
    usersToAdd.value = [];
    userSearch.value = '';
};

const removeMember = async (userId: number) => {
    const remaining = currentMembers.value.map(u => u.id).filter(id => id !== userId);
    await updateDepartmentMembers(remaining, 'Сотрудник убран из отдела');
};

const createAndAdd = async (u: PortalUser) => {
    if (!selectedDept.value) return;
    if (!authToken()) return showToast('Нет токена — войдите заново', 'error');
    creatingId.value = u.id;
    const login = proposeLogin(u);
    const password = generatePassword();
    try {
        const res = await fetch(`${API}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken()}` },
            body: JSON.stringify({
                bitrix_id: u.id,
                login,
                password,
                role: 'MANAGER',
                qualification: 'обычный',
                department_id: selectedDept.value.id
            })
        });
        const data = await res.json();
        if (res.ok) {
            createdCredentials.value = { login, password };
            await loadData();
            showToast(`${u.name || 'Сотрудник'} создан и добавлен в отдел`);
        } else if (res.status === 401) {
            showToast('Сессия истекла — войдите заново', 'error');
        } else {
            showToast(data.error || 'Ошибка создания', 'error');
        }
    } catch (e) {
        showToast('Нет связи с сервером', 'error');
    } finally {
        creatingId.value = null;
    }
};

onMounted(loadData);
</script>

<style scoped>
.departments-manager { width: 100%; font-family: Arial, sans-serif; }
.header-row { display: flex; justify-content: space-between; align-items: center; gap: 15px; flex-wrap: wrap; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px; margin-bottom: 20px; }
.subtitle { color: #7f8c8d; font-size: 13px; margin: 5px 0 0; max-width: 640px; }
.header-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.btn-refresh { background: #f4f6f7; border: 1px solid #ddd; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; color: #34495e; }
.btn-refresh:hover:not(:disabled) { background: #e8ecee; }
.btn-refresh:disabled { opacity: 0.6; cursor: not-allowed; }
.toast { padding: 9px 14px; border-radius: 8px; font-size: 13px; font-weight: bold; max-width: 420px; }
.toast.success { background: #eafaf1; color: #1e8449; border: 1px solid #a9dfbf; }
.toast.error { background: #fdedec; color: #c0392b; border: 1px solid #f5b7b1; }
.warn-banner { background: #fffcf5; border: 1px solid #f39c12; color: #d35400; padding: 12px 16px; border-radius: 8px; font-size: 13px; margin-bottom: 18px; }
.split-layout { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
.card { background: white; padding: 20px; border-radius: 10px; border: 1px solid #eee; box-shadow: 0 2px 10px rgba(0,0,0,0.02); box-sizing: border-box; }
.card h3 { margin-top: 0; color: #34495e; font-size: 16px; margin-bottom: 15px; }
.dept-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid #f0f0f0; }
.add-form { display: flex; gap: 8px; margin-bottom: 15px; }
.add-form input { padding: 10px; border: 1px solid #ddd; border-radius: 6px; outline: none; flex: 1; font-size: 14px; min-width: 100px; }
.btn-add { background: #2ecc71; color: white; border: none; padding: 10px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; white-space: nowrap; }
.btn-add:hover { background: #27ae60; }
.btn-primary-sm { background: #3498db; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; }
.btn-primary-sm:hover { background: #2980b9; }
.btn-cancel { background: #95a5a6; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; }
.btn-cancel:hover:not(:disabled) { background: #7f8c8d; }
.btn-cancel:disabled { background: #bdc3c7; cursor: not-allowed; }
.dept-list { display: flex; flex-direction: column; gap: 8px; }
.dept-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border: 1px solid #eee; border-radius: 8px; cursor: pointer; transition: 0.2s; background: #fdfdfd; }
.dept-item:hover { background: #f0f4f8; }
.dept-item.active { background: #e3f2fd; border-color: #3498db; }
.dept-meta { font-size: 12px; color: #7f8c8d; margin-top: 4px; }
.btn-delete { background: #e74c3c; color: white; border: none; border-radius: 4px; padding: 5px 8px; cursor: pointer; }
.btn-delete:hover { background: #c0392b; }
.add-members-panel { background: #f8f9fa; border: 1px solid #e1e8ed; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; font-size: 14px; color: #2c3e50; }
.panel-options { display: flex; gap: 15px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.checkbox-line { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #34495e; cursor: pointer; }
.found-counter { font-size: 12px; color: #7f8c8d; margin-left: auto; }
.search-input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 10px; box-sizing: border-box; font-size: 14px; outline: none; background: white; }
.search-input:focus { border-color: #3498db; }
.search-input.small { width: auto; min-width: 220px; margin-bottom: 0; padding: 6px 10px; font-size: 13px; }
.users-checklist { max-height: 300px; overflow-y: auto; border: 1px solid #eee; border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: white; }
.users-checklist::-webkit-scrollbar { width: 9px; }
.users-checklist::-webkit-scrollbar-track { background: #f0f2f5; border-radius: 5px; }
.users-checklist::-webkit-scrollbar-thumb { background: #bdc3c7; border-radius: 5px; }
.users-checklist::-webkit-scrollbar-thumb:hover { background: #95a5a6; }
.user-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 14px; color: #2c3e50; }
.user-row:hover { background: #f5f6fa; }
.user-row.checked { background: #eafaf1; }
.user-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.user-login { font-weight: bold; overflow: hidden; text-overflow: ellipsis; }
.user-sub { font-size: 11px; color: #95a5a6; }
.badge { font-size: 11px; font-weight: bold; padding: 3px 8px; border-radius: 4px; white-space: nowrap; }
.badge.ok { background: #eafaf1; color: #1e8449; border: 1px solid #a9dfbf; }
.badge.warn { background: #fef5e7; color: #d35400; border: 1px solid #fad7a0; }
.badge.gray { background: #f4f6f7; color: #34495e; border: 1px solid #e5e8e8; }
.badge.purple { background: #f4ecf7; color: #7d3c98; border: 1px solid #d7bde2; }
.panel-actions { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.btn-save { background: #2ecc71; color: white; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px; }
.btn-save:hover:not(:disabled) { background: #27ae60; }
.btn-save:disabled { background: #bdc3c7; cursor: not-allowed; }
.missing-block { margin-top: 18px; padding-top: 15px; border-top: 1px dashed #d5dbdb; }
.hint { font-size: 12px; color: #7f8c8d; margin: 0 0 10px; line-height: 1.5; }
.btn-create { background: #3498db; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px; white-space: nowrap; }
.btn-create:hover:not(:disabled) { background: #2980b9; }
.btn-create:disabled { background: #bdc3c7; cursor: not-allowed; }
.credentials { margin-top: 12px; background: #eafaf1; border: 1px solid #a9dfbf; color: #1e8449; padding: 10px 14px; border-radius: 6px; font-size: 13px; }
.credentials code { background: white; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
.section-subtitle { font-size: 14px; color: #7f8c8d; text-transform: uppercase; letter-spacing: 0.5px; }
.members-list { display: flex; flex-direction: column; gap: 8px; }
.member-item { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 14px; border: 1px solid #f0f0f0; border-radius: 6px; background: #fdfdfd; flex-wrap: wrap; }
.member-info { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.member-login { font-weight: bold; color: #2c3e50; font-size: 14px; }
.member-sub { font-size: 11px; color: #95a5a6; }
.member-role { font-size: 11px; color: #7f8c8d; background: #ecf0f1; padding: 2px 6px; border-radius: 4px; }
.btn-remove-member { background: transparent; color: #e74c3c; border: 1px solid #fadbd8; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 12px; font-weight: bold; }
.btn-remove-member:hover { background: #e74c3c; color: white; }
.selected-counter { font-size: 12px; font-weight: bold; color: #27ae60; background: #eafaf1; padding: 4px 10px; border-radius: 6px; }
.empty-state { text-align: center; color: #7f8c8d; padding: 40px 20px; background: #f9f9f9; border-radius: 8px; border: 1px dashed #ccc; font-size: 14px; }
.empty { text-align: center; color: #95a5a6; padding: 15px; font-size: 13px; }
@media (max-width: 768px) {
    .card { min-width: 100% !important; flex: 1 1 100% !important; }
    .search-input.small { width: 100%; }
}
</style>