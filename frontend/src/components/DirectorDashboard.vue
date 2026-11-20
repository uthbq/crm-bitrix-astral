<template>
  <div class="director-dashboard">
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
      <h2 style="margin: 0; color: #2c3e50;">Сводка по компании</h2>
      
      <div class="filters">
        <select v-model="filters.period" @change="loadAnalytics" class="filter-select">
          <option value="all">За всё время</option>
          <option value="today">Сегодня</option>
          <option value="week">За последние 7 дней</option>
          <option value="month">За последние 30 дней</option>
        </select>

        <div class="autocomplete-wrapper" style="margin-bottom: 0;">
          <input 
            v-model="searchBaseQuery" 
            @focus="showBaseDropdown = true" 
            @blur="setTimeout(() => showBaseDropdown = false, 200)"
            @input="handleBaseInput"
            placeholder="Поиск по базам..." 
            class="filter-select"
            style="min-width: 220px;"
          />
          <div v-if="showBaseDropdown && filteredBasesList.length" class="dropdown-list">
            <div 
              v-for="b in filteredBasesList" 
              :key="b.id" 
              @click="selectBaseFilter(b)" 
              class="dropdown-item"
            >
              {{ b.name }}
            </div>
          </div>
        </div>
        
        <select v-model="filters.manager_id" @change="loadAnalytics" class="filter-select">
          <option value="">Все менеджеры</option>
          <option v-for="m in managersList" :key="m.id" :value="m.bitrix_id">{{ m.login }}</option>
        </select>

        <button @click="exportToCSV" class="btn-export" :disabled="loading || managers.length === 0">
          📥 Экспорт в CSV
        </button>
      </div>
    </div>
    
    <div v-if="loading" style="color: #7f8c8d;">Загрузка аналитики...</div>
    
    <div v-else class="dashboard-grid">

      <div v-if="dataIssues.total > 0" class="data-issues-banner">
        <div style="display: flex; align-items: center; gap: 15px;">
          <span style="font-size: 24px;">⚠️</span>
          <div>
            <h4 style="margin: 0; color: #c0392b;">Обнаружены проблемы в данных ({{ dataIssues.total }})</h4>
            <p style="margin: 5px 0 0; font-size: 12px; color: #e74c3c;">Лиды без базы, сделки без ИНН или лиды без менеджера. Это искажает аналитику.</p>
          </div>
        </div>
        <button @click="showIssuesModal = true" class="btn-issues">Посмотреть детали</button>
      </div>
      
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">📞 Звонки (Наборы)</div>
          <div class="kpi-value">{{ kpiCurrent.calls }}</div>
          <div v-if="filters.period !== 'all'" class="kpi-trend" :class="getTrendClass(kpiCurrent.calls, kpiPrev.calls)">
            <span class="trend-arrow">{{ getTrendArrow(kpiCurrent.calls, kpiPrev.calls) }}</span>
            {{ getTrendAbs(kpiCurrent.calls, kpiPrev.calls) }} ({{ getTrendPercent(kpiCurrent.calls, kpiPrev.calls) }}%)
            <span class="trend-subtitle">к прошлому периоду</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-title">💎 Качественные лиды</div>
          <div class="kpi-value" style="color: #3498db;">{{ kpiCurrent.leads }}</div>
          <div v-if="filters.period !== 'all'" class="kpi-trend" :class="getTrendClass(kpiCurrent.leads, kpiPrev.leads)">
            <span class="trend-arrow">{{ getTrendArrow(kpiCurrent.leads, kpiPrev.leads) }}</span>
            {{ getTrendAbs(kpiCurrent.leads, kpiPrev.leads) }} ({{ getTrendPercent(kpiCurrent.leads, kpiPrev.leads) }}%)
            <span class="trend-subtitle">к прошлому периоду</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-title">💳 Оплаты (шт)</div>
          <div class="kpi-value" style="color: #27ae60;">{{ kpiCurrent.deals }}</div>
          <div v-if="filters.period !== 'all'" class="kpi-trend" :class="getTrendClass(kpiCurrent.deals, kpiPrev.deals)">
            <span class="trend-arrow">{{ getTrendArrow(kpiCurrent.deals, kpiPrev.deals) }}</span>
            {{ getTrendAbs(kpiCurrent.deals, kpiPrev.deals) }} ({{ getTrendPercent(kpiCurrent.deals, kpiPrev.deals) }}%)
            <span class="trend-subtitle">к прошлому периоду</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-title">💰 Выручка (₽)</div>
          <div class="kpi-value" style="color: #27ae60;">{{ kpiCurrent.revenue.toLocaleString('ru-RU') }}</div>
          <div v-if="filters.period !== 'all'" class="kpi-trend" :class="getTrendClass(kpiCurrent.revenue, kpiPrev.revenue)">
            <span class="trend-arrow">{{ getTrendArrow(kpiCurrent.revenue, kpiPrev.revenue) }}</span>
            {{ getTrendAbs(kpiCurrent.revenue, kpiPrev.revenue).toLocaleString('ru-RU') }} ({{ getTrendPercent(kpiCurrent.revenue, kpiPrev.revenue) }}%)
            <span class="trend-subtitle">к прошлому периоду</span>
          </div>
        </div>
      </div>

      <div class="card" v-if="filters.base_id" style="border-left: 4px solid #9b59b6;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 15px;">
          <h3 style="margin: 0;">📊 Отработка базы «{{ selectedBaseName }}» по менеджерам</h3>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button @click="baseChartMetric = 'calls'" :class="['metric-btn', { active: baseChartMetric === 'calls' }]">Звонки и Разговоры</button>
            <button @click="baseChartMetric = 'leads'" :class="['metric-btn', { active: baseChartMetric === 'leads' }]">Кач. лиды и Оплаты</button>
            <button @click="baseChartMetric = 'revenue'" :class="['metric-btn', { active: baseChartMetric === 'revenue' }]">Выручка (₽)</button>
          </div>
        </div>
        <div v-if="managers.length === 0" class="empty">По этой базе нет активности менеджеров за выбранный период.</div>
        <div v-else class="chart-container" style="height: 300px;">
          <Bar :data="baseManagersChartData" :options="chartOptions" />
        </div>
      </div>

      <div class="card" v-if="dailyStats.length > 0">
        <h3>📈 Динамика звонков</h3>
        <div class="chart-container" style="height: 250px;">
          <Bar :data="chartData" :options="chartOptions" />
        </div>
      </div>
      
      <div class="split-card-row" style="margin-top: -10px;">
        <div class="card" style="flex: 1; border-left: 4px solid #3498db;">
          <h3>💎 Кач. лиды по продуктам</h3>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr><th>Продукт</th><th style="text-align: right;">Кач. лидов</th></tr>
              </thead>
              <tbody>
                <tr v-if="productsStats.length === 0"><td colspan="2" class="empty">Нет качественных лидов</td></tr>
                <tr v-for="p in productsStats" :key="p.product_name">
                  <td>{{ p.product_name }}</td>
                  <td style="text-align: right; font-weight: bold; color: #3498db;">{{ p.quality_leads }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card" style="flex: 1; border-left: 4px solid #f39c12;">
          <h3>📞 Целевые звонки</h3>
          <p style="font-size: 12px; color: #7f8c8d; margin-top: -10px; margin-bottom: 15px;">
            Привязка звонков к карточкам CRM
          </p>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <span>Сопоставлено с базой:</span>
            <strong style="color: #27ae60; font-size: 18px;">
              {{ callsConnectionStats.assigned_calls }}
            </strong>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed #eee; padding-top: 10px;">
            <span>Несопоставленные:</span>
            <strong style="color: #e74c3c; font-size: 18px;">
              {{ callsConnectionStats.unassigned_calls }}
            </strong>
          </div>
          <div style="margin-top: 15px; font-size: 12px; color: #95a5a6; text-align: right;">
            Всего загружено звонков: {{ callsConnectionStats.total_calls }}
          </div>
        </div>
      </div>

      <div class="split-card-row">
        <div class="card" style="flex: 2; border-left: 4px solid #e74c3c;">
          <h3>
            🛑 Топ причин отказов 
            <span v-if="filters.base_id" style="font-size: 12px; color: #9b59b6; font-weight: normal;">(База: {{ selectedBaseName }})</span>
            <span style="font-size: 12px; color: #7f8c8d; font-weight: normal;"> (Нажмите для деталей)</span>
          </h3>
          <div class="table-responsive">
            <table class="data-table interactive-table">
              <thead>
                <tr>
                  <th>Причина</th>
                  <th style="width: 160px; text-align: center;">Лидов (к прошл. периоду)</th>
                  <th style="width: 100px; text-align: center;">Доля (%)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="refusals.length === 0"><td colspan="3" class="empty">Нет отказов за этот период</td></tr>
                <tr v-for="(r, index) in refusals" :key="index" @click="openReasonDetails(r)">
                  <td><strong>{{ r.reason_name }}</strong></td>
                  <td style="text-align: center; color: #e74c3c; font-weight: bold;">
                    {{ r.count }}
                    <span v-html="renderTrendHTML(r.count, getPrevValue(refusalsPrev, 'id', r.id, 'count'))"></span>
                  </td>
                  <td style="text-align: center; color: #7f8c8d;">{{ getRefusalPercentage(r.count) }}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card" style="flex: 1; border-left: 4px solid #95a5a6;">
          <h3>Топ "Молчунов"</h3>
          <p style="font-size: 12px; color: #7f8c8d; margin-top: -10px; margin-bottom: 10px;">Слили лид, не указав причину</p>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Менеджер</th>
                  <th style="text-align: center;">Кол-во</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="silentManagers.length === 0"><td colspan="2" class="empty">Молчунов нет 🎉</td></tr>
                <tr v-for="sm in silentManagers" :key="sm.manager_id">
                  <td>{{ sm.manager_name }}</td>
                  <td style="text-align: center; font-weight: bold; color: #e74c3c;">{{ sm.silent_count }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      <div class="card">
        <h3>🏆 Рейтинг менеджеров (Сравнение периодов) <span style="font-size: 12px; font-weight: normal; color: #95a5a6; margin-left: 10px;">*нажмите на подчеркнутые цифры для деталей</span></h3>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Звонки</th>
                <th>Разговоры</th>
                <th>Кач. Лиды</th>
                <th>Передано</th>
                <th>Оплаты</th>
                <th>Сумма (₽)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="managers.length === 0"><td colspan="7" class="empty">Нет данных за этот период</td></tr>
              <tr v-for="(m, index) in managers" :key="m.manager_id">
                <td>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span v-if="index === 0" style="font-size: 16px;">🥇</span>
                    <span v-else-if="index === 1" style="font-size: 16px;">🥈</span>
                    <span v-else-if="index === 2" style="font-size: 16px;">🥉</span>
                    <span v-else style="width: 16px;"></span>
                    <strong>{{ m.manager_name }}</strong>
                  </div>
                </td>
                <td>
                  {{ m.total_calls }}
                  <span v-html="renderTrendHTML(m.total_calls, getPrevValue(managersPrev, 'manager_id', m.manager_id, 'total_calls'))"></span>
                </td>
                <td>
                  {{ m.valid_conversations }}
                  <span v-html="renderTrendHTML(m.valid_conversations, getPrevValue(managersPrev, 'manager_id', m.manager_id, 'valid_conversations'))"></span>
                </td>
                <td>
                  <span class="drilldown-link" @click="openDrilldown(m.manager_id, filters.base_id || null, 'quality_leads', `Кач. лиды: ${m.manager_name}`)">
                    {{ m.quality_leads }}
                  </span>
                  <span v-html="renderTrendHTML(m.quality_leads, getPrevValue(managersPrev, 'manager_id', m.manager_id, 'quality_leads'))"></span>
                </td>
                <td style="color: #8e44ad; font-weight: bold;">
                  {{ m.transfers }}
                  <span v-html="renderTrendHTML(m.transfers, getPrevValue(managersPrev, 'manager_id', m.manager_id, 'transfers'))"></span>
                </td>
                <td>
                  <span class="drilldown-link" @click="openDrilldown(m.manager_id, filters.base_id || null, 'paid_deals', `Сделки: ${m.manager_name}`)">
                    {{ m.paid_deals }}
                  </span>
                  <span v-html="renderTrendHTML(m.paid_deals, getPrevValue(managersPrev, 'manager_id', m.manager_id, 'paid_deals'))"></span>
                </td>
                <td class="money">
                  <span class="drilldown-link" @click="openDrilldown(m.manager_id, filters.base_id || null, 'paid_deals', `Выручка: ${m.manager_name}`)">
                    {{ m.amount_sum.toLocaleString('ru-RU') }} ₽
                  </span>
                  <span v-html="renderTrendHTML(m.amount_sum, getPrevValue(managersPrev, 'manager_id', m.manager_id, 'amount_sum'))"></span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3>📁 Эффективность баз (Сравнение периодов)</h3>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>База</th>
                <th>Кач. Лиды</th>
                <th>Оплаты (шт)</th>
                <th>Осн. продукт (₽)</th>
                <th>Кросс-продажи (₽)</th>
                <th>Итого (₽)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="bases.length === 0"><td colspan="6" class="empty">Нет данных за этот период</td></tr>
              <tr v-for="b in bases" :key="b.base_id">
                <td><strong>{{ b.base_name }}</strong></td>
                <td>
                  <span class="drilldown-link" @click="openDrilldown(filters.manager_id || null, b.base_id, 'quality_leads', `Кач. лиды базы: ${b.base_name}`)">
                    {{ b.quality_leads }}
                  </span>
                  <span v-html="renderTrendHTML(b.quality_leads, getPrevValue(basesPrev, 'base_id', b.base_id, 'quality_leads'))"></span>
                </td>
                <td>
                  <span class="drilldown-link" @click="openDrilldown(filters.manager_id || null, b.base_id, 'paid_deals', `Сделки базы: ${b.base_name}`)">
                    {{ b.paid_deals }}
                  </span>
                  <span v-html="renderTrendHTML(b.paid_deals, getPrevValue(basesPrev, 'base_id', b.base_id, 'paid_deals'))"></span>
                </td>
                <td class="money" style="color: #2980b9;">{{ b.main_amount.toLocaleString('ru-RU') }}</td>
                <td style="color: #f39c12; font-weight: bold;">{{ b.cross_amount.toLocaleString('ru-RU') }}</td>
                <td class="money">
                  <span class="drilldown-link" @click="openDrilldown(filters.manager_id || null, b.base_id, 'paid_deals', `Выручка базы: ${b.base_name}`)">
                    {{ b.amount_sum.toLocaleString('ru-RU') }}
                  </span>
                  <span v-html="renderTrendHTML(b.amount_sum, getPrevValue(basesPrev, 'base_id', b.base_id, 'amount_sum'))"></span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>

    <div v-if="showDrilldownModal" class="modal-overlay" @click.self="showDrilldownModal = false">
      <div class="modal-content">
        <div class="modal-header">
          <h3 style="margin: 0;">Детализация: <span style="color: #3498db;">{{ drilldownTitle }}</span></h3>
          <button @click="showDrilldownModal = false" class="btn-close">✖</button>
        </div>
        <div class="modal-body">
          <div v-if="drilldownLoading" style="text-align: center; color: #7f8c8d; padding: 20px;">Поиск в локальной БД...</div>
          <div v-else class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Сущность (ID)</th>
                  <th>Дата</th>
                  <th>Менеджер</th>
                  <th>База</th>
                  <th style="text-align: right;">Сумма</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="drilldownData.length === 0"><td colspan="5" class="empty">Связанные карточки не найдены</td></tr>
                <tr v-for="item in drilldownData" :key="item.b24_id">
                  <td>
                    <span class="b24-id-badge">
                      {{ item.type === 'deal' ? 'Сделка' : 'Лид' }} #{{ item.b24_id }}
                    </span>
                  </td>
                  <td>{{ formatDateTime(item.created_at) }}</td>
                  <td>{{ item.manager_name }}</td>
                  <td>{{ item.base_name || '—' }}</td>
                  <td style="text-align: right; font-weight: bold; color: #27ae60;">
                    {{ item.amount ? item.amount.toLocaleString('ru-RU') + ' ₽' : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showIssuesModal" class="modal-overlay" @click.self="showIssuesModal = false">
      <div class="modal-content">
        <div class="modal-header">
          <h3 style="margin: 0; color: #c0392b;">Отчет: Проблемы качества данных</h3>
          <button @click="showIssuesModal = false" class="btn-close">✖</button>
        </div>
        <div class="modal-body">
          
          <h4 v-if="dataIssues.details.dealsNoInn?.length">Оплаченные сделки без ИНН ({{ dataIssues.details.dealsNoInn.length }})</h4>
          <p class="issue-desc" v-if="dataIssues.details.dealsNoInn?.length">Невозможно привязать эти продажи к исходным лидам телемаркетинга.</p>
          <div class="issue-list" v-if="dataIssues.details.dealsNoInn?.length">
            <span v-for="d in dataIssues.details.dealsNoInn" :key="d.id" class="b24-id-badge-small">
              Сделка #{{ d.id }} ({{ d.amount }}₽)
            </span>
          </div>

          <h4 v-if="dataIssues.details.noBase?.length" style="margin-top: 20px;">Взятые в работу лиды без Базы ({{ dataIssues.details.noBase.length }})</h4>
          <p class="issue-desc" v-if="dataIssues.details.noBase?.length">Менеджер не заполнил поле сегментации (базы). Эти лиды не попадут в конверсию баз.</p>
          <div class="issue-list" v-if="dataIssues.details.noBase?.length">
            <span v-for="l in dataIssues.details.noBase" :key="l.id" class="b24-id-badge-small">
              Лид #{{ l.id }}
            </span>
          </div>

          <h4 v-if="dataIssues.details.noManager?.length" style="margin-top: 20px;">Лиды без ответственного ({{ dataIssues.details.noManager.length }})</h4>
          <div class="issue-list" v-if="dataIssues.details.noManager?.length">
            <span v-for="l in dataIssues.details.noManager" :key="l.id" class="b24-id-badge-small">
              Лид #{{ l.id }}
            </span>
          </div>

        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3 style="margin: 0;">Детализация причины: <span style="color: #e74c3c;">{{ selectedReasonName }}</span></h3>
          <button @click="closeModal" class="btn-close">✖</button>
        </div>
        <div class="modal-body">
          <div v-if="modalLoading" style="text-align: center; color: #7f8c8d; padding: 20px;">Загрузка лидов...</div>
          <div v-else class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Дата создания</th>
                  <th>Менеджер</th>
                  <th>Сегмент (База)</th>
                  <th style="text-align: right;">ID в базе</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="detailedLeads.length === 0"><td colspan="4" class="empty">Лиды не найдены</td></tr>
                <tr v-for="lead in detailedLeads" :key="lead.bitrix_lead_id">
                  <td>{{ formatDateTime(lead.created_at) }}</td>
                  <td>{{ lead.manager_name }}</td>
                  <td>{{ lead.base_name || 'Не указана' }}</td>
                  <td style="text-align: right;">
                    <span class="b24-id-badge">
                      ID: {{ lead.bitrix_lead_id }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, reactive } from 'vue';
import { Bar } from 'vue-chartjs';
import { 
  Chart as ChartJS, Title, Tooltip, Legend, 
  BarElement, CategoryScale, LinearScale 
} from 'chart.js';

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale);

const managers = ref<any[]>([]);
const bases = ref<any[]>([]);
const dailyStats = ref<any[]>([]);
const refusals = ref<any[]>([]); 
const silentManagers = ref<any[]>([]); 
const productsStats = ref<any[]>([]);
const callsConnectionStats = ref<any>({ total_calls: 0, unassigned_calls: 0, assigned_calls: 0 });

const managersPrev = ref<any[]>([]);
const basesPrev = ref<any[]>([]);
const refusalsPrev = ref<any[]>([]);

const basesList = ref<any[]>([]); 
const managersList = ref<any[]>([]);
const loading = ref(true);

const filters = reactive({ period: 'week', base_id: '', manager_id: '' });
const baseChartMetric = ref<'calls' | 'leads' | 'revenue'>('calls');

const searchBaseQuery = ref('');
const showBaseDropdown = ref(false);

const kpiCurrent = reactive({ calls: 0, leads: 0, deals: 0, revenue: 0 });
const kpiPrev = reactive({ calls: 0, leads: 0, deals: 0, revenue: 0 });

const showModal = ref(false); 
const modalLoading = ref(false);
const selectedReasonName = ref('');
const detailedLeads = ref<any[]>([]);

const showDrilldownModal = ref(false);
const drilldownLoading = ref(false);
const drilldownTitle = ref('');
const drilldownData = ref<any[]>([]);

const showIssuesModal = ref(false);
const dataIssues = ref({ total: 0, details: {} as any });

const selectedBaseName = computed(() => {
  const b = basesList.value.find(item => item.id === filters.base_id);
  return b ? b.name : searchBaseQuery.value;
});

const filteredBasesList = computed(() => {
  if (!searchBaseQuery.value) return basesList.value;
  const q = searchBaseQuery.value.toLowerCase();
  return basesList.value.filter(b => b.name.toLowerCase().includes(q));
});

const selectBaseFilter = (base: any) => {
  filters.base_id = base.id;
  searchBaseQuery.value = base.name;
  showBaseDropdown.value = false;
  loadAnalytics();
};

const handleBaseInput = () => {
  if (searchBaseQuery.value === '') {
    filters.base_id = '';
    loadAnalytics();
  }
};

const totalRefusalsCount = computed(() => refusals.value.reduce((sum, r) => sum + r.count, 0));
const getRefusalPercentage = (count: number) => totalRefusalsCount.value === 0 ? 0 : Math.round((count / totalRefusalsCount.value) * 100);

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

const getPrevDatesForPeriod = (period: string) => {
  if (period === 'all') return { start: '', end: '' };
  const today = new Date();
  const end = new Date();
  const start = new Date();

  if (period === 'today') {
    end.setDate(today.getDate() - 1);
    start.setDate(today.getDate() - 1);
  } else if (period === 'week') {
    end.setDate(today.getDate() - 8);
    start.setDate(today.getDate() - 14);
  } else if (period === 'month') {
    end.setDate(today.getDate() - 31);
    start.setDate(today.getDate() - 60);
  }
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
};

const getPrevValue = (arr: any[], idKey: string, idVal: any, valKey: string) => {
  const item = arr.find(i => i[idKey] === idVal);
  return item ? (item[valKey] || 0) : 0;
};

const renderTrendHTML = (current: number, previous: number) => {
  if (filters.period === 'all') return ''; 
  const diff = current - previous;
  const pct = previous === 0 ? (current > 0 ? 100 : 0) : Math.round((Math.abs(diff) / previous) * 100);
  if (diff > 0) return `<span style="color: #27ae60; font-size: 11px; margin-left: 5px;">↑${diff} (+${pct}%)</span>`;
  if (diff < 0) return `<span style="color: #e74c3c; font-size: 11px; margin-left: 5px;">↓${Math.abs(diff)} (-${pct}%)</span>`;
  return `<span style="color: #95a5a6; font-size: 11px; margin-left: 5px;">—</span>`;
};

const getTrendClass = (cur: number, prev: number) => cur > prev ? 'trend-up' : (cur < prev ? 'trend-down' : 'trend-neutral');
const getTrendArrow = (cur: number, prev: number) => cur > prev ? '↑' : (cur < prev ? '↓' : '—');
const getTrendAbs = (cur: number, prev: number) => Math.abs(cur - prev);
const getTrendPercent = (cur: number, prev: number) => prev === 0 ? (cur > 0 ? 100 : 0) : Math.round((Math.abs(cur - prev) / prev) * 100);

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(dateStr));
};

const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '-';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(dateStr));
};

const chartData = computed(() => {
  const reversedStats = [...dailyStats.value].reverse();
  return {
    labels: reversedStats.map(day => formatDate(day.date)),
    datasets: [
      { label: 'Исходящие наборы', backgroundColor: '#3498db', data: reversedStats.map(day => day.total_outbound) },
      { label: 'Разговоры', backgroundColor: '#2ecc71', data: reversedStats.map(day => day.valid_conversations) }
    ]
  };
});

const baseManagersChartData = computed(() => {
  const topManagers = managers.value.slice(0, 15);
  const labels = topManagers.map(m => m.manager_name);

  if (baseChartMetric.value === 'calls') {
    return {
      labels,
      datasets: [
        { label: 'Звонки', backgroundColor: '#3498db', data: topManagers.map(m => m.total_calls) },
        { label: 'Разговоры', backgroundColor: '#2ecc71', data: topManagers.map(m => m.valid_conversations) }
      ]
    };
  }
  if (baseChartMetric.value === 'leads') {
    return {
      labels,
      datasets: [
        { label: 'Кач. лиды', backgroundColor: '#9b59b6', data: topManagers.map(m => m.quality_leads) },
        { label: 'Оплаты', backgroundColor: '#f39c12', data: topManagers.map(m => m.paid_deals) }
      ]
    };
  }
  return {
    labels,
    datasets: [
      { label: 'Выручка (₽)', backgroundColor: '#27ae60', data: topManagers.map(m => m.amount_sum) }
    ]
  };
});

const chartOptions = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: 'top' as const } },
  scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
};

const loadDataIssues = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/data-issues');
    if (res.ok) dataIssues.value = await res.json();
  } catch (err) {
    console.error(err);
  }
};

const loadAnalytics = async () => {
  loading.value = true;
  const { start, end } = getDatesForPeriod(filters.period);
  
  const queryParams = new URLSearchParams();
  if (start) queryParams.append('startDate', start);
  if (end) queryParams.append('endDate', end);
  if (filters.base_id) queryParams.append('base_id', filters.base_id);
  if (filters.manager_id) queryParams.append('manager_id', filters.manager_id);
  const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : '';

  const prevDates = getPrevDatesForPeriod(filters.period);
  const prevParams = new URLSearchParams();
  if (prevDates.start) prevParams.append('startDate', prevDates.start);
  if (prevDates.end) prevParams.append('endDate', prevDates.end);
  if (filters.base_id) prevParams.append('base_id', filters.base_id);
  if (filters.manager_id) prevParams.append('manager_id', filters.manager_id);
  const prevQueryStr = prevParams.toString() ? `?${prevParams.toString()}` : '';

  try {
    const [resManagers, resBases, resDaily, resRefusals, resSilent, resProductsAndCalls] = await Promise.all([
      fetch(`http://localhost:3000/api/analytics/managers${queryStr}`),
      fetch(`http://localhost:3000/api/analytics/bases${queryStr}`),
      fetch(`http://localhost:3000/api/dashboard${queryStr}`),
      fetch(`http://localhost:3000/api/analytics/refusals${queryStr}`),
      fetch(`http://localhost:3000/api/analytics/refusals/silent${queryStr}`),
      fetch(`http://localhost:3000/api/analytics/products-and-calls${queryStr}`)
    ]);
    
    if (resManagers.ok) managers.value = await resManagers.json();
    if (resBases.ok) bases.value = await resBases.json();
    if (resDaily.ok) dailyStats.value = await resDaily.json();
    if (resRefusals.ok) refusals.value = await resRefusals.json();
    if (resSilent.ok) silentManagers.value = await resSilent.json();
    if (resProductsAndCalls && resProductsAndCalls.ok) {
        const data = await resProductsAndCalls.json();
        productsStats.value = data.leadsByProduct;
        callsConnectionStats.value = data.callsStats || { total_calls: 0, unassigned_calls: 0, assigned_calls: 0 };
    }
    
    if (filters.period !== 'all') {
      const [pMan, pBas, pRef, pDaily] = await Promise.all([
        fetch(`http://localhost:3000/api/analytics/managers${prevQueryStr}`),
        fetch(`http://localhost:3000/api/analytics/bases${prevQueryStr}`),
        fetch(`http://localhost:3000/api/analytics/refusals${prevQueryStr}`),
        fetch(`http://localhost:3000/api/dashboard${prevQueryStr}`)
      ]);
      if (pMan.ok) managersPrev.value = await pMan.json();
      if (pBas.ok) basesPrev.value = await pBas.json();
      if (pRef.ok) refusalsPrev.value = await pRef.json();
      if (pDaily.ok) {
        const prevStats = await pDaily.json();
        kpiPrev.calls = prevStats.reduce((sum: number, day: any) => sum + (day.total_outbound || 0), 0);
        kpiPrev.leads = prevStats.reduce((sum: number, day: any) => sum + (day.quality_leads || 0), 0);
        kpiPrev.deals = prevStats.reduce((sum: number, day: any) => sum + (day.paid_deals || 0), 0);
        kpiPrev.revenue = prevStats.reduce((sum: number, day: any) => sum + (day.amount_sum || 0), 0);
      }
    } else {
      managersPrev.value = []; basesPrev.value = []; refusalsPrev.value = [];
      kpiPrev.calls = 0; kpiPrev.leads = 0; kpiPrev.deals = 0; kpiPrev.revenue = 0;
    }

    kpiCurrent.calls = dailyStats.value.reduce((sum: number, day: any) => sum + (day.total_outbound || 0), 0);
    kpiCurrent.leads = dailyStats.value.reduce((sum: number, day: any) => sum + (day.quality_leads || 0), 0);
    kpiCurrent.deals = dailyStats.value.reduce((sum: number, day: any) => sum + (day.paid_deals || 0), 0);
    kpiCurrent.revenue = dailyStats.value.reduce((sum: number, day: any) => sum + (day.amount_sum || 0), 0);

  } catch (err) {
    console.error('Ошибка загрузки дашборда', err);
  } finally {
    loading.value = false;
  }
};

const loadLists = async () => {
  try {
    const [resBases, resUsers] = await Promise.all([
      fetch('http://localhost:3000/api/bases'),
      fetch('http://localhost:3000/api/users')
    ]);
    if (resBases.ok) basesList.value = await resBases.json();
    if (resUsers.ok) managersList.value = await resUsers.json();
  } catch (e) {}
};

const openDrilldown = async (managerId: any, baseId: any, metric: string, title: string) => {
    drilldownTitle.value = title;
    showDrilldownModal.value = true;
    drilldownData.value = [];
    drilldownLoading.value = true;

    const { start, end } = getDatesForPeriod(filters.period);
    const params = new URLSearchParams();
    if (start) params.append('startDate', start);
    if (end) params.append('endDate', end);
    if (managerId) params.append('manager_id', managerId);
    if (baseId) params.append('base_id', baseId);
    params.append('metric', metric);

    try {
        const res = await fetch(`http://localhost:3000/api/analytics/drilldown?${params.toString()}`);
        if (res.ok) drilldownData.value = await res.json();
    } catch(e) {
        console.error(e);
    } finally {
        drilldownLoading.value = false;
    }
};

const openReasonDetails = async (reason: any) => {
  selectedReasonName.value = reason.reason_name;
  showModal.value = true;
  modalLoading.value = true;
  
  const { start, end } = getDatesForPeriod(filters.period);
  const queryParams = new URLSearchParams();
  if (start) queryParams.append('startDate', start);
  if (end) queryParams.append('endDate', end);
  if (filters.base_id) queryParams.append('base_id', filters.base_id);
  if (filters.manager_id) queryParams.append('manager_id', filters.manager_id);
  
  const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : '';

  try {
    const res = await fetch(`http://localhost:3000/api/analytics/refusals/${reason.id}/details${queryStr}`);
    if (res.ok) detailedLeads.value = await res.json();
  } catch (e) {
    console.error('Ошибка загрузки деталей:', e);
  } finally {
    modalLoading.value = false;
  }
};

const closeModal = () => {
  showModal.value = false;
  detailedLeads.value = [];
};

const exportToCSV = () => {
  if (managers.value.length === 0) return;
  
  let csvContent = "Сотрудник;Звонки;Разговоры;Кач. Лиды;Передано;Оплаты;Сумма выручки\n";
  managers.value.forEach(m => {
    const name = m.manager_name.replace(/;/g, ' '); 
    csvContent += `${name};${m.total_calls};${m.valid_conversations};${m.quality_leads};${m.transfers};${m.paid_deals};${m.amount_sum}\n`;
  });
  
  const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
  
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `Аналитика_Менеджеры_${filters.period}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

onMounted(() => {
  loadLists();
  loadAnalytics();
  loadDataIssues(); 
});
</script>

<style scoped>
.kpi-grid { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 30px; }
.kpi-card { flex: 1; min-width: 200px; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.02); border: 1px solid #eee; display: flex; flex-direction: column; }
.kpi-title { font-size: 14px; color: #7f8c8d; font-weight: bold; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
.kpi-value { font-size: 28px; font-weight: bold; color: #2c3e50; margin-bottom: 10px; }
.kpi-trend { font-size: 14px; font-weight: bold; display: flex; align-items: center; gap: 5px; }
.trend-arrow { font-size: 16px; }
.trend-subtitle { font-size: 11px; color: #95a5a6; font-weight: normal; margin-left: 5px; }
.trend-up { color: #27ae60; }
.trend-down { color: #e74c3c; }
.trend-neutral { color: #95a5a6; }

.metric-btn { background: #ecf0f1; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; color: #34495e; font-size: 12px; font-weight: bold; transition: 0.2s; }
.metric-btn.active { background: #9b59b6; color: white; }

.split-card-row { display: flex; gap: 30px; flex-wrap: wrap; margin-bottom: 30px; }
.interactive-table tbody tr { cursor: pointer; transition: background 0.2s; }
.interactive-table tbody tr:hover { background-color: #f8f9fa; }

.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; align-items: center; z-index: 1000; padding: 20px; }
.modal-content { background: white; border-radius: 12px; width: 100%; max-width: 900px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
.modal-header { display: flex; justify-content: space-between; align-items: center; padding: 20px; border-bottom: 1px solid #eee; }
.btn-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #7f8c8d; }
.btn-close:hover { color: #e74c3c; }
.modal-body { padding: 20px; overflow-y: auto; }

.director-dashboard { width: 100%; font-family: Arial, sans-serif; }
.filters { display: flex; gap: 15px; align-items: center; flex-wrap: wrap; }
.filter-select { padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; outline: none; background: white; color: #2c3e50; cursor: pointer; }
.btn-export { padding: 8px 15px; background: #27ae60; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; transition: background 0.2s; display: flex; align-items: center; gap: 5px; }
.btn-export:hover:not(:disabled) { background: #2ecc71; }
.btn-export:disabled { background: #95a5a6; cursor: not-allowed; }
.dashboard-grid { display: flex; flex-direction: column; gap: 30px; }
.card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.02); border: 1px solid #eee; }
.card h3 { margin-top: 0; color: #34495e; margin-bottom: 15px; }

.table-responsive { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.data-table { width: 100%; border-collapse: collapse; min-width: 600px; }
.data-table th, .data-table td { padding: 12px; border-bottom: 1px solid #f0f0f0; text-align: left; font-size: 14px; white-space: nowrap; }
.data-table th { background: #f5f6fa; color: #7f8c8d; font-weight: bold; }
.empty { text-align: center; color: #7f8c8d; padding: 20px !important; }
.money { font-weight: bold; color: #27ae60; }

.drilldown-link { cursor: pointer; text-decoration: underline dashed #bdc3c7; color: inherit; transition: 0.2s; }
.drilldown-link:hover { color: #3498db; text-decoration: underline solid #3498db; }

.b24-id-badge { background: #e3f2fd; color: #2980b9; padding: 4px 10px; border-radius: 4px; font-size: 13px; font-weight: bold; border: 1px solid #bbdefb; display: inline-block; }
.data-issues-banner { background: #fdedec; border: 1px solid #e74c3c; padding: 15px 20px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 5px rgba(231,76,60,0.1); }
.btn-issues { background: #e74c3c; color: white; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; }
.btn-issues:hover { background: #c0392b; }

.issue-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.b24-id-badge-small { background: #f5f6fa; color: #2c3e50; padding: 4px 8px; border-radius: 4px; font-size: 12px; border: 1px solid #ddd; display: inline-block; }
.issue-desc { font-size: 13px; color: #7f8c8d; margin-bottom: 5px; margin-top: -10px;}

.autocomplete-wrapper { position: relative; }
.dropdown-list { position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ddd; border-radius: 6px; max-height: 250px; overflow-y: auto; z-index: 1000; box-shadow: 0 8px 16px rgba(0,0,0,0.1); margin-top: 5px; }
.dropdown-item { padding: 12px; cursor: pointer; border-bottom: 1px solid #f5f6fa; font-size: 14px; }
.dropdown-item:last-child { border-bottom: none; }
.dropdown-item:hover { background-color: #f0f4f8; }
</style>