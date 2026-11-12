<template>
  <div class="dashboard">
    <h2 style="margin-top: 0; color: #2c3e50;">Мой день (Статистика)</h2>
    
    <div v-if="loading" style="color: #7f8c8d;">Загрузка данных...</div>
    <div v-else-if="error" style="color: #e74c3c;">{{ error }}</div>
    
    <div v-else>
      <div style="margin-bottom: 20px; color: #7f8c8d; font-size: 14px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          Квалификация: <strong>{{ managerInfo.qualification }}</strong> 
          (порог разговора: {{ managerInfo.threshold }} сек)
        </div>
        <div style="font-weight: bold; color: #34495e;">
          Сегодня: {{ formatDate(todayString) }}
        </div>
      </div>
      
      <div v-if="plan.working_days > 0" class="plans-container">
        <h3>🎯 Выполнение плана на сегодня</h3>
        <div class="plan-card">
          <div class="plan-header">
            <span>📞 Звонки (Наборы)</span>
            <strong>{{ todayStats.total_outbound }} / {{ dailyCallsNorm }}</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :class="{ 'success': callsProgress >= 100 }" :style="{ width: Math.min(callsProgress, 100) + '%' }"></div>
          </div>
          <small class="plan-status">{{ callsProgress >= 100 ? 'Норма выполнена!' : `Осталось: ${Math.max(0, dailyCallsNorm - todayStats.total_outbound)}` }}</small>
        </div>

        <div class="plan-card">
          <div class="plan-header">
            <span>💎 Качественные лиды</span>
            <strong>{{ todayStats.quality_leads }} / {{ dailyLeadsNorm }}</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :class="{ 'success': leadsProgress >= 100 }" :style="{ width: Math.min(leadsProgress, 100) + '%' }"></div>
          </div>
          <small class="plan-status">{{ leadsProgress >= 100 ? 'Норма выполнена!' : `Осталось: ${Math.max(0, dailyLeadsNorm - todayStats.quality_leads)}` }}</small>
        </div>
      </div>

      <div class="conversions-container">
        <h3>📊 Воронка и конверсии (За сегодня)</h3>
        <div class="conv-grid">
          <div class="conv-card">
            <div class="conv-title">% Дозвона</div>
            <div class="conv-value" :class="connectionRate < 30 ? 'text-danger' : 'text-success'">{{ connectionRate }}%</div>
            <div class="conv-formula">Разговоры ({{ todayStats.valid_conversations }}) / Наборы ({{ todayStats.total_outbound || 0 }})</div>
          </div>
          <div class="conv-card">
            <div class="conv-title">Лид → Качественный</div>
            <div class="conv-value text-primary">{{ qualityRate }}%</div>
            <div class="conv-formula">Кач. лиды ({{ todayStats.quality_leads }}) / Взято в работу ({{ todayStats.unique_leads || 0 }})</div>
          </div>
          <div class="conv-card">
            <div class="conv-title">Качественный → Оплата</div>
            <div class="conv-value text-success">{{ winRate }}%</div>
            <div class="conv-formula">Оплаты ({{ todayStats.paid_deals }}) / Кач. лиды ({{ todayStats.quality_leads || 0 }})</div>
          </div>
        </div>
      </div>

      <div v-if="weakSpots.length > 0" class="weak-spots-container">
        <h3>⚠️ Зоны роста (Слабые места)</h3>
        <ul class="weak-spots-list">
          <li v-for="(spot, idx) in weakSpots" :key="idx">{{ spot }}</li>
        </ul>
      </div>

      <div v-if="stats.length === 0" style="color: #7f8c8d; padding: 20px 0; text-align: center; border: 1px dashed #ccc; border-radius: 8px; margin-top: 20px;">
        У вас пока нет активности. Сделайте первый звонок в Битрикс24!
      </div>
      
      <div v-else>
        <div class="chart-container" style="height: 300px; margin-bottom: 30px; margin-top: 30px;">
          <Bar :data="chartData" :options="chartOptions" />
        </div>

        <table class="stats-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Исходящие наборы</th>
              <th>Разговоры (> {{ managerInfo.threshold }} сек)</th>
              <th>Взято лидов</th>
              <th>Кач. Лиды</th>
              <th>Оплаты</th>
              <th>Сумма (₽)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="day in stats" :key="day.date">
              <td>{{ formatDate(day.date) }}</td>
              <td>{{ day.total_outbound }}</td>
              <td><strong>{{ day.valid_conversations }}</strong></td>
              <td>{{ day.unique_leads }}</td>
              <td style="color: #27ae60; font-weight: bold;">{{ day.quality_leads }}</td>
              <td>{{ day.paid_deals }}</td>
              <td><strong>{{ day.amount_sum.toLocaleString('ru-RU') }}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
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

const props = defineProps<{
  managerId: string | number;
}>();

interface DailyStat {
  date: string;
  total_outbound: number;
  valid_conversations: number;
  unique_leads: number;
  quality_leads: number;
  paid_deals: number;
  amount_sum: number;
}

const stats = ref<DailyStat[]>([]);
const plan = ref({ working_days: 0, calls_norm: 0, leads_norm: 0 });
const managerInfo = ref({ qualification: 'обычный', threshold: 44 });
const loading = ref(false);
const error = ref<string | null>(null);

const todayString = new Date().toISOString().split('T')[0];

const fetchStatsAndPlan = async () => {
  loading.value = true;
  try {
    const url = props.managerId 
      ? `http://localhost:3000/api/dashboard?manager_id=${props.managerId}`
      : `http://localhost:3000/api/dashboard`;
      
    const currentMonth = todayString.slice(0, 7);
    const planUrl = `http://localhost:3000/api/plans?manager_id=${props.managerId}&month=${currentMonth}`;

    const [statsRes, planRes] = await Promise.all([
      fetch(url),
      props.managerId ? fetch(planUrl) : Promise.resolve(null)
    ]);

    if (props.managerId) {
       const infoRes = await fetch(`http://localhost:3000/api/users/${props.managerId}/info`);
       if (infoRes.ok) {
           const info = await infoRes.json();
           managerInfo.value = {
               qualification: info.qualification || 'обычный',
               threshold: info.qualification === 'ведущий' ? 59 : 44
           };
       }
    }
    
    if (!statsRes.ok) throw new Error('Ошибка загрузки статистики');
    stats.value = await statsRes.json();
    
    if (planRes && planRes.ok) {
      plan.value = await planRes.json();
    }
    
    error.value = null;
  } catch (err) {
    error.value = 'Не удалось подключиться к серверу';
    console.error(err);
  } finally {
    loading.value = false;
  }
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(dateStr));
};

onMounted(fetchStatsAndPlan);
watch(() => props.managerId, fetchStatsAndPlan);

const todayStats = computed(() => {
  return stats.value.find(s => s.date === todayString) || {
    total_outbound: 0, valid_conversations: 0, unique_leads: 0, quality_leads: 0, paid_deals: 0, amount_sum: 0
  };
});

const dailyCallsNorm = computed(() => plan.value.working_days ? Math.round(plan.value.calls_norm / plan.value.working_days) : 0);
const dailyLeadsNorm = computed(() => plan.value.working_days ? Math.round(plan.value.leads_norm / plan.value.working_days) : 0);
const callsProgress = computed(() => dailyCallsNorm.value === 0 ? 0 : Math.round((todayStats.value.total_outbound / dailyCallsNorm.value) * 100));
const leadsProgress = computed(() => dailyLeadsNorm.value === 0 ? 0 : Math.round((todayStats.value.quality_leads / dailyLeadsNorm.value) * 100));

const connectionRate = computed(() => todayStats.value.total_outbound ? Math.round((todayStats.value.valid_conversations / todayStats.value.total_outbound) * 100) : 0);
const qualityRate = computed(() => todayStats.value.unique_leads ? Math.round((todayStats.value.quality_leads / todayStats.value.unique_leads) * 100) : 0);
const winRate = computed(() => todayStats.value.quality_leads ? Math.round((todayStats.value.paid_deals / todayStats.value.quality_leads) * 100) : 0);

const weakSpots = computed(() => {
  const spots = [];
  const ts = todayStats.value;
  
  if (ts.total_outbound > 10 && connectionRate.value < 30) {
    spots.push(`Низкий % дозвона (${connectionRate.value}%). Возможно, вы звоните в неудобное для клиентов время, либо проблемы с качеством базы.`);
  }
  if (ts.valid_conversations > 5 && qualityRate.value < 10) {
    spots.push(`Мало качественных лидов при состоявшихся разговорах. Проверьте скрипт или отработку возражений.`);
  }
  if (dailyCallsNorm.value > 0 && ts.total_outbound < (dailyCallsNorm.value / 2) && new Date().getHours() > 14) {
    spots.push(`Уже вторая половина дня, а выполнено менее 50% плана по звонкам. Ускоряйтесь!`);
  }
  return spots;
});

const chartData = computed(() => {
  const reversedStats = [...stats.value].reverse();
  return {
    labels: reversedStats.map(day => formatDate(day.date)),
    datasets: [
      { label: 'Исходящие наборы', backgroundColor: '#3498db', data: reversedStats.map(day => day.total_outbound) },
      { label: `Разговоры (> ${managerInfo.value.threshold} сек)`, backgroundColor: '#2ecc71', data: reversedStats.map(day => day.valid_conversations) }
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
.dashboard { font-family: Arial, sans-serif; width: 100%; }

.plans-container, .conversions-container, .weak-spots-container {
  background: white;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 25px;
  border: 1px solid #eee;
  box-shadow: 0 2px 8px rgba(0,0,0,0.03);
}
.plans-container { display: flex; gap: 20px; flex-wrap: wrap; background: #f8f9fa; }
h3 { width: 100%; margin-top: 0; margin-bottom: 15px; color: #2c3e50; font-size: 18px; }

.plan-card { flex: 1; min-width: 250px; background: white; padding: 15px; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
.plan-header { display: flex; justify-content: space-between; margin-bottom: 10px; color: #34495e; }
.progress-track { width: 100%; height: 12px; background: #ecf0f1; border-radius: 6px; overflow: hidden; margin-bottom: 5px; }
.progress-fill { height: 100%; background: #3498db; border-radius: 6px; transition: width 0.4s ease; }
.progress-fill.success { background: #2ecc71; }
.plan-status { color: #7f8c8d; font-size: 12px; }

.conv-grid { display: flex; gap: 15px; flex-wrap: wrap; }
.conv-card { flex: 1; min-width: 200px; padding: 15px; background: #fdfdfd; border-left: 4px solid #3498db;
 border-radius: 6px; border-top: 1px solid #eee; border-right: 1px solid #eee; border-bottom: 1px solid #eee;}
.conv-title { font-size: 14px; color: #7f8c8d; font-weight: bold; margin-bottom: 5px; }
.conv-value { font-size: 28px; font-weight: bold; margin-bottom: 5px; }
.conv-formula { font-size: 11px; color: #95a5a6; }

.weak-spots-container { border-left: 4px solid #f39c12; background: #fffcf5; }
.weak-spots-list { margin: 0; padding-left: 20px; color: #d35400; font-size: 14px; line-height: 1.6; }

.text-danger { color: #e74c3c; }
.text-success { color: #27ae60; }
.text-primary { color: #3498db; }

.stats-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
.stats-table th, .stats-table td { border: 1px solid #ddd; padding: 12px; text-align: left; color: #2c3e50; }
.stats-table th { background-color: #f5f6fa; font-weight: bold; }
</style>