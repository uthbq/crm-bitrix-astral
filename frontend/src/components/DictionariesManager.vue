<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';

const API = 'http://localhost:3000/api';

const products = ref<any[]>([]);
const bases = ref<any[]>([]);
const segments = ref<any[]>([]);
const reasons = ref<any[]>([]);
const okvedList = ref<any[]>([]);
const rules = ref<any[]>([]);
const syncStatus = ref<any>(null);

const activeTab = ref<'bases' | 'products' | 'segments' | 'reasons' | 'okved' | 'rules'>('bases');
const syncLoading = ref(false);
const segmentsSyncLoading = ref(false);

const searchBases = ref('');
const searchProducts = ref('');
const searchSegments = ref('');
const searchReasons = ref('');
const searchOkved = ref('');

const newBaseName = ref('');
const newBaseProductId = ref<number | ''>('');
const newProduct = reactive({ name: '', bitrix_id: null as number | null, product_group: '' });
const newSegment = reactive({ name: '', entity: 'lead' });
const newReasonName = ref('');
const newOkved = reactive({ code: '', name: '' });

const editingProductId = ref<number | null>(null);
const editProduct = reactive({ name: '', bitrix_id: null as number | null, product_group: '' });
const editingReasonId = ref<number | null>(null);
const editReasonName = ref('');
const editingOkvedCode = ref<string | null>(null);
const editOkvedName = ref('');

const newRule = reactive({
    base_id: '' as number | '',
    numerator: 'quality_leads',
    denominator: 'unique_leads',
    calc_type: 'уникальные лиды',
    product_type: 'all',
    cycle_type: 'all'
});
const extraStatuses = ref('');
const editingRuleId = ref<number | null>(null);

const showProductDeals = ref(false);
const productDealsLoading = ref(false);
const selectedProduct = ref<any>(null);
const productDeals = ref<any[]>([]);

const toast = ref<{ text: string; type: 'success' | 'error' } | null>(null);
let toastTimer: any = null;
const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    toast.value = { text, type };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.value = null; }, 5000);
};

const vocab: Record<string, string> = {
    quality_leads: 'Кач. лиды', paid_deals: 'Оплаты', transfers: 'Передачи',
    unique_leads: 'Взято в работу', total_calls: 'Все наборы', valid_conversations: 'Разговоры'
};
const okvedLoading = ref(false);

const loadOkvedNames = async () => {
    okvedLoading.value = true;
    try {
        const res = await fetch(`${API}/okved/load-names`);
        const data = await res.json();
        if (res.ok) {
            await loadOkved();
            showToast(`Загружено названий: ${data.updated || 0}`);
        } else {
            showToast(data.error || 'Ошибка загрузки', 'error');
        }
    } catch {
        showToast('Нет связи с сервером', 'error');
    } finally {
        okvedLoading.value = false;
    }
};
const tabs = [
    { key: 'bases' as const, icon: 'fa-folder-tree', label: 'Базы', count: () => bases.value.length },
    { key: 'products' as const, icon: 'fa-boxes-stacked', label: 'Продукты', count: () => products.value.length },
    { key: 'segments' as const, icon: 'fa-tags', label: 'Сегменты', count: () => segments.value.length },
    { key: 'reasons' as const, icon: 'fa-ban', label: 'Причины отказов', count: () => reasons.value.length },
    { key: 'okved' as const, icon: 'fa-industry', label: 'ОКВЭД', count: () => okvedList.value.length },
    { key: 'rules' as const, icon: 'fa-sliders', label: 'Конверсии', count: () => rules.value.length }
];

const money = (v: any) => (Number(v) || 0).toLocaleString('ru-RU');
const formatDate = (s: string) => {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
};
const entityLabel = (e: string) => ({ lead: 'Лид', deal: 'Сделка', contact: 'Контакт', company: 'Компания' } as any)[e] || e || '—';
const translateFilter = (val: string) =>
    ({ main: 'Основной', cross: 'Кросс', primary: 'Первичный', return: 'Возврат' } as any)[val] || 'Любой';
const parseExcluded = (s: string) => { try { return JSON.parse(s).join(', '); } catch { return 'IMPORT'; } };
const b24Link = (dealId: any): string => {
    const base = (localStorage.getItem('b24_portal_url') || '').trim().replace(/\/+$/, '');
    return base ? `${base}/crm/deal/details/${dealId}/` : '';
};

const basesWithoutProduct = computed(() => bases.value.filter(b => !b.main_product_id).length);
const okvedWithoutName = computed(() => okvedList.value.filter(o => !o.name).length);
const basesByName = computed(() => new Set(bases.value.map(b => b.name.trim().toLowerCase())));
const rulesByBase = computed(() => {
    const map: Record<number, any> = {};
    rules.value.forEach(r => { map[r.base_id] = r; });
    return map;
});

const filteredBases = computed(() => {
    const q = searchBases.value.trim().toLowerCase();
    return q ? bases.value.filter(b => b.name.toLowerCase().includes(q)) : bases.value;
});
const filteredProducts = computed(() => {
    const q = searchProducts.value.trim().toLowerCase();
    return q ? products.value.filter(p =>
        [p.name, p.product_group, p.bitrix_id].some(v => String(v ?? '').toLowerCase().includes(q))
    ) : products.value;
});
const filteredSegments = computed(() => {
    const q = searchSegments.value.trim().toLowerCase();
    return q ? segments.value.filter(s => s.name.toLowerCase().includes(q)) : segments.value;
});
const filteredReasons = computed(() => {
    const q = searchReasons.value.trim().toLowerCase();
    return q ? reasons.value.filter(r => r.name.toLowerCase().includes(q)) : reasons.value;
});
const filteredOkved = computed(() => {
    const q = searchOkved.value.trim().toLowerCase();
    return q ? okvedList.value.filter(o => [o.code, o.name].some(v => String(v ?? '').toLowerCase().includes(q))) : okvedList.value;
});

const excludedPreview = computed(() => {
    const extra = extraStatuses.value.split(',').map(s => s.trim()).filter(Boolean);
    return ['IMPORT', ...extra.filter(s => s !== 'IMPORT')];
});
const compatibilityError = computed(() => {
    if (newRule.numerator === 'paid_deals' && ['total_calls', 'valid_conversations'].includes(newRule.denominator)) {
        return 'Нельзя делить оплаты на звонки без правила связи — несовместимые единицы.';
    }
    if (newRule.numerator === newRule.denominator) {
        return 'Числитель и знаменатель совпадают — конверсия всегда 100%, правило бессмысленно.';
    }
    return '';
});

const loadProducts = async () => { try { const r = await fetch(`${API}/products`); if (r.ok) products.value = await r.json(); } catch {} };
const loadBases = async () => { try { const r = await fetch(`${API}/bases`); if (r.ok) bases.value = await r.json(); } catch {} };
const loadSegments = async () => { try { const r = await fetch(`${API}/segments`); if (r.ok) segments.value = await r.json(); } catch {} };
const loadReasons = async () => { try { const r = await fetch(`${API}/refusal-reasons`); if (r.ok) reasons.value = await r.json(); } catch {} };
const loadOkved = async () => { try { const r = await fetch(`${API}/okved`); if (r.ok) okvedList.value = await r.json(); } catch {} };
const loadRules = async () => { try { const r = await fetch(`${API}/conversions`); if (r.ok) rules.value = await r.json(); } catch {} };
const loadSyncStatus = async () => { try { const r = await fetch(`${API}/sync-status`); if (r.ok) syncStatus.value = await r.json(); } catch {} };

const triggerProductsSync = async () => {
    syncLoading.value = true;
    try {
        await fetch(`${API}/sync-products?limit=1000`);
        showToast('Догрузка товаров запущена. Счётчик обновится через 20 секунд.');
        setTimeout(async () => { await loadSyncStatus(); syncLoading.value = false; }, 20000);
    } catch {
        showToast('Не удалось запустить догрузку', 'error');
        syncLoading.value = false;
    }
};

const addBase = async () => {
    if (!newBaseName.value.trim()) return;
    try {
        const res = await fetch(`${API}/bases`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newBaseName.value.trim(), main_product_id: newBaseProductId.value || null })
        });
        const data = await res.json();
        if (res.ok) {
            newBaseName.value = ''; newBaseProductId.value = '';
            await loadBases();
            showToast('База добавлена');
        } else showToast(data.error || 'Ошибка создания', 'error');
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const updateBaseProduct = async (base: any) => {
    try {
        const res = await fetch(`${API}/bases/${base.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ main_product_id: base.main_product_id || null })
        });
        const data = await res.json();
        if (res.ok) {
            base.main_product_name = products.value.find((p: any) => p.id === base.main_product_id)?.name || null;
            showToast(base.main_product_id
                ? 'Основной продукт сохранён. Кросс-продажи пересчитаны по товарам.'
                : 'Основной продукт снят. Кросс-продажи по базе больше не определяются.');
        } else {
            showToast(data.error || 'Ошибка сохранения', 'error');
            await loadBases();
        }
    } catch {
        showToast('Нет связи с сервером', 'error');
        await loadBases();
    }
};

const deleteBase = async (base: any) => {
    if (!confirm(`Удалить базу «${base.name}»? Связанное правило конверсии также будет удалено.`)) return;
    try {
        const res = await fetch(`${API}/bases/${base.id}`, { method: 'DELETE' });
        if (res.ok) {
            await Promise.all([loadBases(), loadRules()]);
            showToast('База удалена');
        } else showToast((await res.json()).error || 'Ошибка удаления', 'error');
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const addProduct = async () => {
    if (!newProduct.name.trim()) return;
    try {
        const res = await fetch(`${API}/products`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: newProduct.name.trim(),
                bitrix_id: newProduct.bitrix_id || null,
                product_group: newProduct.product_group.trim() || null
            })
        });
        const data = await res.json();
        if (res.ok) {
            newProduct.name = ''; newProduct.bitrix_id = null; newProduct.product_group = '';
            await loadProducts();
            showToast('Продукт добавлен');
        } else showToast(data.error || 'Ошибка создания', 'error');
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const startProductEdit = (p: any) => {
    editingProductId.value = p.id;
    editProduct.name = p.name;
    editProduct.bitrix_id = p.bitrix_id;
    editProduct.product_group = p.product_group || '';
};

const saveProductEdit = async (p: any) => {
    if (!editProduct.name.trim()) return showToast('Название обязательно', 'error');
    try {
        const res = await fetch(`${API}/products/${p.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: editProduct.name.trim(),
                bitrix_id: editProduct.bitrix_id || null,
                product_group: editProduct.product_group.trim() || null
            })
        });
        const data = await res.json();
        if (res.ok) {
            editingProductId.value = null;
            await Promise.all([loadProducts(), loadBases()]);
            showToast(data.recalculated_bases
                ? `Продукт обновлён. Кросс пересчитан по ${data.recalculated_bases} базам.`
                : 'Продукт обновлён');
        } else showToast(data.error || 'Ошибка обновления', 'error');
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const deleteProduct = async (p: any) => {
    const warn = p.bases_count
        ? `У ${p.bases_count} баз он назначен основным — они потеряют основной продукт, кросс по ним перестанет определяться.`
        : 'Товарные строки сделок останутся, продукт исчезнет из справочника.';
    if (!confirm(`Удалить продукт «${p.name}»? ${warn}`)) return;
    try {
        const res = await fetch(`${API}/products/${p.id}`, { method: 'DELETE' });
        if (res.ok) {
            await Promise.all([loadProducts(), loadBases()]);
            showToast('Продукт удалён');
        } else showToast((await res.json()).error || 'Ошибка удаления', 'error');
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const openProductDeals = async (p: any) => {
    selectedProduct.value = p;
    showProductDeals.value = true;
    productDealsLoading.value = true;
    productDeals.value = [];
    try {
        const res = await fetch(`${API}/products/${p.id}/deals`);
        if (res.ok) productDeals.value = await res.json();
        else showToast((await res.json()).error || 'Ошибка загрузки продаж', 'error');
    } catch { showToast('Нет связи с сервером', 'error'); }
    finally { productDealsLoading.value = false; }
};

const addSegment = async () => {
    if (!newSegment.name.trim()) return;
    try {
        const res = await fetch(`${API}/segments`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newSegment.name.trim(), entity: newSegment.entity })
        });
        if (res.ok) {
            newSegment.name = '';
            await loadSegments();
            showToast('Сегмент сохранён');
        } else showToast((await res.json()).error || 'Ошибка сохранения', 'error');
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const refreshSegments = async () => {
    segmentsSyncLoading.value = true;
    try {
        const res = await fetch(`${API}/sync-segments`);
        if (res.ok) {
            await Promise.all([loadSegments(), loadBases()]);
            showToast('Сегменты обновлены из Битрикс24. Новые базы созданы — назначьте им основной продукт.');
        } else showToast('Ошибка синхронизации сегментов', 'error');
    } catch { showToast('Нет связи с сервером', 'error'); }
    finally { segmentsSyncLoading.value = false; }
};

const deleteSegment = async (s: any) => {
    if (!confirm(`Удалить сегмент «${s.name}»? База с таким названием останется, сегмент вернётся при следующей синхронизации.`)) return;
    try {
        const res = await fetch(`${API}/segments/${s.id}`, { method: 'DELETE' });
        if (res.ok) { await loadSegments(); showToast('Сегмент удалён'); }
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const addReason = async () => {
    if (!newReasonName.value.trim()) return;
    try {
        const res = await fetch(`${API}/refusal-reasons`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newReasonName.value.trim() })
        });
        const data = await res.json();
        if (res.ok) { newReasonName.value = ''; await loadReasons(); showToast('Причина добавлена'); }
        else showToast(data.error || 'Ошибка сохранения', 'error');
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const saveReasonEdit = async (r: any) => {
    if (!editReasonName.value.trim()) return showToast('Название обязательно', 'error');
    try {
        const res = await fetch(`${API}/refusal-reasons/${r.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: editReasonName.value.trim() })
        });
        if (res.ok) { editingReasonId.value = null; await loadReasons(); showToast('Причина обновлена'); }
        else showToast((await res.json()).error || 'Ошибка обновления', 'error');
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const deleteReason = async (r: any) => {
    if (!confirm(`Удалить причину «${r.name}»? У связанных лидов причина сбросится — они попадут в отчёт «молчунов».`)) return;
    try {
        const res = await fetch(`${API}/refusal-reasons/${r.id}`, { method: 'DELETE' });
        if (res.ok) { await loadReasons(); showToast('Причина удалена'); }
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const addOkved = async () => {
    if (!newOkved.code.trim()) return showToast('Код обязателен', 'error');
    try {
        const res = await fetch(`${API}/okved`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: newOkved.code.trim(), name: newOkved.name.trim() || null })
        });
        if (res.ok) {
            newOkved.code = ''; newOkved.name = '';
            await loadOkved();
            showToast('ОКВЭД сохранён');
        } else showToast((await res.json()).error || 'Ошибка сохранения', 'error');
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const saveOkvedEdit = async (o: any) => {
    try {
        const res = await fetch(`${API}/okved`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: o.code, name: editOkvedName.value.trim() || null })
        });
        if (res.ok) { editingOkvedCode.value = null; await loadOkved(); showToast('Название ОКВЭД сохранено'); }
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const deleteOkved = async (o: any) => {
    if (!confirm(`Удалить код ${o.code} из справочника? Сделки с этим ОКВЭД сохранят код, он вернётся при обогащении Dadata.`)) return;
    try {
        const res = await fetch(`${API}/okved/${encodeURIComponent(o.code)}`, { method: 'DELETE' });
        if (res.ok) { await loadOkved(); showToast('Код удалён из справочника'); }
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const resetRuleForm = () => {
    editingRuleId.value = null;
    newRule.base_id = '';
    newRule.numerator = 'quality_leads';
    newRule.denominator = 'unique_leads';
    newRule.calc_type = 'уникальные лиды';
    newRule.product_type = 'all';
    newRule.cycle_type = 'all';
    extraStatuses.value = '';
};

const editRule = (rule: any) => {
    editingRuleId.value = rule.id;
    newRule.base_id = rule.base_id;
    newRule.numerator = rule.numerator;
    newRule.denominator = rule.denominator;
    newRule.calc_type = rule.calc_type;
    newRule.product_type = rule.product_type;
    newRule.cycle_type = rule.cycle_type;
    try {
        extraStatuses.value = JSON.parse(rule.excluded_statuses).filter((s: string) => s !== 'IMPORT').join(', ');
    } catch { extraStatuses.value = ''; }
};

const saveRule = async () => {
    if (!newRule.base_id) return showToast('Выберите базу', 'error');
    if (compatibilityError.value) return showToast(compatibilityError.value, 'error');
    try {
        const res = await fetch(`${API}/conversions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...newRule, excluded_statuses: JSON.stringify(excludedPreview.value) })
        });
        const data = await res.json();
        if (res.ok) {
            const wasEdit = !!editingRuleId.value;
            resetRuleForm();
            await loadRules();
            showToast(wasEdit ? 'Правило обновлено, версия увеличена' : 'Правило сохранено');
        } else showToast(data.error || 'Ошибка сохранения', 'error');
    } catch { showToast('Нет связи с сервером', 'error'); }
};

const deleteRule = async (rule: any) => {
    if (!confirm(`Удалить правило конверсии для базы «${rule.base_name}»? Расчёт вернётся к формуле по умолчанию.`)) return;
    try {
        const res = await fetch(`${API}/conversions/${rule.id}`, { method: 'DELETE' });
        if (res.ok) {
            if (editingRuleId.value === rule.id) resetRuleForm();
            await loadRules();
            showToast('Правило удалено');
        }
    } catch { showToast('Нет связи с сервером', 'error'); }
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
const exportBases = () => {
    let csv = 'ID;База;Основной продукт;Bitrix ID продукта;Правило конверсии;Версия\n';
    filteredBases.value.forEach((b: any) => {
        const p = products.value.find(x => x.id === b.main_product_id);
        const rule = rulesByBase.value[b.id];
        csv += [b.id, b.name, p?.name || 'не назначен', p?.bitrix_id || '',
            rule ? `${vocab[rule.numerator]} / ${vocab[rule.denominator]}` : 'по умолчанию',
            rule?.version || ''].map(csvCell).join(';') + '\n';
    });
    download(csv, 'Справочник_Базы.csv');
};
const exportProducts = () => {
    let csv = 'ID;Название;Bitrix ID;Группа;Баз с основным продуктом\n';
    filteredProducts.value.forEach((p: any) => {
        csv += [p.id, p.name, p.bitrix_id, p.product_group, p.bases_count].map(csvCell).join(';') + '\n';
    });
    download(csv, 'Справочник_Продукты.csv');
};
const exportOkved = () => {
    let csv = 'Код;Название\n';
    filteredOkved.value.forEach((o: any) => { csv += [o.code, o.name].map(csvCell).join(';') + '\n'; });
    download(csv, 'Справочник_ОКВЭД.csv');
};
const exportProductDeals = () => {
    let csv = 'Сделка;Ссылка;Дата;Компания;ИНН;ОКВЭД;База;Менеджер;Товар;Кол-во;Цена;Сумма строки;Тип;Сумма сделки;Стадия\n';
    productDeals.value.forEach((d: any) => {
        csv += [d.bitrix_deal_id, b24Link(d.bitrix_deal_id), formatDate(d.created_at), d.company_title,
            d.inn, d.okved, d.base_name, d.manager_name, d.product_name, d.quantity, d.price,
            d.row_sum, d.row_cross ? 'кросс' : 'основной', d.amount, d.stage_name].map(csvCell).join(';') + '\n';
    });
    download(csv, `Продажи_${selectedProduct.value?.name || 'продукта'}.csv`);
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
    loadProducts();
    loadBases();
    loadSegments();
    loadReasons();
    loadOkved();
    loadRules();
    loadSyncStatus();
});
</script>

<template>
    <div class="dm">
        <div class="dm-header">
            <div>
                <h2><i class="fas fa-folder-open"></i> Справочники и конструктор конверсий</h2>
                <p>Базы и основные продукты, каталог товаров, сегменты, причины отказов, ОКВЭД и правила расчёта конверсий</p>
            </div>
            <div v-if="toast" :class="['dm-toast', toast.type]">
                <i :class="toast.type === 'success' ? 'fas fa-circle-check' : 'fas fa-circle-exclamation'"></i>
                {{ toast.text }}
            </div>
        </div>

        <div class="dm-info">
            <button v-if="basesWithoutProduct > 0" class="dm-info-chip warn" @click="activeTab = 'bases'">
                <i class="fas fa-triangle-exclamation"></i>
                Без основного продукта: {{ basesWithoutProduct }} баз — кросс-продажи по ним не определяются
            </button>
            <span v-else class="dm-info-chip ok">
                <i class="fas fa-circle-check"></i> Основной продукт назначен всем базам
            </span>
            <template v-if="syncStatus && syncStatus.products_pending > 0">
                <span class="dm-info-chip warn">
                    <i class="fas fa-box-open"></i> Товары не загружены у {{ syncStatus.products_pending }} сделок
                </span>
                <button class="dm-btn-sm" @click="triggerProductsSync" :disabled="syncLoading">
                    <i :class="syncLoading ? 'fas fa-spinner fa-spin' : 'fas fa-arrows-rotate'"></i>
                    {{ syncLoading ? 'Догрузка запущена…' : 'Догрузить товары' }}
                </button>
            </template>
        </div>

        <div class="dm-tabs">
            <button v-for="t in tabs" :key="t.key" @click="activeTab = t.key"
                    :class="['dm-tab', { active: activeTab === t.key }]">
                <i :class="['fas', t.icon]"></i>
                <span>{{ t.label }}</span>
                <span class="dm-tab-count">{{ t.count() }}</span>
            </button>
        </div>

        <div v-if="activeTab === 'bases'" class="dm-card">
            <h3><i class="fas fa-folder-tree"></i> Базы для прозвона</h3>
            <p class="dm-note">
                Основной продукт базы задаётся прямо в таблице и сохраняется сразу. Кросс-продажи пересчитываются
                по уже загруженным товарам мгновенно, без ожидания синхронизации.
            </p>
            <div class="dm-add-form">
                <div class="dm-field-input">
                    <i class="fas fa-plus"></i>
                    <input v-model="newBaseName" placeholder="Название базы, например: ЭПД от ТМ общее" @keyup.enter="addBase" />
                </div>
                <div class="dm-field-input">
                    <i class="fas fa-box"></i>
                    <select v-model="newBaseProductId">
                        <option :value="''">Основной продукт (можно позже)</option>
                        <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}</option>
                    </select>
                </div>
                <button @click="addBase" class="dm-btn-add"><i class="fas fa-plus"></i> Добавить</button>
            </div>
            <div class="dm-toolbar">
                <div class="dm-field-input dm-search">
                    <i class="fas fa-magnifying-glass"></i>
                    <input v-model="searchBases" placeholder="Поиск базы…" />
                </div>
                <button @click="exportBases" class="dm-btn-export" :disabled="filteredBases.length === 0">
                    <i class="fas fa-file-export"></i> CSV
                </button>
            </div>
            <div class="dm-scroll">
                <table class="dm-table">
                    <thead>
                        <tr>
                            <th>ID</th><th>База</th><th>Основной продукт</th>
                            <th>Кросс-продажи</th><th>Конверсия</th><th style="width: 50px;"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="filteredBases.length === 0"><td colspan="6" class="dm-empty">Базы не найдены</td></tr>
                        <tr v-for="base in filteredBases" :key="base.id">
                            <td class="dm-muted">{{ base.id }}</td>
                            <td><strong>{{ base.name }}</strong></td>
                            <td>
                                <select class="dm-inline-select" v-model="base.main_product_id"
                                        @change="updateBaseProduct(base)">
                                    <option :value="null">— не назначен —</option>
                                    <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}</option>
                                </select>
                            </td>
                            <td>
                                <span v-if="base.main_product_id" class="dm-badge ok">
                                    <i class="fas fa-check"></i> определяются
                                </span>
                                <span v-else class="dm-badge warn">
                                    <i class="fas fa-xmark"></i> не определяются
                                </span>
                            </td>
                            <td>
                                <span v-if="rulesByBase[base.id]" class="dm-badge purple">
                                    <i class="fas fa-code-branch"></i> v.{{ rulesByBase[base.id].version }}
                                </span>
                                <span v-else class="dm-muted">по умолчанию</span>
                            </td>
                            <td style="text-align: center;">
                                <button @click="deleteBase(base)" class="dm-btn-del" title="Удалить базу">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div v-if="activeTab === 'products'" class="dm-card">
            <h3><i class="fas fa-boxes-stacked"></i> Продукты</h3>
            <p class="dm-note">
                Продукты добавляются автоматически при загрузке товаров сделок. Bitrix ID фиксирует сопоставление
                с каталогом Битрикс24 — от него зависит определение «основной / кросс».
            </p>
            <div class="dm-add-form">
                <div class="dm-field-input">
                    <i class="fas fa-box"></i>
                    <input v-model="newProduct.name" placeholder="Название, например: КЦР" @keyup.enter="addProduct" />
                </div>
                <div class="dm-field-input" style="max-width: 190px;">
                    <i class="fas fa-hashtag"></i>
                    <input v-model.number="newProduct.bitrix_id" type="number" placeholder="Bitrix ID" />
                </div>
                <div class="dm-field-input" style="max-width: 190px;">
                    <i class="fas fa-layer-group"></i>
                    <input v-model="newProduct.product_group" placeholder="Группа" />
                </div>
                <button @click="addProduct" class="dm-btn-add"><i class="fas fa-plus"></i> Добавить</button>
            </div>
            <div class="dm-toolbar">
                <div class="dm-field-input dm-search">
                    <i class="fas fa-magnifying-glass"></i>
                    <input v-model="searchProducts" placeholder="Поиск по названию, группе, Bitrix ID…" />
                </div>
                <button @click="exportProducts" class="dm-btn-export" :disabled="filteredProducts.length === 0">
                    <i class="fas fa-file-export"></i> CSV
                </button>
            </div>
            <div class="dm-scroll">
                <table class="dm-table">
                    <thead>
                        <tr>
                            <th>ID</th><th>Название</th><th>Bitrix ID</th><th>Группа</th>
                            <th style="text-align: center;">Баз</th><th style="width: 150px;">Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="filteredProducts.length === 0"><td colspan="6" class="dm-empty">Продукты не найдены</td></tr>
                        <tr v-for="p in filteredProducts" :key="p.id">
                            <td class="dm-muted">{{ p.id }}</td>
                            <template v-if="editingProductId === p.id">
                                <td><div class="dm-field-input"><input v-model="editProduct.name" class="dm-inline-input" /></div></td>
                                <td><div class="dm-field-input" style="max-width: 120px;"><input v-model.number="editProduct.bitrix_id" type="number" class="dm-inline-input" /></div></td>
                                <td><div class="dm-field-input" style="max-width: 150px;"><input v-model="editProduct.product_group" class="dm-inline-input" /></div></td>
                                <td style="text-align: center;" class="dm-muted">{{ p.bases_count }}</td>
                                <td class="dm-actions">
                                    <button @click="saveProductEdit(p)" class="dm-btn-save"><i class="fas fa-floppy-disk"></i></button>
                                    <button @click="editingProductId = null" class="dm-btn-cancel"><i class="fas fa-xmark"></i></button>
                                </td>
                            </template>
                            <template v-else>
                                <td><strong>{{ p.name }}</strong></td>
                                <td class="dm-muted">{{ p.bitrix_id || '—' }}</td>
                                <td class="dm-muted">{{ p.product_group || '—' }}</td>
                                <td style="text-align: center;">
                                    <span v-if="p.bases_count" class="dm-badge ok">{{ p.bases_count }}</span>
                                    <span v-else class="dm-muted">0</span>
                                </td>
                                <td class="dm-actions">
                                    <button @click="startProductEdit(p)" class="dm-btn-icon" title="Редактировать">
                                        <i class="fas fa-pen"></i>
                                    </button>
                                    <button @click="openProductDeals(p)" class="dm-btn-icon" title="Продажи продукта по товарам">
                                        <i class="fas fa-cart-shopping"></i>
                                    </button>
                                    <button @click="deleteProduct(p)" class="dm-btn-del" title="Удалить">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </td>
                            </template>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div v-if="activeTab === 'segments'" class="dm-card">
            <h3><i class="fas fa-tags"></i> Сегменты</h3>
            <p class="dm-note">
                База определяется названием сегментации лида. При синхронизации сегментов базы создаются автоматически —
                останется назначить им основной продукт.
            </p>
            <div class="dm-add-form">
                <div class="dm-field-input">
                    <i class="fas fa-tag"></i>
                    <input v-model="newSegment.name" placeholder="Название сегмента" @keyup.enter="addSegment" />
                </div>
                <div class="dm-field-input" style="max-width: 170px;">
                    <i class="fas fa-circle-nodes"></i>
                    <select v-model="newSegment.entity">
                        <option value="lead">Лид</option>
                        <option value="deal">Сделка</option>
                        <option value="contact">Контакт</option>
                        <option value="company">Компания</option>
                    </select>
                </div>
                <button @click="addSegment" class="dm-btn-add"><i class="fas fa-plus"></i> Добавить</button>
                <button @click="refreshSegments" class="dm-btn-sync" :disabled="segmentsSyncLoading">
                    <i :class="segmentsSyncLoading ? 'fas fa-spinner fa-spin' : 'fas fa-arrows-rotate'"></i>
                    {{ segmentsSyncLoading ? 'Обновление…' : 'Обновить из Битрикс24' }}
                </button>
            </div>
            <div class="dm-toolbar">
                <div class="dm-field-input dm-search">
                    <i class="fas fa-magnifying-glass"></i>
                    <input v-model="searchSegments" placeholder="Поиск сегмента…" />
                </div>
            </div>
            <div class="dm-scroll">
                <table class="dm-table">
                    <thead>
                        <tr><th>ID</th><th>Название</th><th>Сущность</th><th>База</th><th style="width: 50px;"></th></tr>
                    </thead>
                    <tbody>
                        <tr v-if="filteredSegments.length === 0"><td colspan="5" class="dm-empty">Сегменты не найдены</td></tr>
                        <tr v-for="s in filteredSegments" :key="s.id">
                            <td class="dm-muted">{{ s.id }}</td>
                            <td><strong>{{ s.name }}</strong></td>
                            <td><span class="dm-badge gray">{{ entityLabel(s.entity) }}</span></td>
                            <td>
                                <span v-if="basesByName.has(s.name.trim().toLowerCase())" class="dm-badge ok">
                                    <i class="fas fa-check"></i> создана
                                </span>
                                <span v-else class="dm-muted">появится при синхронизации</span>
                            </td>
                            <td style="text-align: center;">
                                <button @click="deleteSegment(s)" class="dm-btn-del">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div v-if="activeTab === 'reasons'" class="dm-card">
            <h3><i class="fas fa-ban"></i> Причины отказов</h3>
            <p class="dm-note">
                Причины подтягиваются из полей лидов и названий провальных статусов автоматически. Переименование сохраняет связи с лидами.
            </p>
            <div class="dm-add-form">
                <div class="dm-field-input">
                    <i class="fas fa-comment-slash"></i>
                    <input v-model="newReasonName" placeholder="Например: Дорого" @keyup.enter="addReason" />
                </div>
                <button @click="addReason" class="dm-btn-add"><i class="fas fa-plus"></i> Добавить</button>
            </div>
            <div class="dm-toolbar">
                <div class="dm-field-input dm-search">
                    <i class="fas fa-magnifying-glass"></i>
                    <input v-model="searchReasons" placeholder="Поиск причины…" />
                </div>
            </div>
            <div class="dm-scroll">
                <table class="dm-table">
                    <thead><tr><th>ID</th><th>Причина</th><th style="width: 90px;"></th></tr></thead>
                    <tbody>
                        <tr v-if="filteredReasons.length === 0"><td colspan="3" class="dm-empty">Причины не найдены</td></tr>
                        <tr v-for="r in filteredReasons" :key="r.id">
                            <td class="dm-muted">{{ r.id }}</td>
                            <td>
                                <div v-if="editingReasonId === r.id" class="dm-field-input">
                                    <input v-model="editReasonName" class="dm-inline-input" @keyup.enter="saveReasonEdit(r)" />
                                </div>
                                <strong v-else>{{ r.name }}</strong>
                            </td>
                            <td class="dm-actions">
                                <template v-if="editingReasonId === r.id">
                                    <button @click="saveReasonEdit(r)" class="dm-btn-save"><i class="fas fa-floppy-disk"></i></button>
                                    <button @click="editingReasonId = null" class="dm-btn-cancel"><i class="fas fa-xmark"></i></button>
                                </template>
                                <template v-else>
                                    <button @click="editingReasonId = r.id; editReasonName = r.name" class="dm-btn-icon">
                                        <i class="fas fa-pen"></i>
                                    </button>
                                    <button @click="deleteReason(r)" class="dm-btn-del">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </template>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div v-if="activeTab === 'okved'" class="dm-card">
            <h3><i class="fas fa-industry"></i> Справочник ОКВЭД</h3>
            <p class="dm-note">
                Коды наполняются автоматически из Dadata при обогащении сделок по ИНН. Названия заполняются вручную —
                Dadata по ИНН отдаёт только код. Без названия аналитика показывает код.
            </p>
            <div class="dm-add-form">
            <div class="dm-field-input" style="max-width: 180px;">
                <i class="fas fa-hashtag"></i>
                <input v-model="newOkved.code" placeholder="Код, например: 62.01" @keyup.enter="addOkved" />
            </div>
            <div class="dm-field-input">
                <i class="fas fa-file-lines"></i>
                <input v-model="newOkved.name" placeholder="Название вида деятельности" @keyup.enter="addOkved" />
            </div>
            <button @click="addOkved" class="dm-btn-add"><i class="fas fa-floppy-disk"></i> Сохранить</button>
            <button @click="loadOkvedNames" class="dm-btn-sync" :disabled="okvedLoading">
                <i :class="okvedLoading ? 'fas fa-spinner fa-spin' : 'fas fa-cloud-arrow-down'"></i>
                {{ okvedLoading ? 'Загрузка…' : 'Загрузить названия из справочника' }}
            </button>
            </div>
            <div class="dm-toolbar">
                <div class="dm-field-input dm-search">
                    <i class="fas fa-magnifying-glass"></i>
                    <input v-model="searchOkved" placeholder="Поиск по коду или названию…" />
                </div>
                <span v-if="okvedWithoutName > 0" class="dm-badge warn">
                    <i class="fas fa-triangle-exclamation"></i> {{ okvedWithoutName }} кодов без названия
                </span>
                <button @click="exportOkved" class="dm-btn-export" :disabled="filteredOkved.length === 0">
                    <i class="fas fa-file-export"></i> CSV
                </button>
            </div>
            <div class="dm-scroll dm-scroll-420">
                <table class="dm-table">
                    <thead><tr><th style="width: 120px;">Код</th><th>Название</th><th style="width: 50px;"></th></tr></thead>
                    <tbody>
                        <tr v-if="filteredOkved.length === 0"><td colspan="3" class="dm-empty">Коды не найдены</td></tr>
                        <tr v-for="o in filteredOkved" :key="o.code">
                            <td><span class="dm-badge purple">{{ o.code }}</span></td>
                            <td>
                                <div v-if="editingOkvedCode === o.code" class="dm-field-input">
                                    <input v-model="editOkvedName" class="dm-inline-input" @keyup.enter="saveOkvedEdit(o)" />
                                </div>
                                <span v-else-if="o.name">{{ o.name }}</span>
                                <span v-else class="dm-muted">— заполните название</span>
                            </td>
                            <td class="dm-actions">
                                <template v-if="editingOkvedCode === o.code">
                                    <button @click="saveOkvedEdit(o)" class="dm-btn-save"><i class="fas fa-floppy-disk"></i></button>
                                    <button @click="editingOkvedCode = null" class="dm-btn-cancel"><i class="fas fa-xmark"></i></button>
                                </template>
                                <template v-else>
                                    <button @click="editingOkvedCode = o.code; editOkvedName = o.name || ''" class="dm-btn-icon">
                                        <i class="fas fa-pen"></i>
                                    </button>
                                    <button @click="deleteOkved(o)" class="dm-btn-del">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </template>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div v-if="activeTab === 'rules'" class="dm-card dm-card-constructor">
            <h3><i class="fas fa-sliders"></i> Конструктор конверсий по базам</h3>
            <p class="dm-note">
                Правило задаёт числитель, знаменатель, способ подсчёта и фильтры для базы. Версия сохраняется
                при каждом изменении. Несовместимые единицы смешивать нельзя.
            </p>
            <div class="dm-constructor">
                <label class="dm-field">
                    <span class="dm-field-label">База (срез)</span>
                    <div class="dm-field-input">
                        <i class="fas fa-folder-tree"></i>
                        <select v-model="newRule.base_id">
                            <option value="" disabled>Выберите базу</option>
                            <option v-for="b in bases" :key="b.id" :value="b.id">{{ b.name }}</option>
                        </select>
                    </div>
                </label>
                <label class="dm-field">
                    <span class="dm-field-label">Целевое событие (числитель)</span>
                    <div class="dm-field-input">
                        <i class="fas fa-bullseye"></i>
                        <select v-model="newRule.numerator">
                            <option value="quality_leads">Качественные лиды</option>
                            <option value="paid_deals">Оплаты (сделки)</option>
                            <option value="transfers">Передачи в корп</option>
                        </select>
                    </div>
                </label>
                <label class="dm-field">
                    <span class="dm-field-label">Исходная совокупность (знаменатель)</span>
                    <div class="dm-field-input">
                        <i class="fas fa-layer-group"></i>
                        <select v-model="newRule.denominator">
                            <option value="unique_leads">Взятые в работу лиды</option>
                            <option value="quality_leads">Качественные лиды</option>
                            <option value="total_calls">Все наборы (звонки)</option>
                            <option value="valid_conversations">Разговоры</option>
                        </select>
                    </div>
                </label>
                <label class="dm-field">
                    <span class="dm-field-label">Способ подсчёта</span>
                    <div class="dm-field-input">
                        <i class="fas fa-calculator"></i>
                        <select v-model="newRule.calc_type">
                            <option value="уникальные лиды">Уникальные лиды</option>
                            <option value="события">События</option>
                            <option value="сделки">Сделки</option>
                        </select>
                    </div>
                </label>
                <label class="dm-field">
                    <span class="dm-field-label">Продукт</span>
                    <div class="dm-field-input">
                        <i class="fas fa-box"></i>
                        <select v-model="newRule.product_type">
                            <option value="all">Любой</option>
                            <option value="main">Только основной</option>
                            <option value="cross">Только кросс</option>
                        </select>
                    </div>
                </label>
                <label class="dm-field">
                    <span class="dm-field-label">Цикл работы</span>
                    <div class="dm-field-input">
                        <i class="fas fa-rotate"></i>
                        <select v-model="newRule.cycle_type">
                            <option value="all">Все циклы</option>
                            <option value="primary">Только первичный</option>
                            <option value="return">Возврат / догрев</option>
                        </select>
                    </div>
                </label>
                <label class="dm-field">
                    <span class="dm-field-label">Доп. исключаемые статусы</span>
                    <div class="dm-field-input">
                        <i class="fas fa-filter"></i>
                        <input v-model="extraStatuses" placeholder="Коды через запятую, напр. NEW" />
                    </div>
                </label>
            </div>

            <div class="dm-formula" :class="{ invalid: compatibilityError }">
                <div class="dm-formula-line">
                    <strong>Формула:</strong>
                    {{ vocab[newRule.numerator] }} / {{ vocab[newRule.denominator] }} × 100%
                    <span class="dm-formula-filters">
                        · {{ translateFilter(newRule.product_type) }} продукт
                        · {{ translateFilter(newRule.cycle_type) }} цикл
                        · {{ newRule.calc_type }}
                    </span>
                </div>
                <div v-if="compatibilityError" class="dm-formula-error">
                    <i class="fas fa-circle-exclamation"></i> {{ compatibilityError }}
                </div>
            </div>

            <div class="dm-mandatory">
                <i class="fas fa-lock"></i>
                <div>
                    <strong>Обязательное исключение:</strong> «Импорт / Поступило» всегда исключается из знаменателя.
                    Дополнительные статусы: {{ excludedPreview.join(', ') }}.
                </div>
            </div>

            <div class="dm-constructor-actions">
                <button @click="saveRule" class="dm-btn-save-rule" :disabled="!!compatibilityError || !newRule.base_id">
                    <i class="fas fa-floppy-disk"></i>
                    {{ editingRuleId ? `Обновить правило (станет v.${(rulesByBase[newRule.base_id]?.version || 0) + 1})` : 'Сохранить правило' }}
                </button>
                <button v-if="editingRuleId" @click="resetRuleForm" class="dm-btn-cancel-rule">
                    <i class="fas fa-xmark"></i> Отменить редактирование
                </button>
            </div>

            <div class="dm-scroll" style="margin-top: 20px;">
                <table class="dm-table">
                    <thead>
                        <tr>
                            <th>База</th><th>Формула</th><th>Продукт</th><th>Цикл</th>
                            <th>Исключения</th><th style="text-align: center;">Версия</th><th style="width: 90px;"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="rules.length === 0"><td colspan="7" class="dm-empty">Правила не настроены — расчёт идёт по умолчанию</td></tr>
                        <tr v-for="rule in rules" :key="rule.id">
                            <td><strong>{{ rule.base_name }}</strong></td>
                            <td>{{ vocab[rule.numerator] || rule.numerator }} <strong>/</strong> {{ vocab[rule.denominator] || rule.denominator }}</td>
                            <td class="dm-muted">{{ translateFilter(rule.product_type) }}</td>
                            <td class="dm-muted">{{ translateFilter(rule.cycle_type) }}</td>
                            <td class="dm-muted">{{ parseExcluded(rule.excluded_statuses) }}</td>
                            <td style="text-align: center;"><span class="dm-badge purple">v.{{ rule.version }}</span></td>
                            <td class="dm-actions">
                                <button @click="editRule(rule)" class="dm-btn-icon" title="Редактировать">
                                    <i class="fas fa-pen"></i>
                                </button>
                                <button @click="deleteRule(rule)" class="dm-btn-del" title="Удалить">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div v-if="showProductDeals" class="dm-overlay" @click.self="showProductDeals = false">
            <div class="dm-modal">
                <div class="dm-modal-head">
                    <h3>Продажи продукта: <span class="green">{{ selectedProduct?.name }}</span></h3>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button @click="exportProductDeals" class="dm-btn-export" :disabled="productDeals.length === 0">
                            <i class="fas fa-file-export"></i> CSV
                        </button>
                        <button @click="showProductDeals = false" class="dm-btn-close"><i class="fas fa-xmark"></i></button>
                    </div>
                </div>
                <div class="dm-modal-body">
                    <div v-if="productDealsLoading" class="dm-empty">Загрузка товарных строк…</div>
                    <template v-else>
                        <p class="dm-note">
                            Строки из товаров сделок (до 200). «Кросс» — товар отличен от основного продукта базы сделки.
                        </p>
                        <div class="dm-scroll">
                            <table class="dm-table">
                                <thead>
                                    <tr>
                                        <th>Сделка</th><th>Дата</th><th>Компания</th><th>База</th><th>Менеджер</th>
                                        <th>Товар</th>
                                        <th style="text-align: right;">Кол-во</th>
                                        <th style="text-align: right;">Цена</th>
                                        <th style="text-align: right;">Сумма строки</th>
                                        <th style="text-align: center;">Тип</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-if="productDeals.length === 0"><td colspan="10" class="dm-empty">Продажи по этому продукту не найдены</td></tr>
                                    <tr v-for="(d, idx) in productDeals" :key="idx">
                                        <td>
                                            <a v-if="b24Link(d.bitrix_deal_id)" :href="b24Link(d.bitrix_deal_id)" target="_blank" rel="noopener" class="dm-id dm-id-link">#{{ d.bitrix_deal_id }}</a>
                                            <span v-else class="dm-id">#{{ d.bitrix_deal_id }}</span>
                                        </td>
                                        <td>{{ formatDate(d.created_at) }}</td>
                                        <td class="dm-goods" :title="d.company_title">{{ d.company_title || '—' }}</td>
                                        <td>{{ d.base_name || 'Без базы' }}</td>
                                        <td>{{ d.manager_name }}</td>
                                        <td class="dm-goods" :title="d.product_name">{{ d.product_name }}</td>
                                        <td style="text-align: right;">{{ d.quantity }}</td>
                                        <td style="text-align: right;">{{ money(d.price) }}</td>
                                        <td style="text-align: right; font-weight: bold;">{{ money(d.row_sum) }} ₽</td>
                                        <td style="text-align: center;">
                                            <span v-if="d.row_cross" class="dm-badge warn">кросс</span>
                                            <span v-else class="dm-badge ok">основной</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </template>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.dm { width: 100%; font-family: var(--font, Arial, sans-serif); }
.dm-header { display: flex; justify-content: space-between; align-items: center; gap: 15px; flex-wrap: wrap; border-bottom: 2px solid #f0f2f8; padding-bottom: 15px; margin-bottom: 18px; }
.dm-header h2 { display: flex; align-items: center; gap: 11px; margin: 0 0 5px; font-size: 24px; color: var(--text, #182338); }
.dm-header h2 i { color: var(--accent, #4c6fff); }
.dm-header p { margin: 0; color: var(--text-muted, #68758c); font-size: 13px; }
.dm-toast { display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 10px; font-size: 13px; font-weight: 600; max-width: 420px; }
.dm-toast.success { background: #e7f7ef; color: var(--success, #0fa968); border: 1px solid #b8e6cf; }
.dm-toast.error { background: #fdecec; color: var(--danger, #e5484d); border: 1px solid #f8c9cb; }
.dm-info { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 15px; }
.dm-info-chip { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; padding: 7px 12px; border-radius: 8px; border: none; cursor: pointer; font-family: inherit; }
.dm-info-chip.warn { background: #fff8ec; color: #c05621; border: 1px solid #f7dcae; }
.dm-info-chip.ok { background: #e7f7ef; color: var(--success, #0fa968); border: 1px solid #b8e6cf; cursor: default; }
.dm-btn-sm { background: var(--warning, #f5a524); color: #fff; border: none; padding: 7px 12px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 12px; display: inline-flex; align-items: center; gap: 7px; font-family: inherit; }
.dm-btn-sm:hover:not(:disabled) { filter: brightness(1.08); }
.dm-btn-sm:disabled { background: #b9c0cc; cursor: not-allowed; }

.dm-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
.dm-tab { display: inline-flex; align-items: center; gap: 9px; background: var(--surface, #fff); border: 1px solid var(--border, #e4e9f2); padding: 10px 16px; border-radius: 10px; cursor: pointer; font-weight: 600; color: var(--text-muted, #68758c); font-size: 13px; font-family: inherit; transition: all .18s; }
.dm-tab:hover { background: #f0f4f8; color: var(--text, #182338); }
.dm-tab.active { background: linear-gradient(135deg, var(--accent, #4c6fff), var(--accent-hover, #3a59e8)); color: #fff; border-color: transparent; box-shadow: 0 4px 12px rgba(76,111,255,.3); }
.dm-tab-count { background: rgba(0,0,0,.08); padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.dm-tab.active .dm-tab-count { background: rgba(255,255,255,.25); }

.dm-card { background: var(--surface, #fff); padding: 22px 24px; border-radius: 16px; border: 1px solid var(--border, #e4e9f2); box-shadow: var(--shadow-card, 0 4px 24px rgba(24,35,56,.07)); }
.dm-card h3 { display: flex; align-items: center; gap: 10px; margin: 0 0 8px; color: var(--text, #182338); font-size: 17px; }
.dm-card h3 i { color: var(--accent, #4c6fff); }
.dm-card-constructor { border-top: 4px solid #9b59b6; }
.dm-note { font-size: 12px; color: var(--text-muted, #68758c); line-height: 1.5; margin: 0 0 15px; }

.dm-add-form { display: flex; gap: 8px; margin-bottom: 15px; flex-wrap: wrap; }
.dm-toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.dm-field-input { display: flex; align-items: center; gap: 10px; background: var(--surface, #fff); border: 1px solid var(--border, #e4e9f2); border-radius: 10px; padding: 0 14px; height: 44px; transition: border-color .18s, box-shadow .18s; flex: 1; min-width: 140px; }
.dm-field-input:focus-within { border-color: var(--accent, #4c6fff); box-shadow: 0 0 0 3px rgba(76,111,255,.15); }
.dm-field-input > i { color: var(--text-muted, #68758c); font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }
.dm-field-input input, .dm-field-input select { flex: 1; border: none; outline: none; background: transparent; font-size: 14px; color: var(--text, #182338); font-family: inherit; min-width: 0; padding: 0; width: 100%; }
.dm-search { min-width: 220px; max-width: 420px; }
.dm-inline-input { border: none; outline: none; background: transparent; font-size: 14px; color: var(--text, #182338); font-family: inherit; width: 100%; padding: 0; }

.dm-btn-add { background: linear-gradient(135deg, var(--success, #0fa968), #0d9460); color: #fff; border: none; padding: 0 16px; height: 44px; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 13px; display: inline-flex; align-items: center; gap: 7px; font-family: inherit; white-space: nowrap; box-shadow: 0 4px 12px rgba(15,169,104,.3); }
.dm-btn-add:hover { filter: brightness(1.06); }
.dm-btn-sync { background: linear-gradient(135deg, var(--accent, #4c6fff), var(--accent-hover, #3a59e8)); color: #fff; border: none; padding: 0 14px; height: 44px; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 13px; display: inline-flex; align-items: center; gap: 7px; font-family: inherit; white-space: nowrap; }
.dm-btn-sync:hover:not(:disabled) { filter: brightness(1.06); }
.dm-btn-sync:disabled { background: #b9c0cc; cursor: not-allowed; }
.dm-btn-export { padding: 0 12px; height: 38px; background: linear-gradient(135deg, var(--success, #0fa968), #0d9460); color: #fff; border: none; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 12px; display: inline-flex; align-items: center; gap: 7px; font-family: inherit; }
.dm-btn-export:hover:not(:disabled) { filter: brightness(1.06); }
.dm-btn-export:disabled { background: #b9c0cc; cursor: not-allowed; }
.dm-btn-icon { background: #f4f6fb; border: 1px solid var(--border, #e4e9f2); border-radius: 8px; padding: 6px 9px; cursor: pointer; color: var(--text-muted, #68758c); font-size: 12px; }
.dm-btn-icon:hover { color: var(--accent, #4c6fff); border-color: var(--accent, #4c6fff); background: var(--accent-soft, #eef2ff); }
.dm-btn-save { background: var(--success, #0fa968); color: #fff; border: none; border-radius: 8px; padding: 6px 9px; cursor: pointer; font-size: 12px; }
.dm-btn-cancel { background: #95a5a6; color: #fff; border: none; border-radius: 8px; padding: 6px 9px; cursor: pointer; font-size: 12px; }
.dm-btn-del { background: var(--danger, #e5484d); color: #fff; border: none; border-radius: 8px; padding: 6px 9px; cursor: pointer; font-size: 12px; }
.dm-btn-del:hover { background: #c93a3f; }

.dm-scroll { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.dm-scroll-420 { max-height: 420px; overflow-y: auto; }
.dm-scroll::-webkit-scrollbar { width: 9px; height: 9px; }
.dm-scroll::-webkit-scrollbar-track { background: #f0f2f5; border-radius: 5px; }
.dm-scroll::-webkit-scrollbar-thumb { background: #c2cbdc; border-radius: 5px; }
.dm-scroll::-webkit-scrollbar-thumb:hover { background: #a7b2c6; }
.dm-table { width: 100%; border-collapse: collapse; min-width: 560px; }
.dm-table th, .dm-table td { padding: 11px 12px; border-bottom: 1px solid #eef1f6; text-align: left; font-size: 13px; color: var(--text, #182338); white-space: nowrap; }
.dm-table th { background: #f6f8fc; color: var(--text-muted, #68758c); font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; position: sticky; top: 0; z-index: 2; }
.dm-table tbody tr { transition: background .15s; }
.dm-table tbody tr:hover { background: #f6f8fd; }
.dm-empty { text-align: center; color: var(--text-muted, #68758c); padding: 22px !important; }
.dm-muted { color: var(--text-muted, #68758c); }
.dm-actions { display: flex; gap: 6px; align-items: center; }

.dm-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 6px; font-weight: 600; font-size: 11px; line-height: 1.5; }
.dm-badge.ok { background: #e7f7ef; color: var(--success, #0fa968); border: 1px solid #b8e6cf; }
.dm-badge.warn { background: #fff4e5; color: #c05621; border: 1px solid #fad7a0; }
.dm-badge.purple { background: #f4ecf7; color: #7d3c98; border: 1px solid #d7bde2; }
.dm-badge.gray { background: #f4f6fb; color: var(--text, #182338); border: 1px solid var(--border, #e4e9f2); }

.dm-inline-select { padding: 7px 10px; border: 1px solid var(--border, #e4e9f2); border-radius: 8px; font-size: 13px; background: var(--surface, #fff); color: var(--text, #182338); outline: none; min-width: 200px; cursor: pointer; font-family: inherit; }
.dm-inline-select:focus { border-color: var(--accent, #4c6fff); box-shadow: 0 0 0 3px rgba(76,111,255,.15); }

.dm-constructor { display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap; background: #fdfdff; padding: 18px; border-radius: 12px; border: 1px solid var(--border, #e4e9f2); margin-bottom: 15px; }
.dm-field { flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 7px; }
.dm-field-label { font-size: 11px; font-weight: 700; color: var(--text, #182338); text-transform: uppercase; letter-spacing: .04em; }
.dm-formula { background: #f8f9fc; border: 1px solid var(--border, #e4e9f2); border-left: 4px solid #9b59b6; border-radius: 10px; padding: 12px 16px; margin-bottom: 12px; font-size: 13px; color: var(--text, #182338); }
.dm-formula.invalid { border-left-color: var(--danger, #e5484d); background: #fdecec; }
.dm-formula-line { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
.dm-formula-filters { color: var(--text-muted, #68758c); font-size: 12px; }
.dm-formula-error { margin-top: 8px; color: var(--danger, #e5484d); font-weight: 600; font-size: 12px; display: flex; align-items: center; gap: 7px; }
.dm-mandatory { background: #fff8ec; border: 1px solid #f7dcae; padding: 12px 15px; border-radius: 10px; font-size: 13px; color: #c05621; display: flex; align-items: flex-start; gap: 10px; margin-bottom: 15px; }
.dm-mandatory i { color: var(--warning, #f5a524); margin-top: 2px; }
.dm-constructor-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.dm-btn-save-rule { background: linear-gradient(135deg, #9b59b6, #8e44ad); color: #fff; border: none; padding: 12px 22px; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 14px; display: inline-flex; align-items: center; gap: 9px; font-family: inherit; box-shadow: 0 4px 12px rgba(155,89,182,.3); }
.dm-btn-save-rule:hover:not(:disabled) { filter: brightness(1.06); }
.dm-btn-save-rule:disabled { background: #b9c0cc; box-shadow: none; cursor: not-allowed; }
.dm-btn-cancel-rule { background: #f4f6fb; color: var(--text, #182338); border: 1px solid var(--border, #e4e9f2); padding: 12px 18px; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 13px; display: inline-flex; align-items: center; gap: 8px; font-family: inherit; }
.dm-btn-cancel-rule:hover { background: #e8ecf3; }

.dm-overlay { position: fixed; inset: 0; background: rgba(12,18,34,.55); backdrop-filter: blur(3px); display: flex; justify-content: center; align-items: center; z-index: 1000; padding: 20px; }
.dm-modal { background: var(--surface, #fff); border-radius: 18px; width: 100%; max-width: 1150px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 24px 60px rgba(5,10,25,.35); }
.dm-modal-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid var(--border, #e4e9f2); }
.dm-modal-head h3 { margin: 0; font-size: 17px; }
.dm-btn-close { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--text-muted, #68758c); }
.dm-btn-close:hover { color: var(--danger, #e5484d); }
.dm-modal-body { padding: 20px; overflow-y: auto; }

.dm-id { background: var(--accent-soft, #eef2ff); color: var(--accent, #4c6fff); padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 12px; display: inline-block; }
.dm-id-link { text-decoration: none; border: 1px solid #dfe5ff; }
.dm-id-link:hover { background: var(--accent, #4c6fff); color: #fff; }
.dm-goods { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.green { color: var(--success, #0fa968); }

@media (max-width: 768px) {
    .dm-field, .dm-add-form > * { min-width: 100%; }
    .dm-search { max-width: 100%; }
}
</style>