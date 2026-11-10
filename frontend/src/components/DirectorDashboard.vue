<template>
  <div class="director-dashboard">
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px; margin-bottom: 20px;">
      <h2 style="margin: 0; color: #2c3e50;">Сводка по компании</h2>
      
      <div class="filters">
        <select v-model="filters.period" @change="loadAnalytics" class="filter-select">
          <option value="all">За всё время</option>
          <option value="today">Сегодня</option>
          <option value="week">За последние 7 дней</option>
          <option value="month">За последние 30 дней</option>
        </select>

        <select v-model="filters.base_id" @change="loadAnalytics" class="filter-select">
          <option value="">Все базы</option>
          <option v-for="b in basesList" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </div>
    </div>
    
    <div v-if="loading" style="color: #7f8c8d;">Загрузка аналитики...</div>
    
    <div v-else class="dashboard-grid">
      
      <div class="card" v-if="dailyStats.length > 0">
        <h3>📈 Динамика звонков (Вся компания)</h3>
        <div class="chart-container" style="height: 250px;">
          <Bar :data="chartData" :options="chartOptions" />
        </div>
      </div>
      
      <div class="card" style="border-left: 4px solid #e74c3c;">
        <h3>🛑 Топ причин отказов</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Причина</th>
              <th style="width: 150px; text-align: center;">Количество лидов</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="refusals.length === 0"><td colspan="2" class="empty">Нет отказов за этот период</td></tr>
            <tr v-for="(r, index) in refusals" :key="index">
              <td><strong>{{ r.reason_name }}</strong></td>
              <td style="text-align: center; color: #e74c3c; font-weight: bold;">{{ r.count }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      
      <div class="card">
        <h3>🏆 Рейтинг менеджеров (Топ по выручке)</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>Звонки</th>
              <th>Разговоры</th>
              <th>Кач. Лиды</th>
              <th>Оплаты</th>
              <th>Сумма (₽)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="managers.length === 0"><td colspan="6" class="empty">Нет данных за этот период</td></tr>
            <tr v-for="(m, index) in managers" :key="m.manager_id">
              <td>
                <span v-if="index === 0">🥇</span>
                <span v-else-if="index === 1">🥈</span>
                <span v-else-if="index === 2">🥉</span>
                <strong>{{ m.manager_name }}</strong>
              </td>
              <td>{{ m.total_calls }}</td>
              <td>{{ m.valid_conversations }}</td>
              <td>{{ m.quality_leads }}</td>
              <td>{{ m.paid_deals }}</td>
              <td class="money">{{ m.amount_sum.toLocaleString('ru-RU') }} ₽</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h3>📁 Эффективность баз</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>База</th>
              <th>Звонки</th>
              <th>Кач. Лиды</th>
              <th>Оплаты</th>
              <th>Сумма (₽)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="bases.length === 0"><td colspan="5" class="empty">Нет данных за этот период</td></tr>
            <tr v-for="b in bases" :key="b.base_id">
              <td><strong>{{ b.base_name }}</strong></td>
              <td>{{ b.total_calls }}</td>
              <td>{{ b.quality_leads }}</td>
              <td>{{ b.paid_deals }}</td>
              <td class="money">{{ b.amount_sum.toLocaleString('ru-RU') }} ₽</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, reactive } from 'vue';
import { Bar } from 'vue-chartjs';
import { 
  Chart as ChartJS, 
  Title, 
  Tooltip, 
  Legend, 
  BarElement, 
  CategoryScale, 
  LinearScale 
} from 'chart.js';

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale);

const managers = ref<any[]>([]);
const bases = ref<any[]>([]);
const dailyStats = ref<any[]>([]);
const refusals = ref<any[]>([]); // Состояние для отказов
const basesList = ref<any[]>([]); 
const loading = ref(true);

const filters = reactive({ period: 'all', base_id: '' });

const getDatesForPeriod = (period: string) => {
  if (period === 'all') return { start: '', end: '' };
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  let start = end;
  if (period === 'week') {
    const d = new Date(); d.setDate(d.getDate() - 7);
    start = d.toISOString().split('T')[0];
  } else if (period === 'month') {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    start = d.toISOString().split('T')[0];
  }
  return { start, end };
};

const loadAnalytics = async () => {
  loading.value = true;
  const { start, end } = getDatesForPeriod(filters.period);
  
  const queryParams = new URLSearchParams();
  if (start) queryParams.append('startDate', start);
  if (end) queryParams.append('endDate', end);
  if (filters.base_id) queryParams.append('base_id', filters.base_id);

  const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : '';

  try {
    const [resManagers, resBases, resDaily, resRefusals] = await Promise.all([
      fetch(`http://localhost:3000/api/analytics/managers${queryStr}`),
      fetch(`http://localhost:3000/api/analytics/bases${queryStr}`),
      fetch(`http://localhost:3000/api/dashboard${queryStr}`),
      fetch(`http://localhost:3000/api/analytics/refusals${queryStr}`) // Запрос отказов
    ]);
    
    if (resManagers.ok) managers.value = await resManagers.json();
    if (resBases.ok) bases.value = await resBases.json();
    if (resDaily.ok) dailyStats.value = await resDaily.json();
    if (resRefusals.ok) refusals.value = await resRefusals.json();
  } catch (err) {
    console.error('Ошибка загрузки дашборда', err);
  } finally {
    loading.value = false;
  }
};

const loadBasesList = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/bases');
    if (res.ok) basesList.value = await res.json();
  } catch (e) {}
};

onMounted(() => {
  loadBasesList();
  loadAnalytics();
});

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(dateStr));
};

const chartData = computed(() => {
  const reversedStats = [...dailyStats.value].reverse();
  return {
    labels: reversedStats.map(day => formatDate(day.date)),
    datasets: [
      { label: 'Исходящие наборы', backgroundColor: '#3498db', data: reversedStats.map(day => day.total_outbound) },
      { label: 'Разговоры > 44 сек', backgroundColor: '#2ecc71', data: reversedStats.map(day => day.valid_conversations) }
    ]
  };
});

const chartOptions = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: 'top' as const } },
  scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
};
</script>

<style scoped>
.director-dashboard { width: 100%; font-family: Arial, sans-serif; }
.filters { display: flex; gap: 15px; }
.filter-select { padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; outline: none; background: white; color: #2c3e50; cursor: pointer; }
.dashboard-grid { display: flex; flex-direction: column; gap: 30px; }
.card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.02); border: 1px solid #eee; }
.card h3 { margin-top: 0; color: #34495e; margin-bottom: 15px; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 12px; border-bottom: 1px solid #f0f0f0; text-align: left; font-size: 14px; }
.data-table th { background: #f5f6fa; color: #7f8c8d; font-weight: bold; }
.empty { text-align: center; color: #7f8c8d; padding: 20px !important; }
.money { font-weight: bold; color: #27ae60; }
</style>