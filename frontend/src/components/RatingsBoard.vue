<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';

const API = 'http://localhost:3000/api';

const managers = ref<any[]>([]);
const bases = ref<any[]>([]);
const selectedBase = ref('');
const loading = ref(true);
const currentMonth = computed(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
});
const currentMonthName = computed(() => {
    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    return months[new Date().getMonth()];
});

const loadData = async () => {
    loading.value = true;
    try {
        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const [resMan, resBases] = await Promise.all([
            fetch(`${API}/analytics/managers?startDate=${startOfMonth}`),
            fetch(`${API}/bases`)
        ]);
        if (resMan.ok) managers.value = await resMan.json();
        if (resBases.ok) bases.value = await resBases.json();
    } catch (e) {
        console.error('Ошибка загрузки рейтингов', e);
    } finally {
        loading.value = false;
    }
};

const topCalls = computed(() =>
    [...managers.value].filter(m => m.total_calls > 0).sort((a, b) => b.total_calls - a.total_calls).slice(0, 15)
);
const topLeads = computed(() =>
    [...managers.value].filter(m => m.quality_leads > 0).sort((a, b) => b.quality_leads - a.quality_leads).slice(0, 15)
);
const topDeals = computed(() =>
    [...managers.value].filter(m => m.amount_sum > 0).sort((a, b) => b.amount_sum - a.amount_sum).slice(0, 15)
);
const topConversion = computed(() => {
    return [...managers.value]
        .map(m => ({
            ...m,
            conv: m.unique_leads > 0 ? Math.round((m.quality_leads / m.unique_leads) * 100) : 0
        }))
        .filter(m => m.conv > 0 && m.unique_leads >= 5)
        .sort((a, b) => {
            if (b.conv !== a.conv) return b.conv - a.conv;
            return b.total_calls - a.total_calls;
        })
        .slice(0, 15);
});

const getMedal = (index: number) => {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return `${index + 1}.`;
};

const csvCell = (v: any): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const exportToCSV = () => {
    if (managers.value.length === 0) return;
    let csv = 'Менеджер;Отдел;Квалификация;Звонки;Разговоры;Кач. лиды;Взято в работу;Конверсия %;Оплаты;Выручка\n';
    managers.value.forEach(m => {
        const conv = m.unique_leads > 0 ? Math.round((m.quality_leads / m.unique_leads) * 100) : 0;
        csv += [m.manager_name, m.department_name || 'Без отдела', m.qualification || 'обычный',
                m.total_calls, m.valid_conversations, m.quality_leads, m.unique_leads,
                conv, m.paid_deals, m.amount_sum].map(csvCell).join(';') + '\n';
    });
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `Рейтинги_${currentMonth.value}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
    loadData();
});
</script>

<template>
    <div class="rb">
        <div class="rb-header">
            <div>
                <h2><i class="fas fa-trophy"></i> Рейтинги сотрудников</h2>
                <p>Топ месяца по наборам, качественным лидам, выручке и конверсии. Отдел и квалификация показываются рядом с именем.</p>
            </div>
            <div class="rb-actions">
                <select v-model="selectedBase" class="rb-select">
                    <option value="">Все базы</option>
                    <option v-for="b in bases" :key="b.id" :value="b.id">{{ b.name }}</option>
                </select>
                <button @click="loadData" class="rb-icon-btn" title="Обновить">
                    <i class="fas fa-rotate"></i>
                </button>
                <button @click="exportToCSV" class="rb-export" :disabled="loading || managers.length === 0">
                    <i class="fas fa-file-export"></i> Экспорт CSV
                </button>
            </div>
        </div>

        <div v-if="loading" class="rb-empty">Подсчёт рейтингов…</div>
        <div v-else-if="managers.length === 0" class="rb-empty">В этом месяце ещё нет данных для рейтингов.</div>

        <div v-else class="rb-grid">
            <div class="rb-card">
                <div class="rb-card-head" style="background: linear-gradient(135deg, #3498db, #2980b9);">
                    <h3><i class="fas fa-phone"></i> Лидеры по звонкам</h3>
                    <small>Топ по количеству исходящих наборов</small>
                </div>
                <ul class="rb-list">
                    <li v-for="(m, i) in topCalls" :key="m.manager_id" :class="'rb-rank-' + i">
                        <span class="rb-medal">{{ getMedal(i) }}</span>
                        <div class="rb-info">
                            <span class="rb-name" :title="m.manager_name">{{ m.manager_name }}</span>
                            <span class="rb-meta">
                                <span class="rb-dept">{{ m.department_name || 'Без отдела' }}</span>
                                <span v-if="m.qualification === 'ведущий'" class="rb-qual">Ведущий</span>
                            </span>
                        </div>
                        <span class="rb-score">{{ m.total_calls }} шт</span>
                    </li>
                    <li v-if="topCalls.length === 0" class="rb-empty">Нет звонков</li>
                </ul>
            </div>

            <div class="rb-card">
                <div class="rb-card-head" style="background: linear-gradient(135deg, #9b59b6, #8e44ad);">
                    <h3><i class="fas fa-gem"></i> Лидеры по кач. лидам</h3>
                    <small>Топ по количеству качественных лидов</small>
                </div>
                <ul class="rb-list">
                    <li v-for="(m, i) in topLeads" :key="m.manager_id" :class="'rb-rank-' + i">
                        <span class="rb-medal">{{ getMedal(i) }}</span>
                        <div class="rb-info">
                            <span class="rb-name" :title="m.manager_name">{{ m.manager_name }}</span>
                            <span class="rb-meta">
                                <span class="rb-dept">{{ m.department_name || 'Без отдела' }}</span>
                                <span v-if="m.qualification === 'ведущий'" class="rb-qual">Ведущий</span>
                            </span>
                        </div>
                        <span class="rb-score">{{ m.quality_leads }} шт</span>
                    </li>
                    <li v-if="topLeads.length === 0" class="rb-empty">Нет качественных лидов</li>
                </ul>
            </div>

            <div class="rb-card">
                <div class="rb-card-head" style="background: linear-gradient(135deg, #27ae60, #229954);">
                    <h3><i class="fas fa-credit-card"></i> Лидеры по выручке</h3>
                    <small>Топ по сумме подтверждённых оплат</small>
                </div>
                <ul class="rb-list">
                    <li v-for="(m, i) in topDeals" :key="m.manager_id" :class="'rb-rank-' + i">
                        <span class="rb-medal">{{ getMedal(i) }}</span>
                        <div class="rb-info">
                            <span class="rb-name" :title="m.manager_name">{{ m.manager_name }}</span>
                            <span class="rb-meta">
                                <span class="rb-dept">{{ m.department_name || 'Без отдела' }}</span>
                                <span v-if="m.qualification === 'ведущий'" class="rb-qual">Ведущий</span>
                            </span>
                        </div>
                        <span class="rb-score rb-money">{{ m.amount_sum.toLocaleString('ru-RU') }} ₽</span>
                    </li>
                    <li v-if="topDeals.length === 0" class="rb-empty">Нет оплат</li>
                </ul>
            </div>

            <div class="rb-card">
                <div class="rb-card-head" style="background: linear-gradient(135deg, #f39c12, #e67e22);">
                    <h3><i class="fas fa-bullseye"></i> Лидеры по конверсии</h3>
                    <small>Конверсия: Кач. лиды / Взято в работу (мин. 5 лидов)</small>
                </div>
                <ul class="rb-list">
                    <li v-for="(m, i) in topConversion" :key="m.manager_id" :class="'rb-rank-' + i">
                        <span class="rb-medal">{{ getMedal(i) }}</span>
                        <div class="rb-info">
                            <span class="rb-name" :title="m.manager_name">{{ m.manager_name }}</span>
                            <span class="rb-meta">
                                <span class="rb-dept">{{ m.department_name || 'Без отдела' }}</span>
                                <span v-if="m.qualification === 'ведущий'" class="rb-qual">Ведущий</span>
                            </span>
                        </div>
                        <span class="rb-score rb-conv">
                            {{ m.conv }}%
                            <small class="rb-conv-sub">({{ m.quality_leads }}/{{ m.unique_leads }})</small>
                        </span>
                    </li>
                    <li v-if="topConversion.length === 0" class="rb-empty">Нет данных для конверсии</li>
                </ul>
            </div>
        </div>
    </div>
</template>

<style scoped>
.rb { width: 100%; font-family: var(--font, Arial, sans-serif); }
.rb-header { display: flex; justify-content: space-between; align-items: center; gap: 15px; flex-wrap: wrap; border-bottom: 2px solid #f0f2f8; padding-bottom: 15px; margin-bottom: 20px; }
.rb-header h2 { display: flex; align-items: center; gap: 11px; margin: 0 0 5px; font-size: 24px; color: var(--text, #182338); }
.rb-header h2 i { color: #f39c12; }
.rb-header p { margin: 0; color: var(--text-muted, #68758c); font-size: 13px; }
.rb-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.rb-select { padding: 9px 12px; border: 1px solid var(--border, #e4e9f2); border-radius: 10px; outline: none; background: var(--surface, #fff); color: var(--text, #182338); font-size: 13px; font-family: inherit; }
.rb-select:focus { border-color: var(--accent, #4c6fff); box-shadow: 0 0 0 3px rgba(76,111,255,.15); }
.rb-icon-btn { background: #f4f6fb; border: 1px solid var(--border, #e4e9f2); padding: 9px 12px; border-radius: 10px; cursor: pointer; color: var(--text-muted, #68758c); }
.rb-icon-btn:hover { color: var(--accent, #4c6fff); border-color: var(--accent, #4c6fff); }
.rb-export { display: inline-flex; align-items: center; gap: 8px; padding: 9px 15px; background: linear-gradient(135deg, var(--success, #0fa968), #0d9460); color: #fff; border: none; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 13px; font-family: inherit; }
.rb-export:disabled { background: #b9c0cc; cursor: not-allowed; }
.rb-empty { text-align: center; color: var(--text-muted, #68758c); padding: 40px 20px; background: var(--surface, #fff); border: 1px dashed var(--border, #e4e9f2); border-radius: 12px; font-size: 14px; }
.rb-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
.rb-card { background: var(--surface, #fff); border-radius: 14px; overflow: hidden; border: 1px solid var(--border, #e4e9f2); box-shadow: var(--shadow-card, 0 4px 24px rgba(24,35,56,.07)); }
.rb-card-head { padding: 18px 20px; color: #fff; text-align: center; }
.rb-card-head h3 { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 0 0 5px; font-size: 16px; }
.rb-card-head small { opacity: 0.9; font-size: 12px; }
.rb-list { list-style: none; padding: 0; margin: 0; }
.rb-list li { display: flex; align-items: center; padding: 14px 18px; border-bottom: 1px solid #f0f2f8; background: var(--surface, #fff); transition: transform .2s; }
.rb-list li:last-child { border-bottom: none; }
.rb-list li:hover { transform: translateX(5px); }
.rb-rank-0 { background: linear-gradient(90deg, rgba(255,215,0,0.1) 0%, var(--surface, #fff) 50%) !important; border-left: 3px solid #f1c40f; }
.rb-rank-1 { background: linear-gradient(90deg, rgba(192,192,192,0.1) 0%, var(--surface, #fff) 50%) !important; border-left: 3px solid #bdc3c7; }
.rb-rank-2 { background: linear-gradient(90deg, rgba(205,127,50,0.1) 0%, var(--surface, #fff) 50%) !important; border-left: 3px solid #d35400; }
.rb-medal { font-size: 22px; width: 32px; text-align: center; margin-right: 12px; flex-shrink: 0; }
.rb-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.rb-name { font-weight: 700; color: var(--text, #182338); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rb-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.rb-dept { font-size: 11px; color: var(--text-muted, #68758c); background: #f4f6fb; padding: 2px 6px; border-radius: 4px; }
.rb-qual { font-size: 10px; color: #7d3c98; background: #f4ecf7; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
.rb-score { font-weight: 700; color: var(--text, #182338); font-size: 15px; flex-shrink: 0; white-space: nowrap; margin-left: 10px; }
.rb-money { color: var(--success, #0fa968); }
.rb-conv { color: #e67e22; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.rb-conv-sub { font-size: 11px; color: var(--text-muted, #68758c); font-weight: 400; }
@media (max-width: 768px) {
    .rb-grid { grid-template-columns: 1fr; }
    .rb-actions { width: 100%; }
}
</style>