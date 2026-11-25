<template>
  <div class="teams-funnel">
    <div class="header-row">
      <div>
        <h2 style="margin: 0; color: #2c3e50;">🚀 Команды и воронка подключений</h2>
        <p class="subtitle">Отслеживание сделок по отделам, воронкам, стадиям потерь и компаниям</p>
      </div>

      <div class="filters">
        <select v-model="filters.period" @change="loadData" class="filter-select">
          <option value="all">За всё время</option>
          <option value="week">За последние 7 дней</option>
          <option value="month">За последние 30 дней</option>
        </select>

        <select v-model="filters.category_id" @change="loadData" class="filter-select">
          <option value="">Все воронки</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>

        <select v-model="filters.department_id" @change="loadData" class="filter-select">
          <option value="">Все отделы</option>
          <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>

        <label class="tm-checkbox">
          <input type="checkbox" v-model="filters.onlyTm" @change="loadData" />
          <span>Только от ТМ (связь/ИНН)</span>
        </label>
      </div>
    </div>

    <div v-if="loading" class="empty">Загрузка аналитики...</div>

    <div v-else class="content-grid">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">📥 Всего сделок</div>
          <div class="kpi-value">{{ summary.total_deals || 0 }}</div>
          <div class="kpi-sub">В работе: <strong>{{ summary.in_work || 0 }}</strong></div>
        </div>

        <div class="kpi-card" style="border-left: 4px solid #27ae60;">
          <div class="kpi-title">💳 Доведено до оплаты</div>
          <div class="kpi-value" style="color: #27ae60;">{{ summary.won_deals || 0 }}</div>
          <div class="kpi-sub">Конверсия: <strong>{{ conversionRate }}%</strong></div>
        </div>

        <div class="kpi-card" style="border-left: 4px solid #e74c3c;">
          <div class="kpi-title">🛑 Потеряно</div>
          <div class="kpi-value" style="color: #e74c3c;">{{ summary.lost_deals || 0 }}</div>
          <div class="kpi-sub">Сред. время до отказа: <strong>{{ summary.avg_days_to_loss ?? '—' }} дн.</strong></div>
        </div>

        <div class="kpi-card" style="border-left: 4px solid #3498db;">
          <div class="kpi-title">💰 Выручка и цикл</div>
          <div class="kpi-value" style="color: #2980b9;">{{ (summary.won_amount || 0).toLocaleString('ru-RU') }} ₽</div>
          <div class="kpi-sub">Сред. время до оплаты: <strong>{{ summary.avg_days_to_pay ?? '—' }} дн.</strong></div>
        </div>
      </div>

      <div class="split-row">
        <div class="card" style="flex: 1.5;">
          <h3>🏢 Сводка по отделам (командам)</h3>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Отдел</th>
                  <th>Всего</th>
                  <th>В работе</th>
                  <th>Оплачено</th>
                  <th>Потеряно</th>
                  <th>Конверсия</th>
                  <th style="text-align: right;">Выручка</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="byDepartment.length === 0"><td colspan="7" class="empty">Нет данных</td></tr>
                <tr v-for="d in byDepartment" :key="d.department_id">
                  <td><strong>{{ d.department_name }}</strong></td>
                  <td>{{ d.total_deals }}</td>
                  <td>{{ d.in_work }}</td>
                  <td style="color: #27ae60; font-weight: bold;">{{ d.won_deals }}</td>
                  <td style="color: #e74c3c;">{{ d.lost_deals }}</td>
                  <td><strong>{{ calcConv(d.won_deals, d.total_deals) }}%</strong></td>
                  <td style="text-align: right; font-weight: bold; color: #27ae60;">
                    {{ (d.won_amount || 0).toLocaleString('ru-RU') }} ₽
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card" style="flex: 1; border-left: 4px solid #e74c3c;">
          <h3>📉 Стадии потерь</h3>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Стадия</th>
                  <th>Воронка</th>
                  <th style="text-align: right;">Сделок</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="lossStages.length === 0"><td colspan="3" class="empty">Потерь нет</td></tr>
                <tr v-for="(s, idx) in lossStages" :key="idx">
                  <td><strong>{{ s.stage_name }}</strong></td>
                  <td style="color: #7f8c8d; font-size: 12px;">{{ s.category_name }}</td>
                  <td style="text-align: right; color: #e74c3c; font-weight: bold;">{{ s.count }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>🏆 Рейтинг менеджеров по сделкам</h3>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Менеджер</th>
                <th>Отдел</th>
                <th>Принято</th>
                <th>В работе</th>
                <th>Оплачено</th>
                <th>Потеряно</th>
                <th>Конверсия</th>
                <th>Цикл оплаты</th>
                <th style="text-align: right;">Выручка</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="managersRating.length === 0"><td colspan="9" class="empty">Нет данных</td></tr>
              <tr v-for="(m, idx) in managersRating" :key="m.manager_id">
                <td>
                  <span v-if="idx === 0">🥇 </span>
                  <span v-else-if="idx === 1">🥈 </span>
                  <span v-else-if="idx === 2">🥉 </span>
                  <strong>{{ m.manager_name }}</strong>
                </td>
                <td><span class="dept-badge">{{ m.department_name }}</span></td>
                <td>{{ m.total_deals }}</td>
                <td>{{ m.in_work }}</td>
                <td style="color: #27ae60; font-weight: bold;">{{ m.won_deals }}</td>
                <td style="color: #e74c3c;">{{ m.lost_deals }}</td>
                <td><strong>{{ calcConv(m.won_deals, m.total_deals) }}%</strong></td>
                <td>{{ m.avg_days_to_pay !== null ? m.avg_days_to_pay + ' дн.' : '—' }}</td>
                <td style="text-align: right; font-weight: bold; color: #27ae60;">
                  {{ (m.won_amount || 0).toLocaleString('ru-RU') }} ₽
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3>🏛️ Рейтинг компаний по выручке и сделкам</h3>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Компания</th>
                <th>ИНН</th>
                <th>Сделок</th>
                <th>Оплачено</th>
                <th style="text-align: right;">Выручка (₽)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="companiesRating.length === 0"><td colspan="5" class="empty">Нет данных по компаниям</td></tr>
              <tr v-for="(c, idx) in companiesRating" :key="idx">
                <td><strong>{{ c.company_name }}</strong></td>
                <td style="color: #7f8c8d;">{{ c.inn || '—' }}</td>
                <td>{{ c.deals_count }}</td>
                <td style="color: #27ae60; font-weight: bold;">{{ c.won_deals }}</td>
                <td style="text-align: right; font-weight: bold; color: #27ae60;">
                  {{ (c.won_amount || 0).toLocaleString('ru-RU') }} ₽
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';

const loading = ref(true);
const categories = ref<any[]>([]);
const departments = ref<any[]>([]);
const summary = ref<any>({});
const byDepartment = ref<any[]>([]);
const lossStages = ref<any[]>([]);
const managersRating = ref<any[]>([]);
const companiesRating = ref<any[]>([]);

const filters = reactive({
  period: 'month',
  category_id: '',
  department_id: '',
  onlyTm: true
});

const conversionRate = computed(() => {
  if (!summary.value.total_deals) return 0;
  return Math.round((summary.value.won_deals / summary.value.total_deals) * 100);
});

const calcConv = (won: number, total: number) => {
  if (!total) return 0;
  return Math.round((won / total) * 100);
};

const getDatesForPeriod = (period: string) => {
  if (period === 'all') return { start: '', end: '' };
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const d = new Date();
  if (period === 'week') d.setDate(d.getDate() - 7);
  else if (period === 'month') d.setMonth(d.getMonth() - 1);
  return { start: d.toISOString().split('T')[0], end };
};

const loadDepartments = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/departments');
    if (res.ok) departments.value = await res.json();
  } catch (e) {}
};

const loadData = async () => {
  loading.value = true;
  const { start, end } = getDatesForPeriod(filters.period);
  const params = new URLSearchParams();
  if (start) params.append('startDate', start);
  if (end) params.append('endDate', end);
  if (filters.category_id !== '') params.append('category_id', String(filters.category_id));
  if (filters.department_id) params.append('department_id', String(filters.department_id));
  params.append('onlyTm', String(filters.onlyTm));

  try {
    const res = await fetch(`http://localhost:3000/api/analytics/teams-funnel?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      categories.value = data.categories || [];
      summary.value = data.summary || {};
      byDepartment.value = data.byDepartment || [];
      lossStages.value = data.lossStages || [];
      managersRating.value = data.managersRating || [];
      companiesRating.value = data.companiesRating || [];
    }
  } catch (e) {
    console.error('Ошибка загрузки воронки команд:', e);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadDepartments();
  loadData();
});
</script>

<style scoped>
.teams-funnel { width: 100%; font-family: Arial, sans-serif; }
.header-row { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px; margin-bottom: 20px; flex-wrap: wrap; gap: 15px; }
.subtitle { color: #7f8c8d; font-size: 13px; margin: 5px 0 0; }

.filters { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.filter-select { padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; outline: none; background: white; color: #2c3e50; font-size: 13px; cursor: pointer; }
.tm-checkbox { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #2c3e50; font-weight: bold; cursor: pointer; background: #eafaf1; padding: 7px 12px; border-radius: 6px; border: 1px solid #a9dfbf; }

.content-grid { display: flex; flex-direction: column; gap: 25px; }
.kpi-grid { display: flex; gap: 20px; flex-wrap: wrap; }
.kpi-card { flex: 1; min-width: 200px; background: white; padding: 20px; border-radius: 10px; border: 1px solid #eee; box-shadow: 0 2px 10px rgba(0,0,0,0.02); }
.kpi-title { font-size: 13px; color: #7f8c8d; font-weight: bold; text-transform: uppercase; margin-bottom: 8px; }
.kpi-value { font-size: 26px; font-weight: bold; color: #2c3e50; margin-bottom: 6px; }
.kpi-sub { font-size: 12px; color: #7f8c8d; }

.split-row { display: flex; gap: 20px; flex-wrap: wrap; }
.card { background: white; padding: 20px; border-radius: 10px; border: 1px solid #eee; box-shadow: 0 2px 10px rgba(0,0,0,0.02); min-width: 300px; }
.card h3 { margin-top: 0; color: #34495e; margin-bottom: 15px; font-size: 16px; }

.table-responsive { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.data-table { width: 100%; border-collapse: collapse; min-width: 500px; }
.data-table th, .data-table td { padding: 11px 12px; border-bottom: 1px solid #f0f0f0; text-align: left; font-size: 13px; white-space: nowrap; }
.data-table th { background: #f5f6fa; color: #7f8c8d; font-weight: bold; }
.dept-badge { background: #f4f6f7; color: #34495e; padding: 3px 8px; border-radius: 4px; font-size: 12px; }
.empty { text-align: center; color: #7f8c8d; padding: 25px !important; }
</style>