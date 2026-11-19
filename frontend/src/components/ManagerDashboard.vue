<template>
  <div class="dashboard">
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
      <h2 style="margin: 0; color: #2c3e50;">Мой день (Статистика)</h2>
      
      <div class="filters">
        <select v-model="filters.period" @change="fetchStatsAndPlan" class="filter-select">
          <option value="today">Сегодня</option>
          <option value="week">За последние 7 дней</option>
          <option value="month">За последние 30 дней</option>
        </select>
      </div>
    </div>
    
    <div v-if="loading" style="color: #7f8c8d;">Загрузка данных...</div>
    <div v-else-if="error" style="color: #e74c3c;">{{ error }}</div>
    
    <div v-else>
      <div style="margin-bottom: 20px; color: #7f8c8d; font-size: 14px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          Квалификация: <strong>{{ managerInfo.qualification }}</strong> 
          (порог: {{ managerInfo.threshold }} сек)
        </div>
      </div>
      
      <div v-if="plan.working_days > 0 && filters.period === 'today'" class="plans-container">
        <h3>🎯 Выполнение плана на сегодня</h3>
        <div class="plan-card">
          <div class="plan-header">
            <span>📞 Звонки (Наборы)</span>
            <strong>{{ aggregatedStats.calls }} / {{ dailyCallsNorm }}</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :class="{ 'success': callsProgress >= 100 }" :style="{ width: Math.min(callsProgress, 100) + '%' }"></div>
          </div>
          <small class="plan-status">{{ callsProgress >= 100 ? 'Норма выполнена!' : `Осталось: ${Math.max(0, dailyCallsNorm - aggregatedStats.calls)}` }}</small>
        </div>

        <div class="plan-card">
          <div class="plan-header">
            <span>💎 Качественные лиды</span>
            <strong>{{ aggregatedStats.leads }} / {{ dailyLeadsNorm }}</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :class="{ 'success': leadsProgress >= 100 }" :style="{ width: Math.min(leadsProgress, 100) + '%' }"></div>
          </div>
          <small class="plan-status">{{ leadsProgress >= 100 ? 'Норма выполнена!' : `Осталось: ${Math.max(0, dailyLeadsNorm - aggregatedStats.leads)}` }}</small>
        </div>
      </div>

      <div class="conversions-container">
        <h3>📊 Воронка и конверсии (За выбранный период)</h3>
        <div class="conv-grid">
          <div class="conv-card">
            <div class="conv-title">% Дозвона (Системная)</div>
            <div class="conv-value" :class="connectionRate < 30 ? 'text-danger' : 'text-success'">{{ connectionRate }}%</div>
            <div class="conv-formula">Разговоры ({{ aggregatedStats.conversations }}) / Наборы ({{ aggregatedStats.calls }})</div>
          </div>

          <div class="conv-card" v-for="rule in conversionRules" :key="rule.id">
            <div class="conv-title">База "{{ rule.base_name }}"</div>
            
            <div v-if="!aggregatedBaseStats[rule.base_name] || !aggregatedBaseStats[rule.base_name][rule.denominator]" class="conv-value text-muted" style="font-size: 14px; margin-top: 10px;">
              Нет данных для расчёта
            </div>
            <div v-else class="conv-value text-primary">
              {{ Math.round(((aggregatedBaseStats[rule.base_name][rule.numerator] || 0) / aggregatedBaseStats[rule.base_name][rule.denominator]) * 100) }}%
            </div>
            
            <div class="conv-formula">
              {{ vocab[rule.numerator] }} / {{ vocab[rule.denominator] }}
            </div>
            <div class="conv-excluded">Исключено: {{ JSON.parse(rule.excluded_statuses).join(', ') }}</div>
          </div>

        </div>
      </div>

      <div v-if="weakSpots.length > 0 && filters.period === 'today'" class="weak-spots-container">
        <h3>⚠️ Зоны роста (Слабые места)</h3>
        <ul class="weak-spots-list">
          <li v-for="(spot, idx) in weakSpots" :key="idx">{{ spot }}</li>
        </ul>
      </div>

      <div class="split-layout">
        <div class="card" style="flex: 1;">
          <h3>📦 Остаток вашей базы</h3>
          <div class="remainder-grid">
            <div class="rem-item">
              <span class="rem-label">Импорт (нетронутые):</span>
              <span class="rem-value text-primary">{{ remainder.import_count || 0 }}</span>
            </div>
            <div class="rem-item">
              <span class="rem-label">Взято в работу (в процессе):</span>
              <span class="rem-value text-warning">{{ remainder.in_progress_count || 0 }}</span>
            </div>
            <div class="rem-item">
              <span class="rem-label">Качественные (цель):</span>
              <span class="rem-value text-success">{{ remainder.quality_count || 0 }}</span>
            </div>
            <div class="rem-item">
              <span class="rem-label">Отказы / Слиты:</span>
              <span class="rem-value text-danger">{{ remainder.refusal_count || 0 }}</span>
            </div>
            <div class="rem-item" style="border-top: 1px solid #eee; padding-top: 10px; margin-top: 10px;">
              <span class="rem-label"><strong>Всего закреплено за вами:</strong></span>
              <span class="rem-value"><strong>{{ remainder.total || 0 }}</strong></span>
            </div>
          </div>
        </div>

        <div class="card" style="flex: 1.5; border-left: 4px solid #f39c12;">
          <div style="display: flex; gap: 15px; margin-bottom: 15px; flex-wrap: wrap;">
            <button @click="activeListTab = 'retries'" :class="['tab-btn', { active: activeListTab === 'retries' }]">Недозвоны ({{ workLists.retries?.length || 0 }})</button>
            <button @click="activeListTab = 'returns'" :class="['tab-btn', { active: activeListTab === 'returns' }]">Догрев / Кросс ({{ workLists.returns?.length || 0 }})</button>
            <button @click="activeListTab = 'new'" :class="['tab-btn', { active: activeListTab === 'new' }]">Свежие в работе ({{ workLists.new_in_work?.length || 0 }})</button>
          </div>
          
          <div class="scrollable-table">
            <table class="data-table">
              <thead>
                <tr>
                  <th>ID Лида</th>
                  <th>База</th>
                  <th style="text-align: right;">Звонков</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!currentWorkList || currentWorkList.length === 0">
                  <td colspan="3" class="empty">В этом списке нет лидов.</td>
                </tr>
                <tr v-for="lead in currentWorkList" :key="lead.bitrix_lead_id">
                  <td><strong>#{{ lead.bitrix_lead_id }}</strong></td>
                  <td>{{ formatBaseName(lead.base_name) }}</td>
                  <td style="text-align: right; font-weight: bold; color: #7f8c8d;">{{ lead.calls_count }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      <div v-if="stats.length === 0" style="color: #7f8c8d; padding: 20px 0; text-align: center; border: 1px dashed #ccc; border-radius: 8px; margin-top: 20px;">
        У вас пока нет активности за этот период.
      </div>
      
      <div v-else>
        <div class="table-responsive">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Исходящие наборы</th>
                <th>Разговоры (> {{ managerInfo.threshold }} сек)</th>
                <th>Взято лидов</th>
                <th>Кач. Лиды</th>
                <th>Передано</th>
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
                <td style="color: #8e44ad; font-weight: bold;">{{ day.transfers }}</td>
                <td>{{ day.paid_deals }}</td>
                <td><strong>{{ day.amount_sum.toLocaleString('ru-RU') }}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed, reactive } from 'vue';

const props = defineProps<{ managerId: string | number; }>();

const stats = ref<any[]>([]);
const basesStats = ref<any[]>([]); 
const plan = ref({ working_days: 0, calls_norm: 0, leads_norm: 0 });
const managerInfo = ref({ qualification: 'обычный', threshold: 44 });
const remainder = ref<any>({});
const workLists = ref<any>({ retries: [], returns: [], new_in_work: [] });
const activeListTab = ref('retries');
const conversionRules = ref<any[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const filters = reactive({ period: 'today' });

const vocab: Record<string, string> = {
  quality_leads: 'Кач. лиды',
  paid_deals: 'Оплаты',
  transfers: 'Передачи',
  unique_leads: 'Взято в работу',
  total_calls: 'Все наборы',
  valid_conversations: 'Разговоры'
};

const getDatesForPeriod = (period: string) => {
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

const fetchStatsAndPlan = async () => {
  loading.value = true;
  try {
    const { start, end } = getDatesForPeriod(filters.period);
    const dateParams = `startDate=${start}&endDate=${end}`;
    
    const url = props.managerId ? `http://localhost:3000/api/dashboard?manager_id=${props.managerId}&${dateParams}` : `http://localhost:3000/api/dashboard?${dateParams}`;
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    const planUrl = `http://localhost:3000/api/plans?manager_id=${props.managerId}&month=${currentMonth}`;

    const [statsRes, planRes, rulesRes] = await Promise.all([
      fetch(url),
      props.managerId ? fetch(planUrl) : Promise.resolve(null),
      fetch('http://localhost:3000/api/conversions')
    ]);

    if (props.managerId) {
       const [infoRes, remRes, workRes] = await Promise.all([
         fetch(`http://localhost:3000/api/users/${props.managerId}/info`),
         fetch(`http://localhost:3000/api/manager/${props.managerId}/remainder`),
         fetch(`http://localhost:3000/api/manager/${props.managerId}/work-list`)
       ]);
       
       if (infoRes.ok) {
           const info = await infoRes.json();
           managerInfo.value = {
               qualification: info.qualification || 'обычный',
               threshold: info.qualification === 'ведущий' ? 59 : 44
           };
       }
       if (remRes.ok) remainder.value = await remRes.json();
       if (workRes.ok) workLists.value = await workRes.json();
    }
    
    if (statsRes.ok) {
      const rawStats = await statsRes.json();
      stats.value = rawStats;
      basesStats.value = rawStats; 
    }
    
    if (planRes && planRes.ok) plan.value = await planRes.json();
    if (rulesRes && rulesRes.ok) conversionRules.value = await rulesRes.json();
    
    error.value = null;
  } catch (err) {
    error.value = 'Не удалось подключиться к серверу';
  } finally {
    loading.value = false;
  }
};

onMounted(fetchStatsAndPlan);
watch(() => props.managerId, fetchStatsAndPlan);

const currentWorkList = computed(() => workLists.value[activeListTab.value] || []);
const formatBaseName = (nameStr: string) => {
  if (!nameStr) return 'Без базы';
  try {
    const parsed = JSON.parse(nameStr);
    if (Array.isArray(parsed)) return parsed.join(', ');
    return nameStr;
  } catch (e) { return nameStr; }
};
const formatDate = (dateStr: string) => dateStr ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(dateStr)) : '';

const aggregatedStats = computed(() => {
  return {
    calls: stats.value.reduce((acc, s) => acc + (s.total_outbound || 0), 0),
    conversations: stats.value.reduce((acc, s) => acc + (s.valid_conversations || 0), 0),
    leads: stats.value.reduce((acc, s) => acc + (s.quality_leads || 0), 0),
    unique: stats.value.reduce((acc, s) => acc + (s.unique_leads || 0), 0)
  };
});

const aggregatedBaseStats = computed(() => {
  const aggs: Record<string, any> = {};
  conversionRules.value.forEach(rule => {
    aggs[rule.base_name] = {
      quality_leads: aggregatedStats.value.leads,
      unique_leads: aggregatedStats.value.unique,
      total_calls: aggregatedStats.value.calls,
      valid_conversations: aggregatedStats.value.conversations,
      paid_deals: stats.value.reduce((acc, s) => acc + (s.paid_deals || 0), 0)
    };
  });
  return aggs;
});

const dailyCallsNorm = computed(() => plan.value.working_days ? Math.round(plan.value.calls_norm / plan.value.working_days) : 0);
const dailyLeadsNorm = computed(() => plan.value.working_days ? Math.round(plan.value.leads_norm / plan.value.working_days) : 0);
const callsProgress = computed(() => dailyCallsNorm.value === 0 ? 0 : Math.round((aggregatedStats.value.calls / dailyCallsNorm.value) * 100));
const leadsProgress = computed(() => dailyLeadsNorm.value === 0 ? 0 : Math.round((aggregatedStats.value.leads / dailyLeadsNorm.value) * 100));

const connectionRate = computed(() => aggregatedStats.value.calls ? Math.round((aggregatedStats.value.conversations / aggregatedStats.value.calls) * 100) : 0);
const qualityRate = computed(() => aggregatedStats.value.unique ? Math.round((aggregatedStats.value.leads / aggregatedStats.value.unique) * 100) : 0);

const weakSpots = computed(() => {
  const spots = [];
  const ts = aggregatedStats.value;
  if (ts.calls > 10 && connectionRate.value < 30) spots.push(`Низкий % дозвона (${connectionRate.value}%). Возможно, вы звоните в неудобное для клиентов время, либо проблемы с качеством базы.`);
  if (ts.conversations > 5 && qualityRate.value < 10) spots.push(`Мало качественных лидов при состоявшихся разговорах. Проверьте скрипт или отработку возражений.`);
  if (dailyCallsNorm.value > 0 && ts.calls < (dailyCallsNorm.value / 2) && new Date().getHours() > 14) spots.push(`Уже вторая половина дня, а выполнено менее 50% плана по звонкам. Ускоряйтесь!`);
  return spots;
});
</script>

<style scoped>
.dashboard { font-family: Arial, sans-serif; width: 100%; }

.filter-select { padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; outline: none; background: white; color: #2c3e50; cursor: pointer; }
.filters { display: flex; gap: 15px; align-items: center; flex-wrap: wrap; }

.tab-btn { background: #ecf0f1; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer; color: #7f8c8d; font-size: 13px; font-weight: bold; transition: 0.2s; }
.tab-btn.active { background: #3498db; color: white; }

.plans-container, .conversions-container, .weak-spots-container { background: white; padding: 20px; border-radius: 8px; margin-bottom: 25px; border: 1px solid #eee; box-shadow: 0 2px 8px rgba(0,0,0,0.03); }
.plans-container { display: flex; gap: 20px; flex-wrap: wrap; background: #f8f9fa; }
h3 { width: 100%; margin-top: 0; margin-bottom: 15px; color: #2c3e50; font-size: 18px; }

.plan-card { flex: 1; min-width: 250px; background: white; padding: 15px; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
.plan-header { display: flex; justify-content: space-between; margin-bottom: 10px; color: #34495e; }
.progress-track { width: 100%; height: 12px; background: #ecf0f1; border-radius: 6px; overflow: hidden; margin-bottom: 5px; }
.progress-fill { height: 100%; background: #3498db; border-radius: 6px; transition: width 0.4s ease; }
.progress-fill.success { background: #2ecc71; }
.plan-status { color: #7f8c8d; font-size: 12px; }

.conv-grid { display: flex; gap: 15px; flex-wrap: wrap; }
.conv-card { flex: 1; min-width: 200px; padding: 15px; background: #fdfdfd; border-left: 4px solid #3498db; border-radius: 6px; border-top: 1px solid #eee; border-right: 1px solid #eee; border-bottom: 1px solid #eee; position: relative;}
.conv-title { font-size: 13px; color: #7f8c8d; font-weight: bold; margin-bottom: 5px; }
.conv-value { font-size: 28px; font-weight: bold; margin-bottom: 5px; }
.conv-formula { font-size: 11px; color: #95a5a6; }
.conv-excluded { font-size: 10px; color: #d35400; margin-top: 8px; border-top: 1px dashed #eee; padding-top: 5px; }
.text-muted { color: #95a5a6 !important; }

.weak-spots-container { border-left: 4px solid #f39c12; background: #fffcf5; }
.weak-spots-list { margin: 0; padding-left: 20px; color: #d35400; font-size: 14px; line-height: 1.6; }

.split-layout { display: flex; gap: 20px; margin-bottom: 25px; flex-wrap: wrap; }
.card { background: white; padding: 20px; border-radius: 8px; border: 1px solid #eee; box-shadow: 0 2px 8px rgba(0,0,0,0.03); min-width: 300px; }
.remainder-grid { display: flex; flex-direction: column; gap: 10px; }
.rem-item { display: flex; justify-content: space-between; font-size: 14px; color: #34495e; }
.rem-value { font-weight: bold; }
.text-primary { color: #3498db; }
.text-success { color: #27ae60; }
.text-danger { color: #e74c3c; }
.text-warning { color: #f39c12; }

.table-responsive { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.scrollable-table { max-height: 250px; overflow-y: auto; overflow-x: auto; width: 100%; }

.data-table { width: 100%; border-collapse: collapse; min-width: 400px; }
.data-table th, .data-table td { padding: 10px; border-bottom: 1px solid #f0f0f0; text-align: left; font-size: 13px; white-space: nowrap; }
.data-table th { background: #f5f6fa; color: #7f8c8d; font-weight: normal; position: sticky; top: 0; z-index: 2; }

.stats-table { width: 100%; border-collapse: collapse; margin-top: 15px; min-width: 800px; }
.stats-table th, .stats-table td { border: 1px solid #ddd; padding: 12px; text-align: left; color: #2c3e50; white-space: nowrap; }
.stats-table th { background-color: #f5f6fa; font-weight: bold; }
</style>