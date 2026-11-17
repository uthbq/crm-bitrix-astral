<template>
  <div class="ratings-board">
    <h2 style="margin-top: 0; color: #2c3e50; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px;">
      🏆 Рейтинги сотрудников (Топ за {{ currentMonthName }})
    </h2>
    <p style="color: #7f8c8d; margin-bottom: 25px;">Показатели лучших менеджеров за текущий месяц (обновляется в реальном времени).</p>

    <div v-if="loading" style="color: #7f8c8d; font-size: 16px;">Подсчет рейтингов...</div>
    <div v-else-if="managers.length === 0" style="color: #e74c3c;">В этом месяце еще нет данных для рейтингов.</div>

    <div v-else class="ratings-grid">
      <div class="rating-card">
        <div class="card-header" style="background: #3498db;">
          <h3>📞 Лидеры по звонкам</h3>
          <small>Топ по количеству исходящих наборов</small>
        </div>
        <ul class="ranking-list">
          <li v-for="(m, i) in topCalls" :key="m.manager_id" :class="'rank-' + i">
            <span class="medal">{{ getMedal(i) }}</span>
            <span class="name">{{ m.manager_name }}</span>
            <span class="score">{{ m.total_calls }} шт</span>
          </li>
          <li v-if="topCalls.length === 0" class="empty">Нет звонков</li>
        </ul>
      </div>

      <div class="rating-card">
        <div class="card-header" style="background: #9b59b6;">
          <h3>💎 Лидеры по кач. лидам</h3>
          <small>Топ по количеству качественных лидов</small>
        </div>
        <ul class="ranking-list">
          <li v-for="(m, i) in topLeads" :key="m.manager_id" :class="'rank-' + i">
            <span class="medal">{{ getMedal(i) }}</span>
            <span class="name">{{ m.manager_name }}</span>
            <span class="score">{{ m.quality_leads }} шт</span>
          </li>
          <li v-if="topLeads.length === 0" class="empty">Нет качественных лидов</li>
        </ul>
      </div>

      <div class="rating-card">
        <div class="card-header" style="background: #27ae60;">
          <h3>💰 Лидеры по выручке</h3>
          <small>Топ по сумме подтвержденных оплат</small>
        </div>
        <ul class="ranking-list">
          <li v-for="(m, i) in topDeals" :key="m.manager_id" :class="'rank-' + i">
            <span class="medal">{{ getMedal(i) }}</span>
            <span class="name">{{ m.manager_name }}</span>
            <span class="score money">{{ m.amount_sum.toLocaleString('ru-RU') }} ₽</span>
          </li>
          <li v-if="topDeals.length === 0" class="empty">Нет оплат</li>
        </ul>
      </div>

      <div class="rating-card">
        <div class="card-header" style="background: #f39c12;">
          <h3>🎯 Лидеры по конверсии</h3>
          <small>Конверсия: Кач. лиды / Взято в работу</small>
        </div>
        <ul class="ranking-list">
          <li v-for="(m, i) in topConversion" :key="m.manager_id" :class="'rank-' + i">
            <span class="medal">{{ getMedal(i) }}</span>
            <span class="name">{{ m.manager_name }}</span>
            <span class="score conversion">
              {{ m.conv }}% <small style="color: #95a5a6; font-size: 11px;">({{ m.quality_leads }}/{{ m.unique_leads }})</small>
            </span>
          </li>
          <li v-if="topConversion.length === 0" class="empty">Нет данных для конверсии</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';

const managers = ref<any[]>([]);
const loading = ref(true);

const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const currentMonthName = computed(() => months[new Date().getMonth()]);

onMounted(async () => {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  
  try {
    const res = await fetch(`http://localhost:3000/api/analytics/managers?startDate=${startOfMonth}`);
    if (res.ok) {
      managers.value = await res.json();
    }
  } catch (e) {
    console.error('Ошибка загрузки рейтингов', e);
  } finally {
    loading.value = false;
  }
});

const getMedal = (index: number) => {
  if (index === 0) return '🥇';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  return `${index + 1}.`;
};

const topCalls = computed(() => [...managers.value].filter(m => m.total_calls > 0).sort((a, b) => b.total_calls - a.total_calls).slice(0, 3));
const topLeads = computed(() => [...managers.value].filter(m => m.quality_leads > 0).sort((a, b) => b.quality_leads - a.quality_leads).slice(0, 3));
const topDeals = computed(() => [...managers.value].filter(m => m.amount_sum > 0).sort((a, b) => b.amount_sum - a.amount_sum).slice(0, 3));

const topConversion = computed(() => {
  return [...managers.value]
    .map(m => ({ 
      ...m, 
      conv: m.unique_leads > 0 ? Math.round((m.quality_leads / m.unique_leads) * 100) : 0 
    }))
    .filter(m => m.conv > 0 && m.unique_leads >= 5) 
    .sort((a, b) => b.conv - a.conv)
    .slice(0, 3);
});
</script>

<style scoped>
.ratings-board { width: 100%; font-family: Arial, sans-serif; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
.ratings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 25px; margin-top: 20px; }

.rating-card { background: #fdfdfd; border-radius: 10px; overflow: hidden; border: 1px solid #eee; box-shadow: 0 2px 8px rgba(0,0,0,0.02); }
.card-header { padding: 15px 20px; color: white; text-align: center; }
.card-header h3 { margin: 0; font-size: 16px; margin-bottom: 5px; }
.card-header small { opacity: 0.85; font-size: 12px; }

.ranking-list { list-style: none; padding: 0; margin: 0; }
.ranking-list li { display: flex; align-items: center; padding: 15px 20px; border-bottom: 1px solid #f5f6fa; background: white; transition: transform 0.2s; }
.ranking-list li:last-child { border-bottom: none; }
.ranking-list li:hover { transform: translateX(5px); }

.rank-0 { background: linear-gradient(90deg, rgba(255,215,0,0.1) 0%, white 50%) !important; border-left: 3px solid #f1c40f; }
.rank-1 { background: linear-gradient(90deg, rgba(192,192,192,0.1) 0%, white 50%) !important; border-left: 3px solid #bdc3c7; }
.rank-2 { background: linear-gradient(90deg, rgba(205,127,50,0.1) 0%, white 50%) !important; border-left: 3px solid #d35400; }

.medal { font-size: 24px; width: 35px; text-align: center; margin-right: 15px; }
.name { flex: 1; font-weight: bold; color: #2c3e50; font-size: 15px; }
.score { font-weight: bold; color: #34495e; font-size: 16px; }
.money { color: #27ae60; }
.conversion { color: #e67e22; }
.empty { padding: 20px; text-align: center; color: #95a5a6; font-size: 13px; display: block !important; }
</style>