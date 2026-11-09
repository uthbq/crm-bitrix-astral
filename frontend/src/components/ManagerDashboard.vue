<template>
  <div class="dashboard">
    <h2 style="margin-top: 0; color: #2c3e50;">Мой день (Статистика)</h2>
    
    <div v-if="loading" style="color: #7f8c8d;">Загрузка данных...</div>
    <div v-else-if="error" style="color: #e74c3c;">{{ error }}</div>
    <div v-else-if="stats.length === 0" style="color: #7f8c8d; padding: 20px 0;">
      У этого сотрудника пока нет активности (нет звонков и лидов).
    </div>
    
    <div v-else>
      <div class="chart-container" style="height: 300px; margin-bottom: 30px;">
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
            <th>Сумма оплат (₽)</th>
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
const loading = ref(false);
const error = ref<string | null>(null);

const fetchStats = async () => {
  loading.value = true;
  try {
    const url = props.managerId 
      ? `http://localhost:3000/api/dashboard?manager_id=${props.managerId}`
      : `http://localhost:3000/api/dashboard`;
      
    const response = await fetch(url);
    if (!response.ok) throw new Error('Ошибка загрузки статистики');
    
    stats.value = await response.json();
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

onMounted(fetchStats);
watch(() => props.managerId, fetchStats);

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
  plugins: {
    legend: { position: 'top' as const }
  },
  scales: {
    y: { beginAtZero: true, ticks: { precision: 0 } }
  }
};
</script>

<style scoped>
.dashboard {
  font-family: Arial, sans-serif;
  width: 100%;
}
.stats-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 15px;
}
.stats-table th, .stats-table td {
  border: 1px solid #ddd;
  padding: 12px;
  text-align: left;
  color: #2c3e50;
}
.stats-table th {
  background-color: #f5f6fa;
  font-weight: bold;
}
</style>