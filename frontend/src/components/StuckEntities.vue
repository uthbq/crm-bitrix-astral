<template>
  <div class="stuck-entities">
    <div class="header-row">
      <div>
        <h2 style="margin: 0; color: #2c3e50;">⏳ Зависшие сделки и лиды</h2>
        <p class="subtitle">Карточки в работе без движения дольше заданного срока</p>
      </div>
      
      <div class="entity-toggle">
        <button @click="setEntity('deals')" :class="['toggle-btn', { active: filters.entity === 'deals' }]">
          💼 Сделки
        </button>
        <button @click="setEntity('leads')" :class="['toggle-btn', { active: filters.entity === 'leads' }]">
          🎯 Лиды
        </button>
      </div>
    </div>

    <div class="filters-card">
      <div class="filter-group" style="max-width: 170px;">
        <label>Без движения от (дней)</label>
        <input 
          type="number" 
          v-model.number="filters.days" 
          min="1" 
          max="365" 
          @change="loadStuck" 
          class="filter-input" 
        />
      </div>

      <div class="filter-group">
        <label>Отдел (Команда)</label>
        <select v-model="filters.department_id" @change="loadStuck" class="filter-input">
          <option value="">Все отделы</option>
          <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </div>

      <div class="filter-group">
        <label>Менеджер</label>
        <select v-model="filters.manager_id" @change="loadStuck" class="filter-input">
          <option value="">Все менеджеры</option>
          <option v-for="m in managers" :key="m.id" :value="m.bitrix_id">{{ m.login }}</option>
        </select>
      </div>

      <div class="filter-group">
        <label>База</label>
        <select v-model="filters.base_id" @change="loadStuck" class="filter-input">
          <option value="">Все базы</option>
          <option v-for="b in bases" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </div>

      <div class="filter-group">
        <label>Продукт</label>
        <select v-model="filters.product_id" @change="loadStuck" class="filter-input">
          <option value="">Все продукты</option>
          <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>

      <div class="filter-group" style="justify-content: flex-end;">
        <button @click="exportIdsToCSV" class="btn-export" :disabled="loading || items.length === 0">
          📥 Выгрузить ID ({{ items.length }})
        </button>
      </div>
    </div>

    <div class="card">
      <div v-if="loading" class="empty">Поиск зависших карточек...</div>
      <div v-else class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>База</th>
              <th>Продукт</th>
              <th>Ответственный</th>
              <th>Отдел</th>
              <th>Стадия / Статус</th>
              <th>Последний контакт</th>
              <th style="text-align: center;">Простой</th>
              <th v-if="filters.entity === 'deals'" style="text-align: right;">Сумма</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="items.length === 0">
              <td :colspan="filters.entity === 'deals' ? 9 : 8" class="empty">
                Отлично! Зависших карточек по выбранным фильтрам нет 🎉
              </td>
            </tr>
            <tr v-for="item in items" :key="item.id">
              <td>
                <span class="id-badge">#{{ item.id }}</span>
              </td>
              <td><strong>{{ item.base_name }}</strong></td>
              <td>{{ item.product_name }}</td>
              <td>{{ item.manager_name }}</td>
              <td><span class="dept-badge">{{ item.department_name }}</span></td>
              <td>{{ item.stage }}</td>
              <td>{{ formatDate(item.last_contact_at) }}</td>
              <td style="text-align: center;">
                <span :class="['days-badge', getDaysSeverity(item.days_stuck)]">
                  {{ item.days_stuck }} дн.
                </span>
              </td>
              <td v-if="filters.entity === 'deals'" style="text-align: right; font-weight: bold; color: #27ae60;">
                {{ item.amount ? item.amount.toLocaleString('ru-RU') + ' ₽' : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';

const items = ref<any[]>([]);
const departments = ref<any[]>([]);
const managers = ref<any[]>([]);
const bases = ref<any[]>([]);
const products = ref<any[]>([]);
const loading = ref(false);

const filters = reactive({
  entity: 'deals',
  days: 7,
  department_id: '',
  manager_id: '',
  base_id: '',
  product_id: ''
});

const setEntity = (entity: 'deals' | 'leads') => {
  filters.entity = entity;
  loadStuck();
};

const loadDictionaries = async () => {
  try {
    const [resDepts, resUsers, resBases, resProducts] = await Promise.all([
      fetch('http://localhost:3000/api/departments'),
      fetch('http://localhost:3000/api/users'),
      fetch('http://localhost:3000/api/bases'),
      fetch('http://localhost:3000/api/products')
    ]);
    if (resDepts.ok) departments.value = await resDepts.json();
    if (resUsers.ok) managers.value = await resUsers.json();
    if (resBases.ok) bases.value = await resBases.json();
    if (resProducts.ok) products.value = await resProducts.json();
  } catch (e) {
    console.error('Ошибка загрузки справочников', e);
  }
};

const loadStuck = async () => {
  loading.value = true;
  const params = new URLSearchParams();
  params.append('entity', filters.entity);
  params.append('days', String(filters.days || 7));
  if (filters.department_id) params.append('department_id', filters.department_id);
  if (filters.manager_id) params.append('manager_id', filters.manager_id);
  if (filters.base_id) params.append('base_id', filters.base_id);
  if (filters.product_id) params.append('product_id', filters.product_id);

  try {
    const res = await fetch(`http://localhost:3000/api/analytics/stuck?${params.toString()}`);
    if (res.ok) {
      items.value = await res.json();
    }
  } catch (e) {
    console.error('Ошибка загрузки зависших карточек', e);
  } finally {
    loading.value = false;
  }
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(dateStr));
};

const getDaysSeverity = (days: number) => {
  if (days >= 30) return 'severity-high';
  if (days >= 14) return 'severity-medium';
  return 'severity-low';
};

const exportIdsToCSV = () => {
  if (items.value.length === 0) return;
  let csv = 'ID;Сущность;База;Продукт;Ответственный;Отдел;Стадия;Последний контакт;Дней без движения\n';
  items.value.forEach(item => {
    const typeLabel = item.entity_type === 'deal' ? 'Сделка' : 'Лид';
    csv += `${item.id};${typeLabel};${item.base_name};${item.product_name};${item.manager_name};${item.department_name};${item.stage};${formatDate(item.last_contact_at)};${item.days_stuck}\n`;
  });

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `Зависшие_${filters.entity}_от_${filters.days}_дней.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

onMounted(() => {
  loadDictionaries();
  loadStuck();
});
</script>

<style scoped>
.stuck-entities { width: 100%; font-family: Arial, sans-serif; }
.header-row { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px; margin-bottom: 20px; flex-wrap: wrap; gap: 15px; }
.subtitle { color: #7f8c8d; font-size: 13px; margin: 5px 0 0; }

.entity-toggle { display: flex; gap: 8px; }
.toggle-btn { background: #ecf0f1; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: bold; color: #34495e; font-size: 14px; transition: 0.2s; }
.toggle-btn.active { background: #3498db; color: white; }

.filters-card { background: white; padding: 20px; border-radius: 10px; border: 1px solid #eee; margin-bottom: 20px; display: flex; gap: 15px; flex-wrap: wrap; align-items: flex-end; box-shadow: 0 2px 10px rgba(0,0,0,0.02); }
.filter-group { flex: 1; min-width: 160px; display: flex; flex-direction: column; gap: 6px; }
.filter-group label { font-size: 11px; font-weight: bold; color: #7f8c8d; text-transform: uppercase; letter-spacing: 0.4px; }
.filter-input { padding: 9px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; background: white; color: #2c3e50; outline: none; width: 100%; box-sizing: border-box; }

.btn-export { padding: 10px 16px; background: #27ae60; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; white-space: nowrap; height: 37px; }
.btn-export:hover:not(:disabled) { background: #2ecc71; }
.btn-export:disabled { background: #bdc3c7; cursor: not-allowed; }

.card { background: white; padding: 20px; border-radius: 10px; border: 1px solid #eee; box-shadow: 0 2px 10px rgba(0,0,0,0.02); }
.table-responsive { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.data-table { width: 100%; border-collapse: collapse; min-width: 800px; }
.data-table th, .data-table td { padding: 12px; border-bottom: 1px solid #f0f0f0; text-align: left; font-size: 13px; white-space: nowrap; }
.data-table th { background: #f5f6fa; color: #7f8c8d; font-weight: bold; }
.empty { text-align: center; color: #7f8c8d; padding: 25px !important; }

.id-badge { background: #e3f2fd; color: #2980b9; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; }
.dept-badge { background: #f4f6f7; color: #34495e; padding: 3px 8px; border-radius: 4px; font-size: 12px; }

.days-badge { padding: 4px 10px; border-radius: 12px; font-weight: bold; font-size: 12px; display: inline-block; }
.severity-low { background: #fef9e7; color: #d68910; }
.severity-medium { background: #fbeee6; color: #d35400; }
.severity-high { background: #fdedec; color: #c0392b; }
</style>