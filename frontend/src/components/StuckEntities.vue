<template>
    <div class="stuck-entities">
        <div class="header-row">
            <div>
                <h2 style="margin: 0; color: #2c3e50;">⏳ Зависшие сделки и лиды</h2>
                <p class="subtitle">
                    Карточки в работе без движения дольше заданного срока. Товары и ОКВЭД — из локальной базы дашборда.
                </p>
            </div>
            <div class="header-actions">
                <div class="entity-toggle">
                    <button @click="setEntity('deals')" :class="['toggle-btn', { active: filters.entity === 'deals' }]">
                        💼 Сделки
                    </button>
                    <button @click="setEntity('leads')" :class="['toggle-btn', { active: filters.entity === 'leads' }]">
                        🎯 Лиды
                    </button>
                </div>
                <button @click="showSettings = !showSettings" class="btn-settings">⚙️ Портал</button>
            </div>
        </div>

        <div v-if="showSettings" class="settings-card">
            <label class="settings-label">Адрес портала Битрикс24 для ссылок на карточки</label>
            <div class="settings-row">
                <input v-model="portalUrl" placeholder="https://yourcompany.bitrix24.ru" class="filter-input" />
                <button @click="savePortal" class="btn-save">Сохранить</button>
            </div>
            <small class="settings-hint">
                Задаётся отдельно от адреса Chatium API и хранится в браузере. Без него ID показывается без ссылки.
            </small>
        </div>

        <div class="filters-card">
            <div class="filter-group" style="max-width: 150px;">
                <label>Без движения от (дней)</label>
                <input type="number" v-model.number="filters.days" min="1" max="365" @change="loadStuck" class="filter-input" />
            </div>
            <div class="filter-group">
                <label>Отдел (команда)</label>
                <select v-model="filters.department_id" @change="loadStuck" class="filter-input">
                    <option value="">Все отделы</option>
                    <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Менеджер</label>
                <select v-model="filters.manager_id" @change="loadStuck" class="filter-input">
                    <option value="">Все менеджеры</option>
                    <option v-for="m in managers" :key="m.id" :value="m.bitrix_id">{{ m.login }}</option>
                </select>
            </div>
            <div class="filter-group">
                <label>База</label>
                <select v-model="filters.base_id" @change="loadStuck" class="filter-input">
                    <option value="">Все базы</option>
                    <option v-for="b in bases" :key="b.id" :value="b.id">{{ b.name }}</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Основной продукт базы</label>
                <select v-model="filters.product_id" @change="loadStuck" class="filter-input">
                    <option value="">Все продукты</option>
                    <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
            </div>
            <div class="filter-group">
                <label>ОКВЭД</label>
                <select v-model="filters.okved" @change="loadStuck" class="filter-input">
                    <option value="">Все ОКВЭД</option>
                    <option v-for="o in okvedList" :key="o.code" :value="o.code">
                        {{ o.code }}{{ o.name ? ' — ' + o.name : '' }}
                    </option>
                </select>
            </div>
            <div class="filter-group" style="max-width: 130px;">
                <label>Показать строк</label>
                <select v-model.number="filters.limit" @change="loadStuck" class="filter-input">
                    <option :value="200">200</option>
                    <option :value="500">500</option>
                    <option :value="1000">1000</option>
                </select>
            </div>
            <div class="filter-group filter-actions">
                <label v-if="filters.entity === 'deals'" class="cross-checkbox">
                    <input type="checkbox" v-model="filters.cross_only" @change="loadStuck" />
                    <span>Только кросс</span>
                </label>
                <div class="export-buttons">
                    <button @click="exportCSV(true)" class="btn-export" :disabled="loading || filteredItems.length === 0">
                        📥 CSV ({{ filteredItems.length }})
                    </button>
                    <button @click="exportCSV(false)" class="btn-export-ids" :disabled="loading || filteredItems.length === 0">
                        Только ID
                    </button>
                </div>
            </div>
        </div>

        <div v-if="error" class="error-banner">{{ error }}</div>

        <div v-if="filters.entity === 'deals' && notLoadedCount > 0" class="warn-banner">
            <div>
                <strong>Товары ещё не загружены у {{ notLoadedCount }} сделок.</strong>
                <span class="warn-sub">
                    Кросс-продажи по ним не определены: данные не подменяются нулём. Догрузка идёт порциями при синхронизации.
                </span>
            </div>
            <button @click="triggerProductsSync" class="btn-warn" :disabled="syncLoading">
                {{ syncLoading ? 'Догрузка запущена…' : 'Догрузить товары сейчас' }}
            </button>
        </div>
        <div v-if="syncMessage" class="sync-message">{{ syncMessage }}</div>

        <div class="card">
            <div class="table-toolbar">
                <input v-model="search" placeholder="Поиск по ID, компании, ИНН, менеджеру, базе, товару…" class="filter-input search-input" />
                <div class="stats-line">
                    Найдено: <strong>{{ filteredItems.length }}</strong>
                    <span v-if="filters.entity === 'deals'"> · Кросс-продаж: <strong>{{ crossCount }}</strong></span>
                </div>
            </div>

            <div v-if="loading" class="empty">Поиск зависших карточек…</div>
            <div v-else class="table-responsive">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>База</th>
                            <th>Осн. продукт</th>
                            <th>Товары сделки</th>
                            <th>ОКВЭД</th>
                            <th>Компания / ИНН</th>
                            <th>Ответственный</th>
                            <th>Отдел</th>
                            <th>Стадия / Статус</th>
                            <th>Последний контакт</th>
                            <th style="text-align: center;">Простой</th>
                            <th v-if="filters.entity === 'deals'" style="text-align: right;">Сумма</th>
                            <th v-else style="text-align: center;">Сделок</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-if="filteredItems.length === 0">
                            <td colspan="12" class="empty">
                                Зависших карточек по выбранным фильтрам нет 🎉
                            </td>
                        </tr>
                        <tr v-for="item in filteredItems" :key="item.entity_type + '-' + item.id">
                            <td>
                                <a v-if="b24Link(item)" :href="b24Link(item)" target="_blank" rel="noopener"
                                   class="id-badge id-link" title="Открыть в Битрикс24">#{{ item.id }}</a>
                                <span v-else class="id-badge">#{{ item.id }}</span>
                            </td>
                            <td><strong>{{ item.base_name }}</strong></td>
                            <td>{{ item.product_name }}</td>
                            <td class="goods-cell">
                                <span v-if="item.entity_type === 'deal'" class="goods-link"
                                      :title="item.products_list" @click="openProducts(item)">
                                    {{ item.products_list || '—' }}
                                </span>
                                <span v-else :title="item.products_list">{{ item.products_list || '—' }}</span>
                                <span v-if="item.is_cross_sale" class="cross-badge">кросс</span>
                            </td>
                            <td>
                                <span v-if="item.okved" class="okved-badge">{{ item.okved }}</span>
                                <span v-else class="muted">не указан</span>
                            </td>
                            <td class="company-cell">
                                <div class="company-name" :title="item.company_title">{{ item.company_title || '—' }}</div>
                                <div class="inn">{{ item.inn || 'ИНН не указан' }}</div>
                            </td>
                            <td>{{ item.manager_name }}</td>
                            <td><span class="dept-badge">{{ item.department_name }}</span></td>
                            <td>
                                <div>{{ item.stage }}</div>
                                <div v-if="item.category_name" class="category">{{ item.category_name }}</div>
                            </td>
                            <td>{{ formatDate(item.last_contact_at) }}</td>
                            <td style="text-align: center;">
                                <span :class="['days-badge', getDaysSeverity(item.days_stuck)]">
                                    {{ item.days_stuck }} дн.
                                </span>
                            </td>
                            <td v-if="filters.entity === 'deals'" style="text-align: right; font-weight: bold; color: #27ae60;">
                                {{ item.amount ? item.amount.toLocaleString('ru-RU') + ' ₽' : '—' }}
                            </td>
                            <td v-else style="text-align: center; font-weight: bold; color: #2980b9;">
                                {{ item.deals_count || 0 }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <p class="note">
                Дата последнего контакта берётся из <code>lastActivityAt</code> карточки (источник согласуется с Виталием).
                Поле «причина зависания» в CRM не фиксируется — показатель недоступен и не подменяется пустым значением.
            </p>
        </div>

        <div v-if="showProductsModal" class="modal-overlay" @click.self="showProductsModal = false">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 style="margin: 0;">
                        Товары сделки <span style="color: #2980b9;">#{{ productDeal?.bitrix_deal_id }}</span>
                    </h3>
                    <button @click="showProductsModal = false" class="btn-close">✖</button>
                </div>
                <div class="modal-body">
                    <div v-if="productsLoading" class="empty">Загрузка товарных позиций…</div>
                    <template v-else>
                        <div class="deal-info">
                            <div><span class="info-label">Компания:</span> <strong>{{ productDeal?.company_title || '—' }}</strong></div>
                            <div><span class="info-label">ИНН:</span> {{ productDeal?.inn || '—' }}</div>
                            <div><span class="info-label">ОКВЭД:</span> {{ productDeal?.okved || 'не указан' }}</div>
                            <div><span class="info-label">База:</span> {{ productDeal?.base_name || 'Без базы' }}</div>
                            <div><span class="info-label">Осн. продукт базы:</span> {{ productDeal?.main_product_name || 'не назначен' }}</div>
                            <div><span class="info-label">Стадия:</span> {{ productDeal?.stage_name || '—' }}</div>
                            <div><span class="info-label">Поле «Продукт» в CRM:</span> {{ productDeal?.product_field || '—' }}</div>
                            <div><span class="info-label">Сумма сделки:</span>
                                <strong style="color: #27ae60;">{{ (productDeal?.amount || 0).toLocaleString('ru-RU') }} ₽</strong>
                            </div>
                        </div>

                        <div v-if="fieldMismatch" class="modal-warn">
                            ⚠️ Расхождение: поле «Продукт» в CRM не совпадает с фактическими товарами.
                            Кросс-продажа определяется по товарам.
                        </div>
                        <div v-if="!productDeal?.main_product_name" class="modal-warn">
                            ⚠️ У базы не назначен основной продукт — кросс-продажи по этой сделке не определяются.
                            Назначьте продукт в справочнике баз.
                        </div>

                        <div class="table-responsive">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Товар</th>
                                        <th>Группа</th>
                                        <th style="text-align: right;">Кол-во</th>
                                        <th style="text-align: right;">Цена</th>
                                        <th style="text-align: right;">Сумма</th>
                                        <th style="text-align: center;">Тип</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-if="productRows.length === 0">
                                        <td colspan="6" class="empty">Товарные позиции не загружены или отсутствуют</td>
                                    </tr>
                                    <tr v-for="(r, idx) in productRows" :key="r.bitrix_row_id || idx">
                                        <td><strong>{{ r.product_name }}</strong></td>
                                        <td class="muted">{{ r.product_group || '—' }}</td>
                                        <td style="text-align: right;">{{ r.quantity }}</td>
                                        <td style="text-align: right;">{{ (r.price || 0).toLocaleString('ru-RU') }}</td>
                                        <td style="text-align: right; font-weight: bold;">{{ (r.sum || 0).toLocaleString('ru-RU') }} {{ r.currency || 'RUB' }}</td>
                                        <td style="text-align: center;">
                                            <span v-if="r.is_cross_sale" class="cross-badge">кросс</span>
                                            <span v-else class="main-badge">основной</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <div class="totals">
                            <span>Сумма товарных строк: <strong>{{ rowsTotal.toLocaleString('ru-RU') }} ₽</strong></span>
                            <span v-if="Math.abs(amountDiff) > 1" class="diff-warn">
                                Расхождение с суммой сделки: {{ amountDiff.toLocaleString('ru-RU') }} ₽
                            </span>
                            <span v-else class="diff-ok">Суммы сходятся</span>
                        </div>
                    </template>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';

const API = 'http://localhost:3000/api';

const items = ref<any[]>([]);
const departments = ref<any[]>([]);
const managers = ref<any[]>([]);
const bases = ref<any[]>([]);
const products = ref<any[]>([]);
const okvedList = ref<any[]>([]);
const loading = ref(false);
const error = ref('');
const search = ref('');
const portalUrl = ref(localStorage.getItem('b24_portal_url') || '');
const showSettings = ref(false);
const syncLoading = ref(false);
const syncMessage = ref('');

const filters = reactive({
    entity: 'deals' as 'deals' | 'leads',
    days: 7,
    department_id: '',
    manager_id: '',
    base_id: '',
    product_id: '',
    okved: '',
    cross_only: false,
    limit: 200
});

const showProductsModal = ref(false);
const productsLoading = ref(false);
const productDeal = ref<any>(null);
const productRows = ref<any[]>([]);

const filteredItems = computed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return items.value;
    return items.value.filter(i =>
        [i.id, i.company_title, i.inn, i.manager_name, i.base_name, i.products_list, i.product_name, i.okved, i.stage]
            .some(v => String(v ?? '').toLowerCase().includes(q))
    );
});

const crossCount = computed(() => filteredItems.value.filter(i => i.is_cross_sale).length);
const notLoadedCount = computed(() => items.value.filter(i => i.products_list === 'Не загружены').length);

const rowsTotal = computed(() => productRows.value.reduce((s, r) => s + (r.sum || 0), 0));
const amountDiff = computed(() =>
    productDeal.value ? Math.round(((productDeal.value.amount || 0) - rowsTotal.value) * 100) / 100 : 0
);
const normName = (s: string) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
const fieldMismatch = computed(() => {
    const d = productDeal.value;
    if (!d?.product_field || !d?.products_list) return false;
    return !normName(d.products_list).includes(normName(d.product_field));
});

const setEntity = (entity: 'deals' | 'leads') => {
    filters.entity = entity;
    if (entity === 'leads') filters.cross_only = false;
    loadStuck();
};

const savePortal = () => {
    portalUrl.value = portalUrl.value.trim().replace(/\/+$/, '');
    localStorage.setItem('b24_portal_url', portalUrl.value);
    showSettings.value = false;
};

const b24Link = (item: any): string => {
    const base = portalUrl.value.trim().replace(/\/+$/, '');
    if (!base) return '';
    const type = item.entity_type === 'deal' ? 'deal' : 'lead';
    return `${base}/crm/${type}/details/${item.id}/`;
};

const loadDictionaries = async () => {
    try {
        const [resDepts, resUsers, resBases, resProducts, resOkved] = await Promise.all([
            fetch(`${API}/departments`),
            fetch(`${API}/users`),
            fetch(`${API}/bases`),
            fetch(`${API}/products`),
            fetch(`${API}/okved`)
        ]);
        if (resDepts.ok) departments.value = await resDepts.json();
        if (resUsers.ok) managers.value = await resUsers.json();
        if (resBases.ok) bases.value = await resBases.json();
        if (resProducts.ok) products.value = await resProducts.json();
        if (resOkved.ok) okvedList.value = await resOkved.json();
    } catch (e) {
        console.error('Ошибка загрузки справочников', e);
    }
};

const loadStuck = async () => {
    loading.value = true;
    error.value = '';
    const params = new URLSearchParams();
    params.append('entity', filters.entity);
    params.append('days', String(filters.days || 7));
    params.append('limit', String(filters.limit));
    if (filters.department_id) params.append('department_id', String(filters.department_id));
    if (filters.manager_id) params.append('manager_id', String(filters.manager_id));
    if (filters.base_id) params.append('base_id', String(filters.base_id));
    if (filters.product_id) params.append('product_id', String(filters.product_id));
    if (filters.okved) params.append('okved', filters.okved);
    if (filters.cross_only) params.append('cross_only', 'true');
    try {
        const res = await fetch(`${API}/analytics/stuck?${params.toString()}`);
        if (res.ok) {
            items.value = await res.json();
        } else {
            const data = await res.json().catch(() => ({}));
            error.value = data.error || 'Ошибка загрузки зависших карточек';
            items.value = [];
        }
    } catch (e) {
        error.value = 'Нет связи с сервером';
        items.value = [];
    } finally {
        loading.value = false;
    }
};

const triggerProductsSync = async () => {
    syncLoading.value = true;
    syncMessage.value = '';
    try {
        const res = await fetch(`${API}/sync-products?limit=1000`);
        const data = await res.json();
        syncMessage.value = (data.message || 'Догрузка запущена') + ' Список обновится через 20 секунд.';
        setTimeout(async () => {
            await loadStuck();
            syncLoading.value = false;
        }, 20000);
    } catch (e) {
        syncMessage.value = 'Не удалось запустить догрузку товаров';
        syncLoading.value = false;
    }
};

const openProducts = async (item: any) => {
    showProductsModal.value = true;
    productsLoading.value = true;
    productDeal.value = null;
    productRows.value = [];
    try {
        const res = await fetch(`${API}/deals/${item.id}/products`);
        if (res.ok) {
            const data = await res.json();
            productDeal.value = data.deal;
            productRows.value = data.rows || [];
        }
    } catch (e) {
        console.error('Ошибка загрузки товаров сделки', e);
    } finally {
        productsLoading.value = false;
    }
};

const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
};

const getDaysSeverity = (days: number) => {
    if (days >= 30) return 'severity-high';
    if (days >= 14) return 'severity-medium';
    return 'severity-low';
};

const csvCell = (v: any): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const exportCSV = (full: boolean) => {
    if (filteredItems.value.length === 0) return;
    let csv: string;
    if (full) {
        csv = 'ID;Сущность;Ссылка;База;Основной продукт;Товары сделки;Кросс;ОКВЭД;Компания;ИНН;Ответственный;Отдел;Стадия;Воронка;Последний контакт;Дней без движения;Сумма;Связанных сделок\n';
        filteredItems.value.forEach(i => {
            csv += [
                i.id,
                i.entity_type === 'deal' ? 'Сделка' : 'Лид',
                b24Link(i),
                i.base_name,
                i.product_name,
                i.products_list,
                i.is_cross_sale ? 'да' : 'нет',
                i.okved,
                i.company_title,
                i.inn,
                i.manager_name,
                i.department_name,
                i.stage,
                i.category_name,
                formatDate(i.last_contact_at),
                i.days_stuck,
                i.amount || 0,
                i.deals_count ?? ''
            ].map(csvCell).join(';') + '\n';
        });
    } else {
        csv = 'ID;Сущность;Дней без движения\n';
        filteredItems.value.forEach(i => {
            csv += [i.id, i.entity_type === 'deal' ? 'Сделка' : 'Лид', i.days_stuck].map(csvCell).join(';') + '\n';
        });
    }
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `Зависшие_${filters.entity}_от_${filters.days}_дней${full ? '' : '_только_ID'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

onMounted(() => {
    loadDictionaries();
    loadStuck();
});
</script>

<style scoped>
.stuck-entities { width: 100%; font-family: Arial, sans-serif; }
.header-row { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px; margin-bottom: 20px; flex-wrap: wrap; gap: 15px; }
.subtitle { color: #7f8c8d; font-size: 13px; margin: 5px 0 0; max-width: 700px; }
.header-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.entity-toggle { display: flex; gap: 8px; }
.toggle-btn { background: #ecf0f1; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: bold; color: #34495e; font-size: 14px; transition: 0.2s; }
.toggle-btn.active { background: #3498db; color: white; }
.btn-settings { background: #f4f6f7; border: 1px solid #ddd; padding: 9px 14px; border-radius: 6px; cursor: pointer; color: #34495e; font-size: 13px; font-weight: bold; }
.btn-settings:hover { background: #e8ecee; }
.settings-card { background: white; border: 1px solid #eee; border-left: 4px solid #3498db; border-radius: 10px; padding: 15px 20px; margin-bottom: 20px; }
.settings-label { display: block; font-size: 11px; font-weight: bold; color: #7f8c8d; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 8px; }
.settings-row { display: flex; gap: 10px; flex-wrap: wrap; }
.settings-row .filter-input { flex: 1; min-width: 260px; }
.settings-hint { display: block; margin-top: 8px; color: #95a5a6; font-size: 12px; }
.btn-save { background: #3498db; color: white; border: none; padding: 9px 18px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; }
.btn-save:hover { background: #2980b9; }
.filters-card { background: white; padding: 20px; border-radius: 10px; border: 1px solid #eee; margin-bottom: 20px; display: flex; gap: 15px; flex-wrap: wrap; align-items: flex-end; box-shadow: 0 2px 10px rgba(0,0,0,0.02); }
.filter-group { flex: 1; min-width: 155px; display: flex; flex-direction: column; gap: 6px; }
.filter-group label { font-size: 11px; font-weight: bold; color: #7f8c8d; text-transform: uppercase; letter-spacing: 0.4px; }
.filter-input { padding: 9px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; background: white; color: #2c3e50; outline: none; width: 100%; box-sizing: border-box; }
.filter-actions { min-width: 230px; }
.cross-checkbox { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: bold; color: #d35400; background: #fef5e7; border: 1px solid #fad7a0; padding: 6px 10px; border-radius: 6px; cursor: pointer; text-transform: none !important; letter-spacing: 0 !important; }
.export-buttons { display: flex; gap: 8px; }
.btn-export { padding: 10px 14px; background: #27ae60; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; white-space: nowrap; }
.btn-export:hover:not(:disabled) { background: #2ecc71; }
.btn-export-ids { padding: 10px 12px; background: #f4f6f7; color: #34495e; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; white-space: nowrap; }
.btn-export-ids:hover:not(:disabled) { background: #e8ecee; }
.btn-export:disabled, .btn-export-ids:disabled { background: #bdc3c7; color: white; cursor: not-allowed; border-color: #bdc3c7; }
.error-banner { background: #fdedec; border: 1px solid #e74c3c; color: #c0392b; padding: 12px 18px; border-radius: 8px; margin-bottom: 15px; font-size: 14px; }
.warn-banner { background: #fffcf5; border: 1px solid #f39c12; padding: 14px 18px; border-radius: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; gap: 15px; flex-wrap: wrap; font-size: 13px; color: #d35400; }
.warn-sub { display: block; color: #a04000; font-size: 12px; margin-top: 4px; font-weight: normal; }
.btn-warn { background: #f39c12; color: white; border: none; padding: 9px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; white-space: nowrap; }
.btn-warn:hover:not(:disabled) { background: #e67e22; }
.btn-warn:disabled { background: #bdc3c7; cursor: not-allowed; }
.sync-message { font-size: 13px; color: #27ae60; margin-bottom: 15px; font-weight: bold; }
.card { background: white; padding: 20px; border-radius: 10px; border: 1px solid #eee; box-shadow: 0 2px 10px rgba(0,0,0,0.02); }
.table-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 15px; margin-bottom: 15px; flex-wrap: wrap; }
.search-input { max-width: 420px; }
.stats-line { font-size: 13px; color: #7f8c8d; }
.table-responsive { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.data-table { width: 100%; border-collapse: collapse; min-width: 1300px; }
.data-table th, .data-table td { padding: 11px 12px; border-bottom: 1px solid #f0f0f0; text-align: left; font-size: 13px; white-space: nowrap; }
.data-table th { background: #f5f6fa; color: #7f8c8d; font-weight: bold; }
.empty { text-align: center; color: #7f8c8d; padding: 25px !important; }
.muted { color: #95a5a6; font-size: 12px; }
.id-badge { background: #e3f2fd; color: #2980b9; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; display: inline-block; }
.id-link { text-decoration: none; border: 1px solid #bbdefb; cursor: pointer; }
.id-link:hover { background: #2980b9; color: white; }
.goods-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.goods-link { cursor: pointer; border-bottom: 1px dashed #bdc3c7; color: #2c3e50; }
.goods-link:hover { color: #2980b9; border-bottom-color: #2980b9; }
.cross-badge { background: #fef5e7; color: #d35400; border: 1px solid #fad7a0; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 6px; }
.main-badge { background: #eafaf1; color: #1e8449; border: 1px solid #a9dfbf; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; }
.okved-badge { background: #f4ecf7; color: #7d3c98; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
.company-cell { max-width: 220px; }
.company-name { font-weight: bold; overflow: hidden; text-overflow: ellipsis; }
.inn { font-size: 11px; color: #95a5a6; }
.category { font-size: 11px; color: #95a5a6; }
.dept-badge { background: #f4f6f7; color: #34495e; padding: 3px 8px; border-radius: 4px; font-size: 12px; }
.days-badge { padding: 4px 10px; border-radius: 12px; font-weight: bold; font-size: 12px; display: inline-block; }
.severity-low { background: #fef9e7; color: #d68910; }
.severity-medium { background: #fbeee6; color: #d35400; }
.severity-high { background: #fdedec; color: #c0392b; }
.note { margin: 15px 0 0; font-size: 12px; color: #95a5a6; line-height: 1.5; }
.note code { background: #f5f6fa; padding: 1px 5px; border-radius: 3px; }
.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 1000; padding: 20px; }
.modal-content { background: white; border-radius: 12px; width: 100%; max-width: 950px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
.modal-header { display: flex; justify-content: space-between; align-items: center; padding: 20px; border-bottom: 1px solid #eee; }
.btn-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #7f8c8d; }
.btn-close:hover { color: #e74c3c; }
.modal-body { padding: 20px; overflow-y: auto; }
.deal-info { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px 20px; background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px; font-size: 13px; color: #2c3e50; }
.info-label { color: #7f8c8d; }
.modal-warn { background: #fffcf5; border: 1px solid #f39c12; color: #d35400; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 12px; }
.totals { display: flex; justify-content: space-between; align-items: center; gap: 15px; flex-wrap: wrap; margin-top: 15px; padding-top: 12px; border-top: 1px solid #eee; font-size: 13px; color: #34495e; }
.diff-warn { color: #c0392b; font-weight: bold; }
.diff-ok { color: #27ae60; font-weight: bold; }
@media (max-width: 768px) {
    .filter-group { min-width: 100%; }
    .search-input { max-width: 100%; }
}
</style>