<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

const API = 'http://localhost:3000/api';

const users = ref<any[]>([]);
const selectedManager = ref('');
const selectedMonth = ref(new Date().toISOString().slice(0, 7));

const plan = ref({ working_days: 21, calls_norm: 0, leads_norm: 0 });
const fact = ref({ calls: 0, conversations: 0, leads: 0, deals: 0, revenue: 0, days_active: 0 });

const loadingPlan = ref(false);
const loadingFact = ref(false);
const saving = ref(false);
const saveOk = ref(false);

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const monthLabel = computed(() => {
  const [y, m] = selectedMonth.value.split('-').map(Number);
  if (!y || !m) return selectedMonth.value;
  return `${MONTHS[m - 1]} ${y}`;
});

const dailyCallsNorm = computed(() =>
  plan.value.working_days > 0 ? Math.round(plan.value.calls_norm / plan.value.working_days) : 0);
const dailyLeadsNorm = computed(() =>
  plan.value.working_days > 0 ? Math.round(plan.value.leads_norm / plan.value.working_days) : 0);

const callsProgress = computed(() =>
  plan.value.calls_norm > 0 ? Math.round((fact.value.calls / plan.value.calls_norm) * 100) : 0);
const leadsProgress = computed(() =>
  plan.value.leads_norm > 0 ? Math.round((fact.value.leads / plan.value.leads_norm) * 100) : 0);

const callsLeft = computed(() => Math.max(0, plan.value.calls_norm - fact.value.calls));
const leadsLeft = computed(() => Math.max(0, plan.value.leads_norm - fact.value.leads));
const connectionRate = computed(() =>
  fact.value.calls > 0 ? Math.round((fact.value.conversations / fact.value.calls) * 100) : 0);

const hasPlan = computed(() => plan.value.calls_norm > 0 || plan.value.leads_norm > 0);

const loadUsers = async () => {
  try {
    const res = await fetch(`${API}/users`);
    if (res.ok) users.value = await res.json();
  } catch (e) { console.error('Ошибка загрузки сотрудников', e); }
};

const monthRange = () => {
  const [y, m] = selectedMonth.value.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: `${selectedMonth.value}-01`,
    end: `${selectedMonth.value}-${String(lastDay).padStart(2, '0')}`
  };
};

const loadPlan = async () => {
  if (!selectedManager.value || !selectedMonth.value) return;
  loadingPlan.value = true;
  try {
    const res = await fetch(`${API}/plans?manager_id=${selectedManager.value}&month=${selectedMonth.value}`);
    if (res.ok) {
      const data = await res.json();
      plan.value.working_days = data.working_days ?? 21;
      plan.value.calls_norm = data.calls_norm ?? 0;
      plan.value.leads_norm = data.leads_norm ?? 0;
    }
  } catch (e) { console.error('Ошибка загрузки плана', e); }
  finally { loadingPlan.value = false; }
};

const loadFact = async () => {
  if (!selectedManager.value || !selectedMonth.value) return;
  loadingFact.value = true;
  try {
    const { start, end } = monthRange();
    const res = await fetch(`${API}/dashboard?manager_id=${selectedManager.value}&startDate=${start}&endDate=${end}`);
    if (res.ok) {
      const rows = await res.json();
      fact.value = {
        calls: rows.reduce((s: number, d: any) => s + (d.total_outbound || 0), 0),
        conversations: rows.reduce((s: number, d: any) => s + (d.valid_conversations || 0), 0),
        leads: rows.reduce((s: number, d: any) => s + (d.quality_leads || 0), 0),
        deals: rows.reduce((s: number, d: any) => s + (d.paid_deals || 0), 0),
        revenue: rows.reduce((s: number, d: any) => s + (d.amount_sum || 0), 0),
        days_active: rows.length
      };
    }
  } catch (e) { console.error('Ошибка загрузки факта', e); }
  finally { loadingFact.value = false; }
};

const loadAll = () => { loadPlan(); loadFact(); };

const shiftMonth = (delta: number) => {
  const [y, m] = selectedMonth.value.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  selectedMonth.value = d.toISOString().slice(0, 7);
  loadAll();
};

const goToCurrentMonth = () => {
  selectedMonth.value = new Date().toISOString().slice(0, 7);
  loadAll();
};

const savePlan = async () => {
  if (!selectedManager.value || !selectedMonth.value) return;
  saving.value = true;
  saveOk.value = false;
  try {
    const res = await fetch(`${API}/plans`, {
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
    const data = await res.json();
    if (res.ok) {
      saveOk.value = true;
      setTimeout(() => { saveOk.value = false; }, 3000);
    } else {
      alert(data.error || 'Ошибка сохранения');
    }
  } catch {
    alert('Нет связи с сервером');
  } finally {
    saving.value = false;
  }
};

const ensureFontAwesome = () => {
  if (document.getElementById('fa-cdn')) return;
  const link = document.createElement('link');
  link.id = 'fa-cdn';
  link.rel = 'stylesheet';
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
  document.head.appendChild(link);
};

onMounted(() => {
  ensureFontAwesome();
  loadUsers();
});
</script>

<template>
  <div class="plans-manager">
    <div class="page-header">
      <h2><i class="fas fa-calendar-days"></i> Планы и нормативы</h2>
      <p>Задайте рабочие дни и нормы на месяц. Система считает дневную норму и показывает фактическое выполнение.</p>
    </div>

    <section class="pm-card selector-card">
      <div class="selector-grid">
        <label class="field">
          <span class="field-label">Менеджер</span>
          <div class="field-input">
            <i class="fas fa-user"></i>
            <select v-model="selectedManager" @change="loadAll">
              <option value="" disabled>Выберите сотрудника</option>
              <option v-for="u in users" :key="u.bitrix_id || u.id" :value="u.bitrix_id || u.id">
                {{ u.login }}<template v-if="u.department_name"> — {{ u.department_name }}</template>
              </option>
            </select>
          </div>
        </label>

        <label class="field">
          <span class="field-label">Месяц</span>
          <div class="month-picker">
            <button type="button" class="month-arrow" @click="shiftMonth(-1)" title="Предыдущий месяц">
              <i class="fas fa-chevron-left"></i>
            </button>
            <input type="month" v-model="selectedMonth" @change="loadAll" class="month-input" />
            <button type="button" class="month-arrow" @click="shiftMonth(1)" title="Следующий месяц">
              <i class="fas fa-chevron-right"></i>
            </button>
            <button type="button" class="month-today" @click="goToCurrentMonth">
              <i class="fas fa-calendar-check"></i> Текущий
            </button>
          </div>
        </label>
      </div>
    </section>

    <div v-if="!selectedManager" class="empty-state">
      <i class="fas fa-hand-pointer"></i>
      Выберите сотрудника, чтобы настроить нормативы и увидеть выполнение плана.
    </div>

    <template v-else>
      <div class="pm-grid">
        <!-- Нормативы -->
        <section class="pm-card">
          <div class="card-head">
            <h3><i class="fas fa-sliders"></i> Нормативы на {{ monthLabel }}</h3>
            <span v-if="loadingPlan" class="loading-chip"><i class="fas fa-spinner fa-spin"></i> Загрузка…</span>
          </div>

          <div class="norm-grid">
            <label class="field">
              <span class="field-label">Рабочих дней в месяце</span>
              <div class="field-input">
                <i class="fas fa-calendar"></i>
                <input type="number" v-model.number="plan.working_days" min="1" max="31" />
              </div>
              <span class="field-hint">По производственному календарю</span>
            </label>

            <label class="field">
              <span class="field-label">План звонков (за месяц)</span>
              <div class="field-input">
                <i class="fas fa-phone"></i>
                <input type="number" v-model.number="plan.calls_norm" min="0" />
              </div>
            </label>

            <label class="field">
              <span class="field-label">План кач. лидов (за месяц)</span>
              <div class="field-input">
                <i class="fas fa-gem"></i>
                <input type="number" v-model.number="plan.leads_norm" min="0" />
              </div>
            </label>
          </div>

          <div class="daily-norms">
            <div class="daily-chip">
              <i class="fas fa-phone"></i>
              <span>Дневная норма звонков:</span>
              <strong>{{ dailyCallsNorm }} шт</strong>
            </div>
            <div class="daily-chip">
              <i class="fas fa-gem"></i>
              <span>Дневная норма лидов:</span>
              <strong>{{ dailyLeadsNorm }} шт</strong>
            </div>
          </div>

          <div class="save-row">
            <button class="save-btn" @click="savePlan" :disabled="saving || !hasPlan && plan.working_days <= 0">
              <i v-if="!saving" class="fas fa-floppy-disk"></i>
              <i v-else class="fas fa-spinner fa-spin"></i>
              {{ saving ? 'Сохранение…' : 'Сохранить план' }}
            </button>
            <span v-if="saveOk" class="save-ok"><i class="fas fa-circle-check"></i> План сохранён</span>
          </div>
        </section>

        <section class="pm-card">
          <div class="card-head">
            <h3><i class="fas fa-chart-line"></i> Выполнение за {{ monthLabel }}</h3>
            <span v-if="loadingFact" class="loading-chip"><i class="fas fa-spinner fa-spin"></i> Загрузка…</span>
          </div>

          <div v-if="!hasPlan" class="plan-empty">
            <i class="fas fa-circle-info"></i>
            План на этот месяц ещё не задан. Укажите нормы слева и сохраните.
          </div>

          <template v-else>
            <div class="progress-block">
              <div class="progress-head">
                <span><i class="fas fa-phone"></i> Звонки (наборы)</span>
                <strong>{{ fact.calls.toLocaleString('ru-RU') }} / {{ plan.calls_norm.toLocaleString('ru-RU') }}</strong>
              </div>
              <div class="progress-track">
                <div class="progress-fill" :class="{ done: callsProgress >= 100 }"
                     :style="{ width: Math.min(callsProgress, 100) + '%' }"></div>
              </div>
              <div class="progress-meta">
                <span>{{ callsProgress }}% месячной нормы</span>
                <span v-if="callsLeft > 0">осталось <strong>{{ callsLeft.toLocaleString('ru-RU') }}</strong></span>
                <span v-else class="done-text"><i class="fas fa-circle-check"></i> выполнено</span>
              </div>
            </div>

            <div class="progress-block">
              <div class="progress-head">
                <span><i class="fas fa-gem"></i> Качественные лиды</span>
                <strong>{{ fact.leads.toLocaleString('ru-RU') }} / {{ plan.leads_norm.toLocaleString('ru-RU') }}</strong>
              </div>
              <div class="progress-track">
                <div class="progress-fill" :class="{ done: leadsProgress >= 100 }"
                     :style="{ width: Math.min(leadsProgress, 100) + '%' }"></div>
              </div>
              <div class="progress-meta">
                <span>{{ leadsProgress }}% месячной нормы</span>
                <span v-if="leadsLeft > 0">осталось <strong>{{ leadsLeft.toLocaleString('ru-RU') }}</strong></span>
                <span v-else class="done-text"><i class="fas fa-circle-check"></i> выполнено</span>
              </div>
            </div>
          </template>

          <div class="fact-extra">
            <div class="fact-item">
              <span class="fact-label">Разговоры</span>
              <span class="fact-value">{{ fact.conversations.toLocaleString('ru-RU') }}</span>
              <span class="fact-sub">% дозвона: {{ connectionRate }}%</span>
            </div>
            <div class="fact-item">
              <span class="fact-label">Оплаты</span>
              <span class="fact-value">{{ fact.deals.toLocaleString('ru-RU') }}</span>
              <span class="fact-sub">дней с активностью: {{ fact.days_active }}</span>
            </div>
            <div class="fact-item">
              <span class="fact-label">Выручка</span>
              <span class="fact-value money">{{ fact.revenue.toLocaleString('ru-RU') }} ₽</span>
              <span class="fact-sub">за выбранный месяц</span>
            </div>
          </div>
        </section>
      </div>

      <p class="pm-note">
        Дневная норма = месячный план ÷ рабочие дни. Факт считается по агрегированной статистике за выбранный месяц.
        Порог отставания не согласован, поэтому прогресс показывается числом и не окрашивается в «красный» автоматически.
      </p>
    </template>
  </div>
</template>

<style scoped>
.plans-manager { width: 100%; font-family: var(--font, Arial, sans-serif); max-width: 1000px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }

.page-header h2 { display: flex; align-items: center; gap: 12px; margin: 0 0 6px; font-size: 24px; color: var(--text); }
.page-header h2 i { color: var(--accent); }
.page-header p { margin: 0; color: var(--text-muted); font-size: 14px; line-height: 1.5; }

.pm-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius, 16px);
  padding: 22px 24px; box-shadow: var(--shadow-card); box-sizing: border-box;
}
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.card-head h3 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 16px; color: var(--text); }
.card-head h3 i { color: var(--accent); }
.loading-chip { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-muted); }

.selector-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 700px) { .selector-grid { grid-template-columns: 1fr; } }

.field { display: flex; flex-direction: column; gap: 7px; }
.field-label { font-size: 13px; font-weight: 600; color: var(--text-muted); }
.field-input {
  display: flex; align-items: center; gap: 11px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 12px; padding: 0 14px; height: 48px;
  transition: border-color .18s, box-shadow .18s;
}
.field-input:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(76,111,255,.15); }
.field-input > i { color: var(--text-muted); font-size: 15px; width: 18px; text-align: center; }
.field-input input, .field-input select {
  flex: 1; border: none; outline: none; background: transparent; font-size: 15px;
  color: var(--text); font-family: inherit; min-width: 0; padding: 0; width: 100%;
}
.field-hint { font-size: 12px; color: var(--text-muted); }

/* Выбор месяца */
.month-picker { display: flex; align-items: center; gap: 8px; }
.month-input {
  flex: 1; height: 48px; padding: 0 14px; border: 1px solid var(--border); border-radius: 12px;
  font-size: 15px; color: var(--text); font-family: inherit; background: var(--surface); outline: none;
  min-width: 0;
}
.month-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(76,111,255,.15); }
.month-arrow {
  width: 44px; height: 48px; flex-shrink: 0; border: 1px solid var(--border); background: var(--surface);
  border-radius: 12px; cursor: pointer; color: var(--text-muted); font-size: 14px; transition: all .18s;
}
.month-arrow:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.month-today {
  height: 48px; padding: 0 16px; border: none; border-radius: 12px; cursor: pointer; font-weight: 600;
  background: linear-gradient(135deg, var(--accent), var(--accent-hover)); color: #fff;
  box-shadow: 0 4px 12px rgba(76,111,255,.3); white-space: nowrap; display: inline-flex; align-items: center; gap: 8px;
}
.month-today:hover { transform: translateY(-1px); }

.pm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
@media (max-width: 900px) { .pm-grid { grid-template-columns: 1fr; } }

.norm-grid { display: flex; flex-direction: column; gap: 16px; }

.daily-norms { display: flex; gap: 12px; flex-wrap: wrap; margin: 18px 0; }
.daily-chip {
  display: inline-flex; align-items: center; gap: 8px; background: var(--accent-soft);
  border: 1px solid #dfe5ff; border-radius: 10px; padding: 9px 14px; font-size: 13px; color: var(--text);
}
.daily-chip i { color: var(--accent); }
.daily-chip strong { color: var(--accent); font-size: 15px; }

.save-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.save-btn {
  display: inline-flex; align-items: center; gap: 10px;
  background: linear-gradient(135deg, var(--success), #0d9460); color: #fff;
  border: none; border-radius: 12px; padding: 13px 24px; font-size: 15px; font-weight: 700;
  cursor: pointer; font-family: inherit; box-shadow: 0 6px 18px rgba(15,169,104,.3);
  transition: transform .18s, box-shadow .18s;
}
.save-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 9px 24px rgba(15,169,104,.35); }
.save-btn:disabled { background: #b9c0cc; box-shadow: none; cursor: not-allowed; }
.save-ok { display: inline-flex; align-items: center; gap: 7px; color: var(--success); font-weight: 600; font-size: 14px; }

.plan-empty {
  display: flex; align-items: center; gap: 10px; background: #f4f6fb; border: 1px dashed var(--border);
  border-radius: 12px; padding: 16px; color: var(--text-muted); font-size: 14px; margin-bottom: 16px;
}
.plan-empty i { color: var(--accent); }

.progress-block { margin-bottom: 20px; }
.progress-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 14px; color: var(--text); }
.progress-head span { display: inline-flex; align-items: center; gap: 8px; }
.progress-head i { color: var(--accent); }
.progress-track { width: 100%; height: 14px; background: #e6eaf2; border-radius: 8px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--accent), #7b93ff); border-radius: 8px; transition: width .4s ease; }
.progress-fill.done { background: linear-gradient(90deg, #12b376, #34d399); }
.progress-meta { display: flex; justify-content: space-between; margin-top: 7px; font-size: 12px; color: var(--text-muted); }
.done-text { color: var(--success); font-weight: 700; display: inline-flex; align-items: center; gap: 5px; }

.fact-extra { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 8px; padding-top: 16px; border-top: 1px solid var(--border); }
@media (max-width: 560px) { .fact-extra { grid-template-columns: 1fr; } }
.fact-item { display: flex; flex-direction: column; gap: 3px; background: #f8f9fc; border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.fact-label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); font-weight: 700; }
.fact-value { font-size: 18px; font-weight: 700; color: var(--text); }
.fact-value.money { color: var(--success); }
.fact-sub { font-size: 11px; color: var(--text-muted); }

.empty-state {
  display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;
  background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius, 16px);
  padding: 44px 24px; color: var(--text-muted); font-size: 15px;
}
.empty-state i { font-size: 26px; color: var(--accent); }
.pm-note { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.6; }
</style>