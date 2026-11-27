<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';

const props = defineProps<{ managerId: string | number }>();
const API = 'http://localhost:3000/api';

const stats = ref<any[]>([]);
const basesStats = ref<any[]>([]);
const baseCallsMap = ref<Record<number, { calls: number; conversations: number }>>({});
const rules = ref<any[]>([]);
const refusals = ref<any[]>([]);
const remainder = ref<any>({});
const workLists = ref<any>({ retries: [], returns: [], new_in_work: [] });
const plan = ref<any>({ working_days: 0, calls_norm: 0, leads_norm: 0 });
const managerInfo = ref<any>({ qualification: 'обычный', threshold: 44, qualification_missing: false });
const syncStatus = ref<any>(null);

const loading = ref(false);
const error = ref('');
const activeListTab = ref<'retries' | 'returns' | 'new_in_work'>('retries');
const filters = reactive({ period: 'today' });
const portalUrl = ref(localStorage.getItem('b24_portal_url') || '');
const showSettings = ref(false);

const showDrilldown = ref(false);
const drilldownLoading = ref(false);
const drilldownTitle = ref('');
const drilldownRows = ref<any[]>([]);
const showProducts = ref(false);
const productsLoading = ref(false);
const productDeal = ref<any>(null);
const productRows = ref<any[]>([]);
const showReason = ref(false);
const reasonLoading = ref(false);
const reasonName = ref('');
const reasonRows = ref<any[]>([]);

const vocab: Record<string, string> = {
    quality_leads: 'Кач. лиды', paid_deals: 'Оплаты', transfers: 'Передачи',
    unique_leads: 'Взято в работу', total_calls: 'Все наборы', valid_conversations: 'Разговоры'
};

const money = (v: any) => (Number(v) || 0).toLocaleString('ru-RU');
const numOrNull = (v: any): number | null => (v === null || v === undefined ? null : Number(v));
const translateFilter = (v: string) =>
    ({ main: 'Основной', cross: 'Кросс', primary: 'Первичный', return: 'Возврат' } as any)[v] || 'Любой';
const parseExcluded = (s: string) => { try { return JSON.parse(s).join(', '); } catch { return 'IMPORT'; } };
const formatDate = (s: string) => !s ? '—' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(s));
const formatDateTime = (s: string) => {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
};
const formatTs = (ts: string | null) => {
    if (!ts) return 'ещё не выполнялась';
    const d = new Date(String(ts).replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? String(ts) : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
};
const baseLabel = (v: any) => {
    if (!v) return 'Без базы';
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.join(', ') : String(v); } catch { return String(v); }
};
const dealsSyncTs = computed(() => syncStatus.value?.items?.find((i: any) => i.entity === 'deals')?.last_success_ts || null);

const savePortal = () => {
    portalUrl.value = portalUrl.value.trim().replace(/\/+$/, '');
    localStorage.setItem('b24_portal_url', portalUrl.value);
    showSettings.value = false;
};
const b24Link = (type: string, id: any): string => {
    const base = portalUrl.value.trim().replace(/\/+$/, '');
    if (!base) return '';
    return `${base}/crm/${type === 'deal' ? 'deal' : 'lead'}/details/${id}/`;
};

const getDatesForPeriod = (period: string) => {
    const today = new Date();
    const end = today.toISOString().split('T')[0];
    let start = end;
    if (period === 'week') { const d = new Date(); d.setDate(d.getDate() - 7); start = d.toISOString().split('T')[0]; }
    else if (period === 'month') { const d = new Date(); d.setMonth(d.getMonth() - 1); start = d.toISOString().split('T')[0]; }
    return { start, end };
};

const aggregatedStats = computed(() => ({
    calls: stats.value.reduce((s, d) => s + (d.total_outbound || 0), 0),
    conversations: stats.value.reduce((s, d) => s + (d.valid_conversations || 0), 0),
    unique: stats.value.reduce((s, d) => s + (d.unique_leads || 0), 0),
    leads: stats.value.reduce((s, d) => s + (d.quality_leads || 0), 0),
    transfers: stats.value.reduce((s, d) => s + (d.transfers || 0), 0),
    deals: stats.value.reduce((s, d) => s + (d.paid_deals || 0), 0),
    revenue: stats.value.reduce((s, d) => s + (d.amount_sum || 0), 0)
}));
const connectionRate = computed(() => aggregatedStats.value.calls ? Math.round((aggregatedStats.value.conversations / aggregatedStats.value.calls) * 100) : 0);
const qualityRate = computed(() => aggregatedStats.value.unique ? Math.round((aggregatedStats.value.leads / aggregatedStats.value.unique) * 100) : 0);
const dailyCallsNorm = computed(() => plan.value.working_days ? Math.round(plan.value.calls_norm / plan.value.working_days) : 0);
const dailyLeadsNorm = computed(() => plan.value.working_days ? Math.round(plan.value.leads_norm / plan.value.working_days) : 0);
const callsProgress = computed(() => dailyCallsNorm.value ? Math.round((aggregatedStats.value.calls / dailyCallsNorm.value) * 100) : 0);
const leadsProgress = computed(() => dailyLeadsNorm.value ? Math.round((aggregatedStats.value.leads / dailyLeadsNorm.value) * 100) : 0);
const callsDeviation = computed(() => aggregatedStats.value.calls - dailyCallsNorm.value);
const leadsDeviation = computed(() => aggregatedStats.value.leads - dailyLeadsNorm.value);
const currentWorkList = computed(() => workLists.value[activeListTab.value] || []);
const totalRefusals = computed(() => refusals.value.reduce((s, r) => s + r.count, 0));
const refusalShare = (c: number) => totalRefusals.value ? Math.round((c / totalRefusals.value) * 100) : 0;
const rowsTotal = computed(() => productRows.value.reduce((s, r) => s + (r.sum || 0), 0));
const amountDiff = computed(() => productDeal.value ? Math.round(((productDeal.value.amount || 0) - rowsTotal.value) * 100) / 100 : 0);

const weakSpots = computed(() => {
    const out: string[] = [];
    const s = aggregatedStats.value;
    if (s.calls > 10 && connectionRate.value < 30) out.push(`Низкий % дозвона (${connectionRate.value}% при ${s.calls} наборах). Проверьте время звонков и качество базы.`);
    if (s.conversations > 5 && qualityRate.value < 10) out.push(`Мало качественных лидов при ${s.conversations} разговорах — стоит отработать скрипт и возражения.`);
    if (s.leads >= 3 && s.transfers === 0) out.push(`Есть ${s.leads} качественных лидов, но ни одной передачи в корп. команду.`);
    if ((remainder.value.no_answer_count || 0) > 0) out.push(`Недозвонов на повторную попытку: ${remainder.value.no_answer_count}. Список — во вкладке «Недозвоны».`);
    return out;
});

const metricValue = (rule: any, key: string, isNumerator: boolean): number | null => {
    if (key === 'total_calls') return baseCallsMap.value[rule.base_id]?.calls ?? null;
    if (key === 'valid_conversations') return baseCallsMap.value[rule.base_id]?.conversations ?? null;
    const b = basesStats.value.find(x => x.base_id === rule.base_id);
    if (!b) return null;
    if (key === 'unique_leads') {
        const total = numOrNull(b.total_leads);
        if (total === null) return null; // нет разреза — не подменяем нулём
        return Math.max(0, total - (numOrNull(b.import_leads) || 0));
    }
    if (key === 'quality_leads') return numOrNull(b.quality_leads);
    if (key === 'transfers') return numOrNull(b.transfers);
    if (key === 'paid_deals') {
        const paid = numOrNull(b.paid_deals);
        const cross = numOrNull(b.cross_deals);
        if (isNumerator && rule.product_type === 'cross') return cross;
        if (isNumerator && rule.product_type === 'main') {
            return paid === null || cross === null ? null : Math.max(0, paid - cross);
        }
        return paid;
    }
    return null;
};

const conversionCards = computed(() => rules.value.map(rule => {
    const b = basesStats.value.find(x => x.base_id === rule.base_id);
    const notes: string[] = [];
    let num = metricValue(rule, rule.numerator, true);
    let den = metricValue(rule, rule.denominator, false);

    if (rule.cycle_type === 'return') {
        num = null; den = null;
        notes.push('История возвратов и циклов не загружена — данные недоступны и не подменяются нулём.');
    }
    if (rule.product_type !== 'all' && rule.numerator !== 'paid_deals') {
        num = null;
        notes.push('Разрез «основной / кросс» определяется по товарам сделки и применим к оплатам.');
    }
    if (rule.product_type !== 'all' && (numOrNull(b?.unknown_amount) || 0) > 0) {
        notes.push(`У части сделок базы товары не загружены (${money(b.unknown_amount)} ₽) — разделение основной/кросс неполное.`);
    }
    const value = (num !== null && den !== null && den > 0) ? Math.round((num / den) * 100) : null;
    return { rule, num, den, value, notes };
}));

const canDrill = (m: string) => ['quality_leads', 'transfers', 'paid_deals'].includes(m);
const numeratorMetric = (rule: any) =>
    rule.numerator === 'paid_deals' && rule.product_type === 'cross' ? 'cross_deals' : rule.numerator;
const denominatorHint = (rule: any) => {
    if (rule.denominator === 'unique_leads') return 'Лиды базы, взятые в работу: все лиды базы минус «Импорт / Поступило»';
    if (rule.denominator === 'total_calls') return 'Все исходящие наборы по этой базе, включая повторные';
    if (rule.denominator === 'valid_conversations') return `Разговоры по этой базе длительностью ≥ ${managerInfo.value.threshold} сек`;
    return 'Качественные лиды этой базы';
};

const loadBaseCalls = async (dateParams: string) => {
    const need = rules.value.filter(r => ['total_calls', 'valid_conversations'].includes(r.denominator));
    const ids = [...new Set(need.map(r => r.base_id))];
    await Promise.all(ids.map(async (id) => {
        try {
            const res = await fetch(`${API}/dashboard?manager_id=${props.managerId}&base_id=${id}&${dateParams}`);
            if (res.ok) {
                const rows = await res.json();
                baseCallsMap.value[id] = {
                    calls: rows.reduce((s: number, d: any) => s + (d.total_outbound || 0), 0),
                    conversations: rows.reduce((s: number, d: any) => s + (d.valid_conversations || 0), 0)
                };
            }
        } catch { /* база останется без данных — карточка покажет «Нет данных» */ }
    }));
};

const loadAll = async () => {
    if (!props.managerId) {
        error.value = 'Профиль не сопоставлен сотруднику Битрикс24 — личные метрики недоступны. Обратитесь к администратору.';
        return;
    }
    loading.value = true;
    error.value = '';
    baseCallsMap.value = {};
    const { start, end } = getDatesForPeriod(filters.period);
    const dp = `startDate=${start}&endDate=${end}`;
    const mid = props.managerId;
    const month = new Date().toISOString().slice(0, 7);
    try {
        const [rStats, rPlan, rInfo, rRem, rWork, rRules, rBases, rRef, rSync] = await Promise.all([
            fetch(`${API}/dashboard?manager_id=${mid}&${dp}`),
            fetch(`${API}/plans?manager_id=${mid}&month=${month}`),
            fetch(`${API}/users/${mid}/info`),
            fetch(`${API}/manager/${mid}/remainder`),
            fetch(`${API}/manager/${mid}/work-list`),
            fetch(`${API}/conversions`),
            fetch(`${API}/analytics/bases?manager_id=${mid}&${dp}`),
            fetch(`${API}/analytics/refusals?manager_id=${mid}&${dp}`),
            fetch(`${API}/sync-status`)
        ]);
        if (rStats.ok) stats.value = await rStats.json();
        if (rPlan.ok) plan.value = await rPlan.json();
        if (rInfo.ok) {
            const info = await rInfo.json();
            managerInfo.value = {
                qualification: info.qualification || 'обычный',
                threshold: info.threshold || (info.qualification === 'ведущий' ? 59 : 44),
                qualification_missing: !!info.qualification_missing
            };
        }
        if (rRem.ok) remainder.value = await rRem.json();
        if (rWork.ok) workLists.value = await rWork.json();
        if (rRules.ok) rules.value = await rRules.json();
        if (rBases.ok) basesStats.value = await rBases.json();
        if (rRef.ok) refusals.value = await rRef.json();
        if (rSync.ok) syncStatus.value = await rSync.json();
        await loadBaseCalls(dp);
    } catch {
        error.value = 'Не удалось подключиться к серверу';
    } finally {
        loading.value = false;
    }
};

const openDrilldown = async (metric: string, title: string, baseId: any = null) => {
    drilldownTitle.value = title;
    drilldownRows.value = [];
    showDrilldown.value = true;
    drilldownLoading.value = true;
    const { start, end } = getDatesForPeriod(filters.period);
    const params = new URLSearchParams({ startDate: start, endDate: end, metric, manager_id: String(props.managerId) });
    if (baseId) params.append('base_id', String(baseId));
    try {
        const res = await fetch(`${API}/analytics/drilldown?${params}`);
        if (res.ok) drilldownRows.value = await res.json();
    } catch (e) { console.error(e); } finally { drilldownLoading.value = false; }
};

const openProducts = async (dealId: any) => {
    showProducts.value = true;
    productsLoading.value = true;
    productDeal.value = null;
    productRows.value = [];
    try {
        const res = await fetch(`${API}/deals/${dealId}/products`);
        if (res.ok) {
            const data = await res.json();
            productDeal.value = data.deal;
            productRows.value = data.rows || [];
        }
    } catch (e) { console.error(e); } finally { productsLoading.value = false; }
};

const openReason = async (reason: any) => {
    reasonName.value = reason.reason_name;
    reasonRows.value = [];
    showReason.value = true;
    reasonLoading.value = true;
    const { start, end } = getDatesForPeriod(filters.period);
    try {
        const res = await fetch(`${API}/analytics/refusals/${reason.id}/details?startDate=${start}&endDate=${end}&manager_id=${props.managerId}`);
        if (res.ok) reasonRows.value = await res.json();
    } catch (e) { console.error(e); } finally { reasonLoading.value = false; }
};

const csvCell = (v: any): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const download = (csv: string, filename: string) => {
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

const exportDrilldown = () => {
    let csv = 'ID;Тип;Ссылка;Дата;База;Товары;Кросс;ОКВЭД;Компания;ИНН;Стадия;Сумма\n';
    drilldownRows.value.forEach(i => {
        csv += [i.b24_id, i.type === 'deal' ? 'Сделка' : 'Лид', b24Link(i.type, i.b24_id),
            formatDateTime(i.created_at), i.base_name, i.products_list, i.is_cross_sale ? 'да' : 'нет',
            i.okved, i.company_title, i.inn, i.stage, i.amount || 0].map(csvCell).join(';') + '\n';
    });
    download(csv, `Мои_карточки_${filters.period}.csv`);
};

const exportReport = () => {
    const s = aggregatedStats.value;
    let csv = `Мой отчёт\nПериод;${filters.period}\nКвалификация;${managerInfo.value.qualification}\nПорог разговора;${managerInfo.value.threshold}\n\n`;
    csv += 'ИТОГО\nНаборы;Разговоры;% дозвона;Взято в работу;Кач. лиды;Передано;Оплаты;Сумма\n';
    csv += [s.calls, s.conversations, connectionRate.value, s.unique, s.leads, s.transfers, s.deals, s.revenue].map(csvCell).join(';') + '\n\n';
    csv += 'КОНВЕРСИИ ПО БАЗАМ\nБаза;Формула;Числитель;Знаменатель;Конверсия %;Версия;Исключено\n';
    conversionCards.value.forEach(c => {
        csv += [c.rule.base_name, `${vocab[c.rule.numerator]} / ${vocab[c.rule.denominator]}`,
            c.num ?? 'нет данных', c.den ?? 'нет данных', c.value ?? 'нет данных',
            c.rule.version, parseExcluded(c.rule.excluded_statuses)].map(csvCell).join(';') + '\n';
    });
    csv += '\nОСТАТОК БАЗЫ\nИмпорт;В работе;Недозвоны;Качественные;Отказы;Всего\n';
    csv += [remainder.value.import_count || 0, remainder.value.in_progress_count || 0, remainder.value.no_answer_count || 0,
        remainder.value.quality_count || 0, remainder.value.refusal_count || 0, remainder.value.total || 0].map(csvCell).join(';') + '\n';
    csv += '\nПО ДНЯМ\nДата;Наборы;Разговоры;Взято лидов;Кач. лиды;Передано;Оплаты;Сумма\n';
    stats.value.forEach(d => {
        csv += [d.date, d.total_outbound, d.valid_conversations, d.unique_leads, d.quality_leads,
            d.transfers, d.paid_deals, d.amount_sum].map(csvCell).join(';') + '\n';
    });
    download(csv, `Мой_отчёт_${filters.period}.csv`);
};

const ensureFontAwesome = () => {
    if (document.getElementById('fa-cdn')) return;
    const link = document.createElement('link');
    link.id = 'fa-cdn';
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    document.head.appendChild(link);
};

onMounted(() => { ensureFontAwesome(); loadAll(); });
watch(() => props.managerId, loadAll);
</script>

<template>
    <div class="md">
        <div class="md-header">
            <div>
                <h2><i class="fas fa-gauge-high"></i> Мой день</h2>
                <p>Личные метрики, план, конверсии по базам и рабочие списки — без ручных отчётов</p>
            </div>
            <div class="md-actions">
                <select v-model="filters.period" @change="loadAll" class="md-select">
                    <option value="today">Сегодня</option>
                    <option value="week">Последние 7 дней</option>
                    <option value="month">Последние 30 дней</option>
                </select>
                <button @click="loadAll" class="md-icon-btn" title="Обновить"><i class="fas fa-rotate"></i></button>
                <button @click="showSettings = !showSettings" class="md-icon-btn" title="Адрес портала"><i class="fas fa-gear"></i></button>
                <button @click="exportReport" class="md-export" :disabled="loading"><i class="fas fa-file-export"></i> Экспорт</button>
            </div>
        </div>

        <div v-if="showSettings" class="md-settings">
            <label class="md-label">Адрес портала Битрикс24 для ссылок на карточки</label>
            <div class="md-settings-row">
                <input v-model="portalUrl" placeholder="https://yourcompany.bitrix24.ru" class="md-input" />
                <button @click="savePortal" class="md-save-sm">Сохранить</button>
            </div>
        </div>

        <div class="md-status">
            <span class="md-chip" :class="{ warn: managerInfo.qualification_missing }">
                <i class="fas fa-medal"></i> Квалификация: <strong>{{ managerInfo.qualification }}</strong> · порог {{ managerInfo.threshold }} сек
            </span>
            <span v-if="syncStatus" class="md-chip" :class="{ warn: syncStatus.incomplete }">
                <i class="fas fa-arrows-rotate"></i> Синхронизация: {{ formatTs(dealsSyncTs) }}
                <template v-if="syncStatus.products_pending > 0"> · товары не загружены у {{ syncStatus.products_pending }} сделок</template>
            </span>
        </div>

        <div v-if="managerInfo.qualification_missing" class="md-warn">
            Квалификация не задана — применён порог 44 сек по умолчанию. Расчёт разговоров помечен как неполный; уточните квалификацию у руководителя.
        </div>

        <div v-if="loading" class="md-empty">Загрузка данных…</div>
        <div v-else-if="error" class="md-error">{{ error }}</div>

        <div v-else class="md-content">
            <!-- KPI -->
            <div class="md-kpis">
                <div class="md-kpi">
                    <div class="kpi-t"><i class="fas fa-phone"></i> Наборы</div>
                    <div class="kpi-v">{{ aggregatedStats.calls }}</div>
                    <div class="kpi-s">исходящие, включая повторные</div>
                </div>
                <div class="md-kpi">
                    <div class="kpi-t"><i class="fas fa-comment-dots"></i> Разговоры</div>
                    <div class="kpi-v teal">{{ aggregatedStats.conversations }}</div>
                    <div class="kpi-s">% дозвона: <strong>{{ connectionRate }}%</strong> · порог {{ managerInfo.threshold }} сек</div>
                </div>
                <div class="md-kpi">
                    <div class="kpi-t"><i class="fas fa-list-check"></i> Взято в работу</div>
                    <div class="kpi-v blue">{{ aggregatedStats.unique }}</div>
                    <div class="kpi-s">уникальные лиды без «Импорт»</div>
                </div>
                <div class="md-kpi">
                    <div class="kpi-t"><i class="fas fa-gem"></i> Кач. лиды</div>
                    <div class="kpi-v blue">
                        <span class="md-link" @click="openDrilldown('quality_leads', 'Мои качественные лиды')">{{ aggregatedStats.leads }}</span>
                    </div>
                    <div class="kpi-s">конверсия из взятых: <strong>{{ qualityRate }}%</strong></div>
                </div>
                <div class="md-kpi">
                    <div class="kpi-t"><i class="fas fa-share"></i> Передано</div>
                    <div class="kpi-v purple">
                        <span class="md-link" @click="openDrilldown('transfers', 'Мои передачи')">{{ aggregatedStats.transfers }}</span>
                    </div>
                    <div class="kpi-s">в корп. команду / подключение</div>
                </div>
                <div class="md-kpi">
                    <div class="kpi-t"><i class="fas fa-credit-card"></i> Оплаты</div>
                    <div class="kpi-v green">
                        <span class="md-link" @click="openDrilldown('paid_deals', 'Мои сделки с оплатой')">{{ aggregatedStats.deals }}</span>
                    </div>
                    <div class="kpi-s">сумма: <strong>{{ money(aggregatedStats.revenue) }} ₽</strong></div>
                </div>
            </div>

            <div v-if="filters.period === 'today' && plan.working_days > 0" class="md-card">
                <h3><i class="fas fa-bullseye"></i> План на сегодня
                    <span class="md-hint">норма = месячный план ÷ рабочие дни ({{ plan.working_days }})</span>
                </h3>
                <div class="md-plans">
                    <div class="md-plan">
                        <div class="plan-head"><span><i class="fas fa-phone"></i> Наборы</span><strong>{{ aggregatedStats.calls }} / {{ dailyCallsNorm }}</strong></div>
                        <div class="md-track"><div class="md-fill" :class="{ done: callsProgress >= 100 }" :style="{ width: Math.min(callsProgress, 100) + '%' }"></div></div>
                        <div class="plan-foot">
                            <span>{{ callsProgress }}% нормы</span>
                            <span :class="callsDeviation >= 0 ? 'dev-plus' : 'dev-neutral'">
                                {{ callsDeviation >= 0 ? 'опережение +' + callsDeviation : 'осталось ' + Math.abs(callsDeviation) }}
                            </span>
                        </div>
                    </div>
                    <div class="md-plan">
                        <div class="plan-head"><span><i class="fas fa-gem"></i> Кач. лиды</span><strong>{{ aggregatedStats.leads }} / {{ dailyLeadsNorm }}</strong></div>
                        <div class="md-track"><div class="md-fill" :class="{ done: leadsProgress >= 100 }" :style="{ width: Math.min(leadsProgress, 100) + '%' }"></div></div>
                        <div class="plan-foot">
                            <span>{{ leadsProgress }}% нормы</span>
                            <span :class="leadsDeviation >= 0 ? 'dev-plus' : 'dev-neutral'">
                                {{ leadsDeviation >= 0 ? 'опережение +' + leadsDeviation : 'осталось ' + Math.abs(leadsDeviation) }}
                            </span>
                        </div>
                    </div>
                </div>
                <p class="md-note">Порог отставания не согласован — показываем числовой прогресс и отклонение без произвольной красной оценки.</p>
            </div>
            <div v-else-if="filters.period === 'today'" class="md-card md-empty-card">
                План на месяц не задан — обратитесь к руководителю, чтобы видеть дневную норму и остаток.
            </div>

            <div class="md-card">
                <h3><i class="fas fa-percent"></i> Конверсии по правилам баз
                    <span class="md-hint">числитель и знаменатель берутся из своей базы, а не из общей суммы</span>
                </h3>
                <div v-if="conversionCards.length === 0" class="md-empty">
                    Правила конверсий не настроены. Руководитель задаёт их в справочнике «Конверсии».
                </div>
                <div v-else class="md-convs">
                    <div v-for="c in conversionCards" :key="c.rule.id" class="md-conv">
                        <div class="conv-title">{{ c.rule.base_name }}</div>
                        <div v-if="c.value === null" class="conv-nodata">Нет данных для расчёта</div>
                        <div v-else class="conv-value">{{ c.value }}%</div>
                        <div class="conv-formula">{{ vocab[c.rule.numerator] }} / {{ vocab[c.rule.denominator] }} × 100%</div>
                        <div class="conv-abs">
                            <span v-if="c.num !== null && canDrill(c.rule.numerator)" class="md-link"
                                  @click="openDrilldown(numeratorMetric(c.rule), `${c.rule.base_name}: ${vocab[c.rule.numerator]}`, c.rule.base_id)">{{ c.num }}</span>
                            <span v-else>{{ c.num ?? '—' }}</span>
                            <span class="conv-slash">/</span>
                            <span :title="denominatorHint(c.rule)">{{ c.den ?? '—' }}</span>
                        </div>
                        <div class="conv-meta">
                            <span>{{ c.rule.calc_type }}</span>
                            <span>{{ translateFilter(c.rule.product_type) }} продукт</span>
                            <span>{{ translateFilter(c.rule.cycle_type) }} цикл</span>
                            <span class="conv-ver">v.{{ c.rule.version }}</span>
                        </div>
                        <div class="conv-excl">Исключено: {{ parseExcluded(c.rule.excluded_statuses) }}</div>
                        <div v-for="(n, i) in c.notes" :key="i" class="conv-note"><i class="fas fa-triangle-exclamation"></i> {{ n }}</div>
                        <div class="conv-upd">Обновлено: {{ formatTs(dealsSyncTs) }}</div>
                    </div>
                </div>
            </div>

            <div v-if="weakSpots.length > 0 && filters.period === 'today'" class="md-card md-weak">
                <h3><i class="fas fa-lightbulb"></i> Зоны роста</h3>
                <ul class="weak-list"><li v-for="(s, i) in weakSpots" :key="i">{{ s }}</li></ul>
            </div>

            <div class="md-split">
                <div class="md-card" style="flex: 1;">
                    <h3><i class="fas fa-boxes-stacked"></i> Остаток вашей базы</h3>
                    <div class="md-rem">
                        <div class="rem-row"><span>Импорт / Поступило (нетронутые):</span><strong class="blue">{{ remainder.import_count || 0 }}</strong></div>
                        <div class="rem-row"><span>Взято в работу (в процессе):</span><strong class="amber">{{ remainder.in_progress_count || 0 }}</strong></div>
                        <div class="rem-row"><span>Недозвоны на повторную попытку:</span><strong class="orange">{{ remainder.no_answer_count || 0 }}</strong></div>
                        <div class="rem-row"><span>Качественные (результат обработки):</span><strong class="green">{{ remainder.quality_count || 0 }}</strong></div>
                        <div class="rem-row"><span>Отказы / слиты:</span><strong class="red">{{ remainder.refusal_count || 0 }}</strong></div>
                        <div class="rem-row rem-total"><span>Всего закреплено за вами:</span><strong>{{ remainder.total || 0 }}</strong></div>
                    </div>
                    <p class="md-note">
                        Недозвон = по лиду были исходящие, но ни один не дотянул до порога {{ managerInfo.threshold }} сек.
                        Перечень финальных «обработанных» статусов для общего остатка согласуется.
                    </p>
                </div>

                <div class="md-card" style="flex: 1.6; border-left: 4px solid var(--warning, #f5a524);">
                    <div class="md-tabs">
                        <button @click="activeListTab = 'retries'" :class="['md-tab', { active: activeListTab === 'retries' }]">
                            Недозвоны ({{ workLists.retries?.length || 0 }})
                        </button>
                        <button @click="activeListTab = 'returns'" :class="['md-tab', { active: activeListTab === 'returns' }]">
                            Догрев / кросс ({{ workLists.returns?.length || 0 }})
                        </button>
                        <button @click="activeListTab = 'new_in_work'" :class="['md-tab', { active: activeListTab === 'new_in_work' }]">
                            Свежие в работе ({{ workLists.new_in_work?.length || 0 }})
                        </button>
                    </div>
                    <div class="md-scroll md-scroll-280">
                        <table class="md-table">
                            <thead>
                                <tr>
                                    <th>ID лида</th><th>База</th><th>Продукт</th>
                                    <th style="text-align: right;">Звонков</th><th>Последний звонок</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-if="currentWorkList.length === 0"><td colspan="5" class="md-empty">В этом списке лидов нет</td></tr>
                                <tr v-for="lead in currentWorkList" :key="lead.bitrix_lead_id">
                                    <td>
                                        <a v-if="b24Link('lead', lead.bitrix_lead_id)" :href="b24Link('lead', lead.bitrix_lead_id)" target="_blank" rel="noopener" class="md-id md-id-link">#{{ lead.bitrix_lead_id }}</a>
                                        <span v-else class="md-id">#{{ lead.bitrix_lead_id }}</span>
                                    </td>
                                    <td><strong>{{ baseLabel(lead.base_name) }}</strong></td>
                                    <td class="md-muted">{{ lead.product_name || '—' }}</td>
                                    <td style="text-align: right; font-weight: bold;">{{ lead.calls_count }}</td>
                                    <td class="md-muted">{{ formatDateTime(lead.last_call_at) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p class="md-note">Списки повторной работы: возврат определяется статусом или числом попыток — точные статусы возврата согласуются.</p>
                </div>
            </div>

            <div class="md-card" style="border-left: 4px solid var(--danger, #e5484d);">
                <h3><i class="fas fa-ban"></i> Мои отказы <span class="md-hint">клик по причине — конкретные лиды</span></h3>
                <div class="md-scroll">
                    <table class="md-table md-interactive">
                        <thead><tr><th>Причина</th><th style="text-align: center;">Лидов</th><th style="text-align: center;">Доля</th></tr></thead>
                        <tbody>
                            <tr v-if="refusals.length === 0"><td colspan="3" class="md-empty">Отказов за период нет</td></tr>
                            <tr v-for="r in refusals" :key="r.id" @click="openReason(r)">
                                <td><strong>{{ r.reason_name }}</strong></td>
                                <td style="text-align: center; color: var(--danger, #e5484d); font-weight: bold;">{{ r.count }}</td>
                                <td style="text-align: center;" class="md-muted">{{ refusalShare(r.count) }}%</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="md-card">
                <h3><i class="fas fa-calendar-days"></i> Динамика по дням</h3>
                <div v-if="stats.length === 0" class="md-empty">Активности за выбранный период нет</div>
                <div v-else class="md-scroll">
                    <table class="md-table">
                        <thead>
                            <tr>
                                <th>Дата</th><th>Наборы</th><th>Разговоры (≥{{ managerInfo.threshold }}с)</th>
                                <th>Взято лидов</th><th>Кач. лиды</th><th>Передано</th><th>Оплаты</th>
                                <th style="text-align: right;">Сумма</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="day in stats" :key="day.date">
                                <td><strong>{{ formatDate(day.date) }}</strong></td>
                                <td>{{ day.total_outbound }}</td>
                                <td class="teal" style="font-weight: bold;">{{ day.valid_conversations }}</td>
                                <td>{{ day.unique_leads }}</td>
                                <td class="blue" style="font-weight: bold;">{{ day.quality_leads }}</td>
                                <td class="purple" style="font-weight: bold;">{{ day.transfers }}</td>
                                <td class="green">{{ day.paid_deals }}</td>
                                <td style="text-align: right; font-weight: bold;">{{ money(day.amount_sum) }} ₽</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div v-if="showDrilldown" class="md-overlay" @click.self="showDrilldown = false">
            <div class="md-modal">
                <div class="md-modal-head">
                    <h3>Детализация: <span class="blue">{{ drilldownTitle }}</span></h3>
                    <button class="md-close" @click="showDrilldown = false"><i class="fas fa-xmark"></i></button>
                </div>
                <div class="md-modal-body">
                    <div v-if="drilldownLoading" class="md-empty">Поиск в локальной базе…</div>
                    <template v-else>
                        <div class="md-modal-tools">
                            <span class="md-muted">Найдено: <strong>{{ drilldownRows.length }}</strong> (до 200)</span>
                            <button @click="exportDrilldown" class="md-export-sm" :disabled="drilldownRows.length === 0"><i class="fas fa-file-export"></i> CSV</button>
                        </div>
                        <div class="md-scroll">
                            <table class="md-table">
                                <thead>
                                    <tr>
                                        <th>ID</th><th>Дата</th><th>База</th><th>Товары</th>
                                        <th>ОКВЭД</th><th>Компания / ИНН</th><th>Стадия</th>
                                        <th style="text-align: right;">Сумма</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-if="drilldownRows.length === 0"><td colspan="8" class="md-empty">Карточки не найдены</td></tr>
                                    <tr v-for="item in drilldownRows" :key="item.type + '-' + item.b24_id">
                                        <td>
                                            <a v-if="b24Link(item.type, item.b24_id)" :href="b24Link(item.type, item.b24_id)" target="_blank" rel="noopener" class="md-id md-id-link">
                                                {{ item.type === 'deal' ? 'Сделка' : 'Лид' }} #{{ item.b24_id }}
                                            </a>
                                            <span v-else class="md-id">{{ item.type === 'deal' ? 'Сделка' : 'Лид' }} #{{ item.b24_id }}</span>
                                        </td>
                                        <td>{{ formatDateTime(item.created_at) }}</td>
                                        <td>{{ baseLabel(item.base_name) }}</td>
                                        <td class="md-goods">
                                            <span v-if="item.type === 'deal'" class="md-link" :title="item.products_list" @click="openProducts(item.b24_id)">{{ item.products_list || '—' }}</span>
                                            <span v-else :title="item.products_list">{{ item.products_list || '—' }}</span>
                                            <span v-if="item.is_cross_sale" class="md-cross">кросс</span>
                                        </td>
                                        <td><span v-if="item.okved" class="md-okved">{{ item.okved }}</span><span v-else class="md-muted">—</span></td>
                                        <td class="md-company">
                                            <div class="company-name">{{ item.company_title || '—' }}</div>
                                            <div class="md-muted" style="font-size: 11px;">{{ item.inn || 'ИНН не указан' }}</div>
                                        </td>
                                        <td>{{ item.stage || '—' }}</td>
                                        <td style="text-align: right; font-weight: bold;" class="green">{{ item.amount ? money(item.amount) + ' ₽' : '—' }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </template>
                </div>
            </div>
        </div>

        <div v-if="showProducts" class="md-overlay md-overlay-top" @click.self="showProducts = false">
            <div class="md-modal" style="max-width: 900px;">
                <div class="md-modal-head">
                    <h3>Товары сделки <span class="blue">#{{ productDeal?.bitrix_deal_id }}</span></h3>
                    <button class="md-close" @click="showProducts = false"><i class="fas fa-xmark"></i></button>
                </div>
                <div class="md-modal-body">
                    <div v-if="productsLoading" class="md-empty">Загрузка товарных позиций…</div>
                    <template v-else>
                        <div class="md-deal-info">
                            <div><span class="md-muted">Компания:</span> <strong>{{ productDeal?.company_title || '—' }}</strong></div>
                            <div><span class="md-muted">ИНН:</span> {{ productDeal?.inn || '—' }}</div>
                            <div><span class="md-muted">ОКВЭД:</span> {{ productDeal?.okved || 'не указан' }}</div>
                            <div><span class="md-muted">База:</span> {{ productDeal?.base_name || 'Без базы' }}</div>
                            <div><span class="md-muted">Осн. продукт базы:</span> {{ productDeal?.main_product_name || 'не назначен' }}</div>
                            <div><span class="md-muted">Сумма сделки:</span> <strong class="green">{{ money(productDeal?.amount) }} ₽</strong></div>
                        </div>
                        <div class="md-scroll">
                            <table class="md-table">
                                <thead>
                                    <tr>
                                        <th>Товар</th><th>Группа</th>
                                        <th style="text-align: right;">Кол-во</th>
                                        <th style="text-align: right;">Цена</th>
                                        <th style="text-align: right;">Сумма</th>
                                        <th style="text-align: center;">Тип</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-if="productRows.length === 0"><td colspan="6" class="md-empty">Позиции не загружены</td></tr>
                                    <tr v-for="(r, i) in productRows" :key="r.bitrix_row_id || i">
                                        <td><strong>{{ r.product_name }}</strong></td>
                                        <td class="md-muted">{{ r.product_group || '—' }}</td>
                                        <td style="text-align: right;">{{ r.quantity }}</td>
                                        <td style="text-align: right;">{{ money(r.price) }}</td>
                                        <td style="text-align: right; font-weight: bold;">{{ money(r.sum) }} {{ r.currency || 'RUB' }}</td>
                                        <td style="text-align: center;">
                                            <span v-if="r.is_cross_sale" class="md-cross">кросс</span>
                                            <span v-else class="md-main">основной</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div class="md-totals">
                            <span>Сумма строк: <strong>{{ money(rowsTotal) }} ₽</strong></span>
                            <span v-if="Math.abs(amountDiff) > 1" class="red">Расхождение с суммой сделки: {{ money(amountDiff) }} ₽</span>
                            <span v-else class="green">Суммы сходятся</span>
                        </div>
                    </template>
                </div>
            </div>
        </div>

        <div v-if="showReason" class="md-overlay" @click.self="showReason = false">
            <div class="md-modal" style="max-width: 900px;">
                <div class="md-modal-head">
                    <h3>Причина: <span class="red">{{ reasonName }}</span></h3>
                    <button class="md-close" @click="showReason = false"><i class="fas fa-xmark"></i></button>
                </div>
                <div class="md-modal-body">
                    <div v-if="reasonLoading" class="md-empty">Загрузка лидов…</div>
                    <div v-else class="md-scroll">
                        <table class="md-table">
                            <thead><tr><th>ID</th><th>Дата</th><th>База</th><th>Продукт</th><th>ОКВЭД</th><th>Статус</th></tr></thead>
                            <tbody>
                                <tr v-if="reasonRows.length === 0"><td colspan="6" class="md-empty">Лиды не найдены</td></tr>
                                <tr v-for="l in reasonRows" :key="l.bitrix_lead_id">
                                    <td>
                                        <a v-if="b24Link('lead', l.bitrix_lead_id)" :href="b24Link('lead', l.bitrix_lead_id)" target="_blank" rel="noopener" class="md-id md-id-link">#{{ l.bitrix_lead_id }}</a>
                                        <span v-else class="md-id">#{{ l.bitrix_lead_id }}</span>
                                    </td>
                                    <td>{{ formatDateTime(l.created_at) }}</td>
                                    <td>{{ baseLabel(l.base_name) }}</td>
                                    <td class="md-muted">{{ l.product_name || '—' }}</td>
                                    <td><span v-if="l.okved" class="md-okved">{{ l.okved }}</span><span v-else class="md-muted">—</span></td>
                                    <td class="md-muted">{{ l.status_id }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.md { width: 100%; font-family: var(--font, Arial, sans-serif); }
.md-header { display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; border-bottom: 2px solid #f0f2f8; padding-bottom: 15px; margin-bottom: 15px; }
.md-header h2 { display: flex; align-items: center; gap: 11px; margin: 0 0 5px; font-size: 24px; color: var(--text, #182338); }
.md-header h2 i { color: var(--accent, #4c6fff); }
.md-header p { margin: 0; color: var(--text-muted, #68758c); font-size: 13px; }
.md-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.md-select, .md-input { padding: 9px 12px; border: 1px solid var(--border, #e4e9f2); border-radius: 10px; outline: none; background: var(--surface, #fff); color: var(--text, #182338); font-size: 13px; font-family: inherit; }
.md-input { flex: 1; min-width: 240px; }
.md-select:focus, .md-input:focus { border-color: var(--accent, #4c6fff); box-shadow: 0 0 0 3px rgba(76,111,255,.15); }
.md-icon-btn { background: #f4f6fb; border: 1px solid var(--border, #e4e9f2); padding: 9px 12px; border-radius: 10px; cursor: pointer; color: var(--text-muted, #68758c); }
.md-icon-btn:hover { color: var(--accent, #4c6fff); border-color: var(--accent, #4c6fff); }
.md-export { display: inline-flex; align-items: center; gap: 8px; padding: 9px 15px; background: linear-gradient(135deg, var(--success, #0fa968), #0d9460); color: #fff; border: none; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 13px; font-family: inherit; }
.md-export:disabled { background: #b9c0cc; cursor: not-allowed; }
.md-export-sm { padding: 6px 12px; background: var(--success, #0fa968); color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 12px; }
.md-export-sm:disabled { background: #b9c0cc; }
.md-settings { background: var(--surface, #fff); border: 1px solid var(--border, #e4e9f2); border-left: 4px solid var(--accent, #4c6fff); border-radius: 12px; padding: 15px 20px; margin-bottom: 15px; }
.md-label { display: block; font-size: 11px; font-weight: 700; color: var(--text-muted, #68758c); text-transform: uppercase; margin-bottom: 8px; }
.md-settings-row { display: flex; gap: 10px; flex-wrap: wrap; }
.md-save-sm { background: var(--accent, #4c6fff); color: #fff; border: none; padding: 9px 18px; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 13px; }
.md-status { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 15px; }
.md-chip { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; padding: 7px 12px; border-radius: 8px; background: #f8f9fc; border: 1px solid var(--border, #e4e9f2); color: var(--text, #182338); }
.md-chip.warn { background: #fff8ec; border-color: #f7dcae; color: #c05621; }
.md-warn { background: #fff8ec; border: 1px solid #f7dcae; color: #c05621; padding: 12px 16px; border-radius: 10px; font-size: 13px; margin-bottom: 15px; line-height: 1.5; }
.md-error { background: #fdecec; border: 1px solid #f8c9cb; color: var(--danger, #e5484d); padding: 14px 18px; border-radius: 10px; font-size: 14px; }
.md-content { display: flex; flex-direction: column; gap: 22px; }
.md-kpis { display: flex; gap: 15px; flex-wrap: wrap; }
.md-kpi { flex: 1; min-width: 175px; background: var(--surface, #fff); padding: 16px; border-radius: 14px; border: 1px solid var(--border, #e4e9f2); box-shadow: var(--shadow-card, 0 4px 24px rgba(24,35,56,.07)); }
.kpi-t { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-muted, #68758c); font-weight: 700; text-transform: uppercase; margin-bottom: 8px; }
.kpi-t i { color: var(--accent, #4c6fff); }
.kpi-v { font-size: 25px; font-weight: 700; color: var(--text, #182338); margin-bottom: 6px; }
.kpi-s { font-size: 11px; color: var(--text-muted, #68758c); line-height: 1.4; }
.md-card { background: var(--surface, #fff); padding: 20px; border-radius: 14px; border: 1px solid var(--border, #e4e9f2); box-shadow: var(--shadow-card, 0 4px 24px rgba(24,35,56,.07)); min-width: 300px; }
.md-card h3 { display: flex; align-items: center; gap: 10px; margin: 0 0 15px; color: var(--text, #182338); font-size: 16px; flex-wrap: wrap; }
.md-card h3 i { color: var(--accent, #4c6fff); }
.md-empty-card { color: var(--text-muted, #68758c); font-size: 13px; }
.md-hint { font-size: 12px; font-weight: 400; color: var(--text-muted, #68758c); }
.md-note { margin: 12px 0 0; font-size: 11px; color: var(--text-muted, #68758c); line-height: 1.5; }
.md-plans { display: flex; gap: 18px; flex-wrap: wrap; }
.md-plan { flex: 1; min-width: 250px; background: #f8f9fc; padding: 15px; border-radius: 10px; }
.plan-head { display: flex; justify-content: space-between; margin-bottom: 10px; color: var(--text, #182338); font-size: 14px; }
.plan-head span { display: inline-flex; align-items: center; gap: 8px; }
.plan-head i { color: var(--accent, #4c6fff); }
.md-track { width: 100%; height: 13px; background: #e6eaf2; border-radius: 8px; overflow: hidden; margin-bottom: 8px; }
.md-fill { height: 100%; background: linear-gradient(90deg, var(--accent, #4c6fff), #7b93ff); border-radius: 8px; transition: width .4s ease; }
.md-fill.done { background: linear-gradient(90deg, #12b376, #34d399); }
.plan-foot { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted, #68758c); }
.dev-plus { color: var(--success, #0fa968); font-weight: 700; }
.dev-neutral { color: #c05621; font-weight: 700; }
.md-convs { display: flex; gap: 15px; flex-wrap: wrap; }
.md-conv { flex: 1; min-width: 235px; padding: 15px; background: #fdfdff; border: 1px solid var(--border, #e4e9f2); border-left: 4px solid var(--accent, #4c6fff); border-radius: 10px; }
.conv-title { font-size: 13px; color: var(--text, #182338); font-weight: 700; margin-bottom: 6px; }
.conv-value { font-size: 28px; font-weight: 700; color: var(--accent, #4c6fff); margin-bottom: 4px; }
.conv-nodata { font-size: 14px; color: var(--text-muted, #68758c); font-weight: 700; margin: 8px 0; }
.conv-formula { font-size: 11px; color: var(--text-muted, #68758c); }
.conv-abs { font-size: 15px; font-weight: 700; color: var(--text, #182338); margin: 8px 0; display: flex; gap: 8px; align-items: baseline; }
.conv-slash { color: #b9c0cc; }
.conv-meta { display: flex; gap: 6px; flex-wrap: wrap; font-size: 10px; color: var(--text-muted, #68758c); }
.conv-meta span { background: #f4f6fb; padding: 2px 6px; border-radius: 4px; }
.conv-ver { background: #f4ecf7 !important; color: #7d3c98 !important; font-weight: 700; }
.conv-excl { font-size: 10px; color: #c05621; margin-top: 8px; border-top: 1px dashed var(--border, #e4e9f2); padding-top: 6px; }
.conv-note { font-size: 11px; color: #c05621; margin-top: 6px; line-height: 1.4; display: flex; gap: 6px; }
.conv-upd { font-size: 10px; color: #a7b2c6; margin-top: 6px; }
.md-weak { border-left: 4px solid var(--warning, #f5a524); background: #fff8ec; }
.weak-list { margin: 0; padding-left: 20px; color: #c05621; font-size: 13px; line-height: 1.7; }
.md-split { display: flex; gap: 20px; flex-wrap: wrap; }
.md-rem { display: flex; flex-direction: column; gap: 9px; }
.rem-row { display: flex; justify-content: space-between; font-size: 13px; color: var(--text, #182338); gap: 10px; }
.rem-total { border-top: 1px solid var(--border, #e4e9f2); padding-top: 10px; margin-top: 4px; font-size: 14px; }
.blue { color: var(--accent, #4c6fff); } .green { color: var(--success, #0fa968); }
.red { color: var(--danger, #e5484d); } .amber { color: var(--warning, #f5a524); }
.orange { color: #c05621; } .teal { color: #16a085; } .purple { color: #8e44ad; }
.md-tabs { display: flex; gap: 8px; margin-bottom: 15px; flex-wrap: wrap; }
.md-tab { background: #eef1f7; border: 1px solid var(--border, #e4e9f2); padding: 8px 14px; border-radius: 10px; cursor: pointer; color: var(--text-muted, #68758c); font-size: 12px; font-weight: 700; font-family: inherit; }
.md-tab.active { background: linear-gradient(135deg, var(--accent, #4c6fff), var(--accent-hover, #3a59e8)); color: #fff; border-color: transparent; }
.md-scroll { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.md-scroll-280 { max-height: 280px; overflow-y: auto; }
.md-scroll::-webkit-scrollbar { width: 9px; height: 9px; }
.md-scroll::-webkit-scrollbar-track { background: #f0f2f5; border-radius: 5px; }
.md-scroll::-webkit-scrollbar-thumb { background: #c2cbdc; border-radius: 5px; }
.md-table { width: 100%; border-collapse: collapse; min-width: 520px; }
.md-table th, .md-table td { padding: 10px 12px; border-bottom: 1px solid #eef1f6; text-align: left; font-size: 13px; white-space: nowrap; color: var(--text, #182338); }
.md-table th { background: #f6f8fc; color: var(--text-muted, #68758c); font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; position: sticky; top: 0; z-index: 2; }
.md-interactive tbody tr { cursor: pointer; }
.md-interactive tbody tr:hover { background: #f6f8fd; }
.md-empty { text-align: center; color: var(--text-muted, #68758c); padding: 22px !important; }
.md-muted { color: var(--text-muted, #68758c); }
.md-link { cursor: pointer; text-decoration: underline dashed rgba(76,111,255,.5); text-underline-offset: 3px; }
.md-link:hover { color: var(--accent, #4c6fff); }
.md-id { background: var(--accent-soft, #eef2ff); color: var(--accent, #4c6fff); padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 12px; display: inline-block; }
.md-id-link { text-decoration: none; border: 1px solid #dfe5ff; }
.md-id-link:hover { background: var(--accent, #4c6fff); color: #fff; }
.md-okved { background: #f4ecf7; color: #7d3c98; padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 700; }
.md-cross { background: #fff4e5; color: #c05621; border: 1px solid #fad7a0; padding: 2px 6px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-left: 6px; }
.md-main { background: #e7f7ef; color: var(--success, #0fa968); border: 1px solid #b8e6cf; padding: 2px 6px; border-radius: 6px; font-size: 11px; font-weight: 700; }
.md-goods { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
.md-company { max-width: 210px; }
.company-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; }
.md-overlay { position: fixed; inset: 0; background: rgba(12,18,34,.55); backdrop-filter: blur(3px); display: flex; justify-content: center; align-items: center; z-index: 1000; padding: 20px; }
.md-overlay-top { z-index: 1100; }
.md-modal { background: var(--surface, #fff); border-radius: 18px; width: 100%; max-width: 1100px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 24px 60px rgba(5,10,25,.35); }
.md-modal-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid var(--border, #e4e9f2); }
.md-modal-head h3 { margin: 0; font-size: 17px; }
.md-close { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--text-muted, #68758c); }
.md-close:hover { color: var(--danger, #e5484d); }
.md-modal-body { padding: 20px; overflow-y: auto; }
.md-modal-tools { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 13px; }
.md-deal-info { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 8px 20px; background: #f8f9fc; padding: 15px; border-radius: 10px; margin-bottom: 15px; font-size: 13px; }
.md-totals { display: flex; justify-content: space-between; gap: 15px; flex-wrap: wrap; margin-top: 15px; padding-top: 12px; border-top: 1px solid var(--border, #e4e9f2); font-size: 13px; }
@media (max-width: 768px) {
    .md-kpi, .md-conv, .md-plan { min-width: 100%; }
    .md-actions { width: 100%; }
}
</style>