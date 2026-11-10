<template>
  <div class="dashboard">
    <h2 style="margin-top: 0; color: #2c3e50;">Мой день (Статистика)</h2>
    
    <div v-if="loading" style="color: #7f8c8d;">Загрузка данных...</div>
    <div v-else-if="error" style="color: #e74c3c;">{{ error }}</div>
    
    <div v-else>
      
      <div v-if="plan.working_days > 0" class="plans-container">
        <h3>🎯 Выполнение плана на сегодня</h3>
        
        <div class="plan-card">
          <div class="plan-header">
            <span>📞 Звонки (Наборы)</span>
            <strong>{{ todayStats.total_outbound }} / {{ dailyCallsNorm }}</strong>
          </div>
          <div class="progress-track">
            <div 
              class="progress-fill" 
              :class="{ 'success': callsProgress >= 100, 'danger': callsProgress < 100 }"
              :style="{ width: Math.min(callsProgress, 100) + '%' }">
            </div>
          </div>
          <small class="plan-status">{{ callsProgress >= 100 ? 'Норма выполнена!' : `Осталось: ${dailyCallsNorm - todayStats.total_outbound}` }}</small>
        </div>

        <div class="plan-card">
          <div class="plan-header">
            <span>💎 Качественные лиды</span>
            <strong>{{ todayStats.quality_leads }} / {{ dailyLeadsNorm }}</strong>
          </div>
          <div class="progress-track">
            <div 
              class="progress-fill" 
              :class="{ 'success': leadsProgress >= 100, 'danger': leadsProgress < 100 }"
              :style="{ width: Math.min(leadsProgress, 100) + '%' }">
            </div>
          </div>
          <small class="plan-status">{{ leadsProgress >= 100 ? 'Норма выполнена!' : `Осталось: ${dailyLeadsNorm - todayStats.quality_leads}` }}</small>
        </div>
      </div>

      <div v-if="stats.length === 0" style="color: #7f8c8d; padding: 20px 0;">
        У этого сотрудника пока нет активности (нет звонков и лидов).
      </div>
      
      <div v-else>
        <div class="chart-container" style="height: 300px; margin-bottom: 30px; margin-top: 20px;">
          <Bar :data="chartData" :options="chartOptions" />
        </div>

        <table class="stats-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Исходящие наборы</th>
              <th>Разговоры > 44 сек</th>
              <th>Уникальные лиды</th>
              <th>Оплаты</th>
              <th>Сумма (₽)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="day in stats" :key="day.date">
              <td>{{ formatDate(day.date) }}</td>
              <td>{{ day.total_outbound }}</td>
              <td>{{ day.valid_conversations }}</td>
              <td>{{ day.unique_leads }}</td>
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
const loading = ref(false);
const error = ref<string | null>(null);

const fetchStatsAndPlan = async () => {
  loading.value = true;
  try {
    const url = props.managerId 
      ? `http://localhost:3000/api/dashboard?manager_id=${props.managerId}`
      : `http://localhost:3000/api/dashboard`;
      
    const currentMonth = new Date().toISOString().slice(0, 7);
    const planUrl = `http://localhost:3000/api/plans?manager_id=${props.managerId}&month=${currentMonth}`;

    const [statsRes, planRes] = await Promise.all([
      fetch(url),
      props.managerId ? fetch(planUrl) : Promise.resolve(null)
    ]);
    
    if (!statsRes.ok) throw new Error('Ошибка загрузки статистики');
    stats.value = await statsRes.json();
    
    if (planRes && planRes.ok) {
      const planData = await planRes.json();
      plan.value = planData;
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

const todayString = new Date().toISOString().split('T')[0];

const todayStats = computed(() => {
  return stats.value.find(s => s.date === todayString) || {
    total_outbound: 0, quality_leads: 0
  };
});

const dailyCallsNorm = computed(() => {
  return plan.value.working_days ? Math.round(plan.value.calls_norm / plan.value.working_days) : 0;
});

const dailyLeadsNorm = computed(() => {
  return plan.value.working_days ? Math.round(plan.value.leads_norm / plan.value.working_days) : 0;
});

const callsProgress = computed(() => {
  if (dailyCallsNorm.value === 0) return 0;
  return Math.round((todayStats.value.total_outbound / dailyCallsNorm.value) * 100);
});

const leadsProgress = computed(() => {
  if (dailyLeadsNorm.value === 0) return 0;
  return Math.round((todayStats.value.quality_leads / dailyLeadsNorm.value) * 100);
});

const chartData = computed(() => {
  const reversedStats = [...stats.value].reverse();
  return {
    labels: reversedStats.map(day => formatDate(day.date)),
    datasets: [
      {
        label: 'Исходящие наборы',
        backgroundColor: '#3498db',
        data: reversedStats.map(day => day.total_outbound)
      },
      {
        label: 'Разговоры > 44 сек',
        backgroundColor: '#2ecc71',
        data: reversedStats.map(day => day.valid_conversations)
      }
    ]
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'top' as const } },
  scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
};
</script>

<style scoped>
.dashboard { font-family: Arial, sans-serif; width: 100%; }

.plans-container {
  display: flex;
  gap: 20px;
  background: #f8f9fa;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 30px;
  border: 1px solid #eee;
  flex-wrap: wrap;
}
.plans-container h3 {
  width: 100%;
  margin-top: 0;
  margin-bottom: 15px;
  color: #2c3e50;
  font-size: 18px;
}
.plan-card {
  flex: 1;
  min-width: 250px;
  background: white;
  padding: 15px;
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.05);
}
.plan-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  color: #34495e;
}
.progress-track {
  width: 100%;
  height: 12px;
  background: #ecf0f1;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 5px;
}
.progress-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.4s ease;
}
.progress-fill.success { background: #2ecc71; }
.progress-fill.danger { background: #e74c3c; }
.plan-status { color: #7f8c8d; font-size: 12px; }

.stats-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
.stats-table th, .stats-table td { border: 1px solid #ddd; padding: 12px; text-align: left; color: #2c3e50; }
.stats-table th { background-color: #f5f6fa; font-weight: bold; }
</style>