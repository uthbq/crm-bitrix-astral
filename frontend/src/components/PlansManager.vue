<template>
  <div class="plans-manager">
    <h2 style="margin-top: 0; color: #2c3e50; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px;">Планы и Нормативы</h2>

    <div class="card">
      <div class="form-row">
        <div class="form-group">
          <label>Менеджер</label>
          <select v-model="selectedManager" @change="loadPlan">
            <option disabled value="">Выберите сотрудника</option>
            <option v-for="u in users" :key="u.bitrix_id" :value="u.bitrix_id">
              {{ u.login }} (ID: {{ u.bitrix_id }})
            </option>
          </select>
        </div>
        <div class="form-group">
          <label>Месяц</label>
          <input type="month" v-model="selectedMonth" @change="loadPlan" />
        </div>
      </div>

      <div v-if="selectedManager && selectedMonth" class="plan-details">
        <div class="form-row">
          <div class="form-group">
            <label>Рабочих дней в месяце</label>
            <input type="number" v-model="plan.working_days" min="1" max="31" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>План по звонкам (за весь месяц)</label>
            <input type="number" v-model="plan.calls_norm" min="0" />
            <small>Дневная норма: {{ currentDailyCalls }} шт.</small>
          </div>
          <div class="form-group">
            <label>План по кач. лидам (за весь месяц)</label>
            <input type="number" v-model="plan.leads_norm" min="0" />
            <small>Дневная норма: {{ currentDailyLeads }} шт.</small>
          </div>
        </div>

        <div style="margin-top: 20px; display: flex; align-items: center; gap: 15px;">
          <button class="btn-save" @click="savePlan">Сохранить план</button>
          <span v-if="saveMessage" class="save-msg">{{ saveMessage }}</span>
        </div>
      </div>
      
      <div v-else class="empty-state">
        👆 Выберите сотрудника и месяц, чтобы настроить нормативы.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';

const users = ref<any[]>([]);
const selectedManager = ref('');
const selectedMonth = ref(new Date().toISOString().slice(0, 7));
const saveMessage = ref('');

const plan = ref({
  working_days: 21,
  calls_norm: 0,
  leads_norm: 0
});

const currentDailyCalls = computed(() => {
  return plan.value.working_days ? Math.round(plan.value.calls_norm / plan.value.working_days) : 0;
});
const currentDailyLeads = computed(() => {
  return plan.value.working_days ? Math.round(plan.value.leads_norm / plan.value.working_days) : 0;
});

const loadUsers = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/users');
    if (res.ok) users.value = await res.json();
  } catch (e) { console.error('Ошибка загрузки пользователей', e); }
};

const loadPlan = async () => {
  saveMessage.value = '';
  if (!selectedManager.value || !selectedMonth.value) return;
  try {
    const res = await fetch(`http://localhost:3000/api/plans?manager_id=${selectedManager.value}&month=${selectedMonth.value}`);
    if (res.ok) {
      const data = await res.json();
      plan.value.working_days = data.working_days || 21;
      plan.value.calls_norm = data.calls_norm || 0;
      plan.value.leads_norm = data.leads_norm || 0;
    }
  } catch (e) { console.error('Ошибка загрузки плана', e); }
};

const savePlan = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manager_id: selectedManager.value,
        month: selectedMonth.value,
        working_days: plan.value.working_days,
        calls_norm: plan.value.calls_norm,
        leads_norm: plan.value.leads_norm
      })
    });
    if (res.ok) {
      saveMessage.value = '✅ План успешно сохранен!';
      setTimeout(() => saveMessage.value = '', 3000);
    }
  } catch (e) { 
    saveMessage.value = '❌ Ошибка сохранения';
  }
};

onMounted(loadUsers);
</script>

<style scoped>
.plans-manager { width: 100%; font-family: Arial, sans-serif; }
.card { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.02); border: 1px solid #eee; margin-top: 20px; }
.form-row { display: flex; gap: 20px; margin-bottom: 20px; }
.form-group { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.form-group label { color: #34495e; font-weight: bold; font-size: 14px; }
.form-group input, .form-group select { padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; outline: none; font-size: 15px; }
.form-group small { color: #7f8c8d; font-size: 12px; }
.btn-save { background: #3498db; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 15px; transition: background 0.2s; }
.btn-save:hover { background: #2980b9; }
.save-msg { color: #27ae60; font-weight: bold; }
.empty-state { text-align: center; color: #7f8c8d; padding: 30px; background: #f9f9f9; border-radius: 6px; border: 1px dashed #ccc; }
</style>