<template>
  <div class="departments-manager">
    <h2 style="margin-top: 0; color: #2c3e50; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px;">
      🏢 Управление отделами
    </h2>

    <div class="split-layout">
      <div class="card" style="flex: 1; min-width: 300px;">
        <h3>Отделы компании</h3>
        <div class="add-form">
          <input 
            v-model="newDeptName" 
            placeholder="Например, Телемаркетинг" 
            @keyup.enter="createDepartment" 
          />
          <button @click="createDepartment" class="btn-add">Создать</button>
        </div>

        <div class="dept-list">
          <div v-if="departments.length === 0" class="empty">Отделы еще не созданы</div>
          <div 
            v-for="dept in departments" 
            :key="dept.id" 
            :class="['dept-item', { active: selectedDept?.id === dept.id }]"
            @click="selectDepartment(dept)"
          >
            <div>
              <strong>{{ dept.name }}</strong>
              <div class="dept-meta">Сотрудников: {{ dept.members_count }}</div>
            </div>
            <button @click.stop="deleteDepartment(dept.id)" class="btn-delete" title="Удалить отдел">✖</button>
          </div>
        </div>
      </div>

      <div class="card" style="flex: 2; min-width: 320px;">
        <div v-if="!selectedDept" class="empty-state">
          👈 Выберите отдел слева, чтобы посмотреть его состав или добавить сотрудников.
        </div>

        <div v-else>
          <div class="dept-header">
            <h3 style="margin: 0;">Отдел: <span style="color: #3498db;">{{ selectedDept.name }}</span></h3>
            <button 
              @click="toggleAddPanel" 
              :class="showAddPanel ? 'btn-cancel' : 'btn-primary-sm'"
            >
              {{ showAddPanel ? 'Закрыть список' : '+ Добавить сотрудников' }}
            </button>
          </div>

          <div v-if="saveMessage" class="save-msg" style="margin-bottom: 15px;">{{ saveMessage }}</div>

          <div v-if="showAddPanel" class="add-members-panel">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <strong style="font-size: 14px; color: #2c3e50;">Выберите сотрудников для добавления</strong>
              <span class="selected-counter">Выбрано: {{ usersToAdd.length }}</span>
            </div>

            <input 
              v-model="userSearch" 
              placeholder="Поиск сотрудника по логину..." 
              class="search-input" 
            />

            <div class="users-checklist">
              <label 
                v-for="user in filteredAvailableUsers" 
                :key="user.id" 
                :class="['user-row', { checked: usersToAdd.includes(user.id) }]"
              >
                <input 
                  type="checkbox" 
                  :value="user.id" 
                  v-model="usersToAdd" 
                />
                <span class="user-login">{{ user.login }}</span>
                <span v-if="user.department_name" class="other-dept-badge">
                  Сейчас в: {{ user.department_name }}
                </span>
              </label>
              <div v-if="filteredAvailableUsers.length === 0" class="empty">
                Нет доступных сотрудников для добавления
              </div>
            </div>

            <div style="margin-top: 15px; display: flex; gap: 10px;">
              <button 
                @click="addSelectedMembers" 
                class="btn-save" 
                :disabled="usersToAdd.length === 0"
              >
                Добавить выбранных ({{ usersToAdd.length }})
              </button>
            </div>
          </div>

          <div class="current-members-section">
            <h4 class="section-subtitle">Текущий состав ({{ currentMembers.length }})</h4>

            <div v-if="currentMembers.length === 0" class="empty-state" style="padding: 25px;">
              В этом отделе пока нет сотрудников. Нажмите «+ Добавить сотрудников», чтобы собрать команду.
            </div>

            <div v-else class="members-list">
              <div v-for="member in currentMembers" :key="member.id" class="member-item">
                <div class="member-info">
                  <span class="member-login">{{ member.login }}</span>
                  <span class="member-role">{{ member.role }}</span>
                </div>
                <button 
                  @click="removeMember(member.id)" 
                  class="btn-remove-member" 
                  title="Убрать из отдела"
                >
                  Убрать ✖
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';

interface Department { id: number; name: string; members_count: number; }
interface User { id: number; bitrix_id: number; login: string; role: string; department_id: number | null; department_name: string | null; }

const departments = ref<Department[]>([]);
const users = ref<User[]>([]);
const newDeptName = ref('');
const selectedDept = ref<Department | null>(null);

const showAddPanel = ref(false);
const usersToAdd = ref<number[]>([]);
const userSearch = ref('');
const saveMessage = ref('');

const loadData = async () => {
  try {
    const [resDepts, resUsers] = await Promise.all([
      fetch('http://localhost:3000/api/departments'),
      fetch('http://localhost:3000/api/users')
    ]);
    if (resDepts.ok) departments.value = await resDepts.json();
    if (resUsers.ok) users.value = await resUsers.json();

    if (selectedDept.value) {
      const updated = departments.value.find(d => d.id === selectedDept.value?.id);
      selectedDept.value = updated || null;
    }
  } catch (e) {
    console.error('Ошибка загрузки отделов', e);
  }
};

const createDepartment = async () => {
  if (!newDeptName.value.trim()) return;
  const res = await fetch('http://localhost:3000/api/departments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newDeptName.value.trim() })
  });
  if (res.ok) {
    newDeptName.value = '';
    await loadData();
  } else {
    alert((await res.json()).error || 'Ошибка создания');
  }
};

const deleteDepartment = async (id: number) => {
  if (!confirm('Удалить отдел? Сотрудники останутся в системе, но без привязки к отделу.')) return;
  const res = await fetch(`http://localhost:3000/api/departments/${id}`, { method: 'DELETE' });
  if (res.ok) {
    if (selectedDept.value?.id === id) {
      selectedDept.value = null;
      showAddPanel.value = false;
      usersToAdd.value = [];
    }
    await loadData();
  }
};

const selectDepartment = (dept: Department) => {
  selectedDept.value = dept;
  showAddPanel.value = false;
  usersToAdd.value = [];
  userSearch.value = '';
  saveMessage.value = '';
};

const toggleAddPanel = () => {
  showAddPanel.value = !showAddPanel.value;
  usersToAdd.value = [];
  userSearch.value = '';
};

const currentMembers = computed(() => {
  if (!selectedDept.value) return [];
  return users.value.filter(u => u.department_id === selectedDept.value?.id);
});

const availableUsers = computed(() => {
  if (!selectedDept.value) return [];
  return users.value.filter(u => u.department_id !== selectedDept.value?.id);
});

const filteredAvailableUsers = computed(() => {
  if (!userSearch.value.trim()) return availableUsers.value;
  const q = userSearch.value.toLowerCase();
  return availableUsers.value.filter(u => u.login.toLowerCase().includes(q));
});

const updateDepartmentMembers = async (newMemberIds: number[], successText: string) => {
  if (!selectedDept.value) return;
  try {
    const res = await fetch(`http://localhost:3000/api/departments/${selectedDept.value.id}/members`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: newMemberIds })
    });
    if (res.ok) {
      saveMessage.value = successText;
      await loadData();
      setTimeout(() => saveMessage.value = '', 3000);
    }
  } catch (e) {
    saveMessage.value = '❌ Ошибка сохранения';
  }
};

const addSelectedMembers = async () => {
  if (usersToAdd.value.length === 0) return;
  const currentIds = currentMembers.value.map(u => u.id);
  const mergedIds = Array.from(new Set([...currentIds, ...usersToAdd.value]));
  
  await updateDepartmentMembers(mergedIds, '✅ Сотрудники добавлены в отдел!');
  usersToAdd.value = [];
  showAddPanel.value = false;
};

const removeMember = async (userId: number) => {
  const remainingIds = currentMembers.value
    .map(u => u.id)
    .filter(id => id !== userId);
  
  await updateDepartmentMembers(remainingIds, '✅ Сотрудник убран из отдела');
};

onMounted(loadData);
</script>

<style scoped>
.departments-manager { width: 100%; font-family: Arial, sans-serif; }
.split-layout { display: flex; gap: 20px; margin-top: 20px; align-items: flex-start; flex-wrap: wrap; }
.card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.02); border: 1px solid #eee; box-sizing: border-box; }
.card h3 { margin-top: 0; color: #34495e; font-size: 16px; margin-bottom: 15px; }

.dept-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid #f0f0f0; }

.add-form { display: flex; gap: 8px; margin-bottom: 15px; }
.add-form input { padding: 10px; border: 1px solid #ddd; border-radius: 6px; outline: none; flex: 1; font-size: 14px; }
.btn-add { background: #2ecc71; color: white; border: none; padding: 10px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; white-space: nowrap; }
.btn-add:hover { background: #27ae60; }

.btn-primary-sm { background: #3498db; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; }
.btn-primary-sm:hover { background: #2980b9; }
.btn-cancel { background: #95a5a6; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; }
.btn-cancel:hover { background: #7f8c8d; }

.dept-list { display: flex; flex-direction: column; gap: 8px; }
.dept-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border: 1px solid #eee; border-radius: 8px; cursor: pointer; transition: 0.2s; background: #fdfdfd; }
.dept-item:hover { background: #f0f4f8; }
.dept-item.active { background: #e3f2fd; border-color: #3498db; }
.dept-meta { font-size: 12px; color: #7f8c8d; margin-top: 4px; }
.btn-delete { background: #e74c3c; color: white; border: none; border-radius: 4px; padding: 5px 8px; cursor: pointer; }

.add-members-panel { background: #f8f9fa; border: 1px solid #e1e8ed; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
.search-input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 12px; box-sizing: border-box; font-size: 14px; outline: none; background: white; }
.users-checklist { max-height: 260px; overflow-y: auto; border: 1px solid #eee; border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: white; }
.user-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 14px; color: #2c3e50; }
.user-row:hover { background: #f5f6fa; }
.user-row.checked { background: #eafaf1; }
.user-login { flex: 1; font-weight: bold; }
.other-dept-badge { font-size: 11px; background: #fef5e7; color: #d35400; padding: 3px 8px; border-radius: 4px; border: 1px solid #fad7a0; }

.section-subtitle { margin: 0 0 12px 0; font-size: 14px; color: #7f8c8d; text-transform: uppercase; letter-spacing: 0.5px; }
.members-list { display: flex; flex-direction: column; gap: 8px; }
.member-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border: 1px solid #f0f0f0; border-radius: 6px; background: #fdfdfd; }
.member-info { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.member-login { font-weight: bold; color: #2c3e50; font-size: 14px; }
.member-role { font-size: 11px; color: #7f8c8d; background: #ecf0f1; padding: 2px 6px; border-radius: 4px; }
.btn-remove-member { background: transparent; color: #e74c3c; border: 1px solid #fadbd8; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 12px; font-weight: bold; transition: 0.2s; }
.btn-remove-member:hover { background: #e74c3c; color: white; }

.selected-counter { font-size: 12px; font-weight: bold; color: #27ae60; background: #eafaf1; padding: 4px 10px; border-radius: 6px; }
.btn-save { background: #2ecc71; color: white; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px; }
.btn-save:hover:not(:disabled) { background: #27ae60; }
.btn-save:disabled { background: #bdc3c7; cursor: not-allowed; }
.save-msg { color: #27ae60; font-weight: bold; font-size: 14px; }
.empty-state { text-align: center; color: #7f8c8d; padding: 40px 20px; background: #f9f9f9; border-radius: 8px; border: 1px dashed #ccc; font-size: 14px; }
.empty { text-align: center; color: #95a5a6; padding: 15px; font-size: 13px; }
</style>