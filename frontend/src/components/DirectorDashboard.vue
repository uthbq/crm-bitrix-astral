<template>
    <div class="director-dashboard">
        <div class="header-row">
            <div>
                <h2 style="margin: 0; color: #2c3e50;">Сводка по компании</h2>
                <p class="subtitle">Звонки, лиды, оплаты, базы, продукты по товарам, ОКВЭД и качество данных</p>
            </div>
            <div class="header-actions">
                <button @click="showSettings = !showSettings" class="btn-settings">⚙️ Портал</button>
                <button @click="recalcStats" class="btn-recalc" :disabled="recalcLoading">
                    {{ recalcLoading ? 'Пересчёт…' : '🔄 Пересчитать агрегаты' }}
                </button>
                <button @click="exportReport" class="btn-export" :disabled="loading">📥 Экспорт отчёта</button>
            </div>
        </div>

        <div v-if="showSettings" class="settings-card">
            <label class="settings-label">Адрес портала Битрикс24 для ссылок на карточки</label>
            <div class="settings-row">
                <input v-model="portalUrl" placeholder="https://yourcompany.bitrix24.ru" class="filter-input" />
                <button @click="savePortal" class="btn-save">Сохранить</button>
            </div>
            <small class="settings-hint">Хранится в браузере, отдельно от адреса Chatium API.</small>
        </div>

        <div v-if="syncStatus" class="sync-bar" :class="{ warn: syncStatus.incomplete }">
            <span>Синхронизация сделок: <strong>{{ formatTs(dealsSyncTs) }}</strong></span>
            <span v-if="syncStatus.products_pending > 0" class="sync-warn-text">
                Товары не загружены у {{ syncStatus.products_pending }} сделок
            </span>
            <span v-else class="sync-ok-text">Данные полные</span>
            <span v-if="recalcMsg" class="sync-ok-text">{{ recalcMsg }}</span>
        </div>

        <div class="filters-card">
            <div class="filter-group" style="max-width: 190px;">
                <label>Период</label>
                <select v-model="filters.period" @change="loadAnalytics" class="filter-input">
                    <option value="all">За всё время</option>
                    <option value="today">Сегодня</option>
                    <option value="week">Последние 7 дней</option>
                    <option value="month">Последние 30 дней</option>
                </select>
            </div>
            <div class="filter-group autocomplete-wrapper">
                <label>База</label>
                <input v-model="searchBaseQuery" @focus="showBaseDropdown = true"
                       @blur="hideBaseDropdown" @input="handleBaseInput"
                       placeholder="Поиск по базам…" class="filter-input" />
                <div v-if="showBaseDropdown && filteredBasesList.length" class="dropdown-list">
                    <div v-for="b in filteredBasesList" :key="b.id" @mousedown.prevent="selectBaseFilter(b)" class="dropdown-item">
                        {{ b.name }}
                    </div>
                </div>
            </div>
            <div class="filter-group">
                <label>Менеджер</label>
                <select v-model="filters.manager_id" @change="loadAnalytics" class="filter-input">
                    <option value="">Все менеджеры</option>
                    <option v-for="m in managersList" :key="m.id" :value="m.bitrix_id">{{ m.login }}</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Продукт</label>
                <select v-model="filters.product_id" @change="loadAnalytics" class="filter-input">
                    <option value="">Все продукты</option>
                    <option v-for="p in productsList" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
            </div>
            <div class="filter-group">
                <label>ОКВЭД</label>
                <select v-model="filters.okved" @change="loadAnalytics" class="filter-input">
                    <option value="">Все ОКВЭД</option>
                    <option v-for="o in okvedList" :key="o.code" :value="o.code">
                        {{ o.code }}{{ o.name ? ' — ' + o.name : '' }}
                    </option>
                </select>
            </div>
        </div>
        <p v-if="filters.okved" class="filter-hint">
            ОКВЭД фильтрует сделки, базы, отказы и продукты. Звонки и дневная динамика считаются без разреза ОКВЭД —
            недоступный разрез не подменяется нулём.
        </p>

        <div v-if="loading" class="empty">Загрузка аналитики…</div>
        <div v-else class="dashboard-grid">

            <div v-if="dataIssues.total > 0" class="data-issues-banner">
                <div class="issues-left">
                    <span style="font-size: 24px;">⚠️</span>
                    <div>
                        <h4 style="margin: 0; color: #c0392b;">Проблемы качества данных ({{ dataIssues.total }})</h4>
                        <p class="issues-sub">ИНН, ОКВЭД, база, ответственный, расхождение продукта и товаров, неоднозначные связи, звонки без карточки, квалификация.</p>
                    </div>
                </div>
                <button @click="showIssuesModal = true" class="btn-issues">Посмотреть детали</button>
            </div>

            <div class="kpi-grid">
                <div class="kpi-card">
                    <div class="kpi-title">📞 Наборы</div>
                    <div class="kpi-value">{{ kpiCurrent.calls }}</div>
                    <div v-if="filters.period !== 'all'" class="kpi-trend" :class="trendClass(kpiCurrent.calls, kpiPrev.calls)">
                        {{ trendArrow(kpiCurrent.calls, kpiPrev.calls) }} {{ Math.abs(kpiCurrent.calls - kpiPrev.calls) }}
                        ({{ trendPct(kpiCurrent.calls, kpiPrev.calls) }}%) <span class="trend-sub">к прошлому периоду</span>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-title">🗣 Разговоры</div>
                    <div class="kpi-value" style="color: #16a085;">{{ kpiCurrent.conversations }}</div>
                    <div class="kpi-sub">% дозвона: <strong>{{ connectionRate }}%</strong> (порог 44/59 по квалификации)</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-title">💎 Кач. лиды</div>
                    <div class="kpi-value" style="color: #3498db;">{{ kpiCurrent.leads }}</div>
                    <div v-if="filters.period !== 'all'" class="kpi-trend" :class="trendClass(kpiCurrent.leads, kpiPrev.leads)">
                        {{ trendArrow(kpiCurrent.leads, kpiPrev.leads) }} {{ Math.abs(kpiCurrent.leads - kpiPrev.leads) }}
                        ({{ trendPct(kpiCurrent.leads, kpiPrev.leads) }}%) <span class="trend-sub">к прошлому периоду</span>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-title">💳 Оплаты (шт)</div>
                    <div class="kpi-value" style="color: #27ae60;">{{ kpiCurrent.deals }}</div>
                    <div v-if="filters.period !== 'all'" class="kpi-trend" :class="trendClass(kpiCurrent.deals, kpiPrev.deals)">
                        {{ trendArrow(kpiCurrent.deals, kpiPrev.deals) }} {{ Math.abs(kpiCurrent.deals - kpiPrev.deals) }}
                        ({{ trendPct(kpiCurrent.deals, kpiPrev.deals) }}%) <span class="trend-sub">к прошлому периоду</span>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-title">💰 Выручка (₽)</div>
                    <div class="kpi-value" style="color: #27ae60;">{{ money(kpiCurrent.revenue) }}</div>
                    <div v-if="filters.period !== 'all'" class="kpi-trend" :class="trendClass(kpiCurrent.revenue, kpiPrev.revenue)">
                        {{ trendArrow(kpiCurrent.revenue, kpiPrev.revenue) }} {{ money(Math.abs(kpiCurrent.revenue - kpiPrev.revenue)) }}
                        ({{ trendPct(kpiCurrent.revenue, kpiPrev.revenue) }}%) <span class="trend-sub">к прошлому периоду</span>
                    </div>
                </div>
            </div>

            <div class="card" v-if="filters.base_id" style="border-left: 4px solid #9b59b6;">
                <div class="card-head">
                    <h3 style="margin: 0;">📊 Отработка базы «{{ selectedBaseName }}» по менеджерам</h3>
                    <div class="metric-toggle">
                        <button @click="baseChartMetric = 'calls'" :class="['metric-btn', { active: baseChartMetric === 'calls' }]">Звонки и разговоры</button>
                        <button @click="baseChartMetric = 'leads'" :class="['metric-btn', { active: baseChartMetric === 'leads' }]">Кач. лиды и оплаты</button>
                        <button @click="baseChartMetric = 'revenue'" :class="['metric-btn', { active: baseChartMetric === 'revenue' }]">Выручка</button>
                    </div>
                </div>
                <div v-if="managers.length === 0" class="empty">По этой базе нет активности за период.</div>
                <div v-else class="chart-container" style="height: 300px;"><Bar :data="baseManagersChartData" :options="chartOptions" /></div>
            </div>

            <div class="card" v-if="dailyStats.length > 0">
                <h3>📈 Динамика звонков</h3>
                <div class="chart-container" style="height: 250px;"><Bar :data="chartData" :options="chartOptions" /></div>
            </div>

            <div class="split-row">
                <div class="card" style="flex: 1; border-left: 4px solid #3498db;">
                    <h3>💎 Кач. лиды по продуктам баз</h3>
                    <div class="table-responsive">
                        <table class="data-table">
                            <thead><tr><th>Продукт</th><th style="text-align: right;">Кач. лидов</th></tr></thead>
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
                    <h3>📞 Связь звонков с карточками</h3>
                    <div class="conn-row"><span>Сопоставлено с лидом/сделкой:</span><strong style="color:#27ae60;">{{ callsConnectionStats.assigned_calls || 0 }}</strong></div>
                    <div class="conn-row"><span>Несопоставленные (контакт/компания/без владельца):</span><strong style="color:#e74c3c;">{{ callsConnectionStats.unassigned_calls || 0 }}</strong></div>
                    <div class="conn-row"><span>Исходящие наборы:</span><strong>{{ callsConnectionStats.outgoing_calls || 0 }}</strong></div>
                    <div class="conn-total">Всего загружено звонков: {{ callsConnectionStats.total_calls || 0 }}</div>
                </div>
            </div>

            <div class="card" style="border-left: 4px solid #16a085;">
                <h3>📦 Продажи по фактическим продуктам (товарные строки)
                    <span class="hint">клик по продукту — детализация сделок</span>
                </h3>
                <div class="table-responsive scroll-320">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Продукт</th><th>Группа</th><th>Сделок</th>
                                <th style="text-align: right;">Кол-во</th>
                                <th style="text-align: right;">Сумма строк</th>
                                <th style="text-align: right;">Оплачено (S)</th>
                                <th style="text-align: right;">Кросс ₽</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="salesByProduct.length === 0"><td colspan="7" class="empty">Товарные позиции не загружены</td></tr>
                            <tr v-for="(p, idx) in salesByProduct" :key="idx">
                                <td>
                                    <span v-if="dictionaryProductId(p.product_name)" class="drilldown-link"
                                          @click="openDrilldown(null, null, 'paid_deals', `Сделки с продуктом: ${p.product_name}`, { product_id: dictionaryProductId(p.product_name) })">
                                        <strong>{{ p.product_name }}</strong>
                                    </span>
                                    <strong v-else title="Продукта нет в справочнике — детализация недоступна">{{ p.product_name }}</strong>
                                </td>
                                <td class="muted">{{ p.product_group }}</td>
                                <td>{{ p.deals_count }}</td>
                                <td style="text-align: right;">{{ p.quantity }}</td>
                                <td style="text-align: right; font-weight: bold;">{{ money(p.rows_amount) }}</td>
                                <td style="text-align: right; color: #27ae60;">{{ money(p.won_amount) }}</td>
                                <td style="text-align: right; color: #d35400; font-weight: bold;">{{ money(p.cross_amount) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="card" style="border-left: 4px solid #7d3c98;">
                <h3>🏭 Срез по ОКВЭД <span class="hint">клик по оплатам — детализация</span></h3>
                <div class="table-responsive scroll-320">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>ОКВЭД</th><th>Название</th><th>Лидов передано</th><th>Сделок</th>
                                <th>Оплачено</th><th>Конверсия</th>
                                <th style="text-align: right;">Ср. чек</th>
                                <th style="text-align: right;">Сумма оплат</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="okvedStats.length === 0"><td colspan="8" class="empty">Нет данных по ОКВЭД</td></tr>
                            <tr v-for="o in okvedStats" :key="o.okved_code">
                                <td><span class="okved-badge">{{ o.okved_code }}</span></td>
                                <td class="goods-cell muted" :title="o.okved_name">{{ o.okved_name || '—' }}</td>
                                <td>{{ o.leads_transferred || 0 }}</td>
                                <td>{{ o.deals_count }}</td>
                                <td style="color: #27ae60; font-weight: bold;">
                                    <span class="drilldown-link" @click="openDrilldown(null, null, 'won_deals', `Оплаченные сделки ОКВЭД ${o.okved_code}`, { okved: o.okved_code })">
                                        {{ o.won_deals }}
                                    </span>
                                </td>
                                <td><strong>{{ conv(o.won_deals, o.deals_count) }}%</strong></td>
                                <td style="text-align: right;">{{ money(o.avg_check) }} ₽</td>
                                <td style="text-align: right; font-weight: bold; color: #27ae60;">{{ money(o.won_amount) }} ₽</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="split-row">
                <div class="card" style="flex: 2; border-left: 4px solid #e74c3c;">
                    <h3>🛑 Топ причин отказов <span class="hint">клик по строке — лиды причины</span></h3>
                    <div class="table-responsive">
                        <table class="data-table interactive-table">
                            <thead>
                                <tr>
                                    <th>Причина</th>
                                    <th style="text-align: center;">Лидов (к прошлому периоду)</th>
                                    <th style="text-align: center;">Доля</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-if="refusals.length === 0"><td colspan="3" class="empty">Нет отказов за период</td></tr>
                                <tr v-for="r in refusals" :key="r.id" @click="openReasonDetails(r)">
                                    <td><strong>{{ r.reason_name }}</strong></td>
                                    <td style="text-align: center; color: #e74c3c; font-weight: bold;">
                                        {{ r.count }}
                                        <span v-html="trendHTML(r.count, prevValue(refusalsPrev, 'id', r.id, 'count'))"></span>
                                    </td>
                                    <td style="text-align: center; color: #7f8c8d;">{{ refusalShare(r.count) }}%</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="card" style="flex: 1; border-left: 4px solid #95a5a6;">
                    <h3>🤐 Топ «молчунов»</h3>
                    <p class="card-note">Слили лид, не указав причину</p>
                    <div class="table-responsive">
                        <table class="data-table">
                            <thead><tr><th>Менеджер</th><th style="text-align: center;">Кол-во</th></tr></thead>
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
                <h3>🏆 Рейтинг менеджеров <span class="hint">подчёркнутые цифры открывают детализацию</span></h3>
                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Сотрудник</th><th>Звонки</th><th>Разговоры</th><th>Кач. лиды</th>
                                <th>Передано</th><th>Оплаты</th><th style="text-align: right;">Сумма (₽)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="managers.length === 0"><td colspan="7" class="empty">Нет данных за период</td></tr>
                            <tr v-for="(m, index) in managers" :key="m.manager_id">
                                <td>
                                    <div class="manager-cell">
                                        <span v-if="index < 3">{{ ['🥇','🥈','🥉'][index] }}</span>
                                        <strong>{{ m.manager_name }}</strong>
                                        <span class="dept-badge" :title="`Порог разговора: ${m.threshold} сек`">{{ m.department_name }}</span>
                                    </div>
                                </td>
                                <td>{{ m.total_calls }} <span v-html="trendHTML(m.total_calls, prevValue(managersPrev, 'manager_id', m.manager_id, 'total_calls'))"></span></td>
                                <td>{{ m.valid_conversations }} <span v-html="trendHTML(m.valid_conversations, prevValue(managersPrev, 'manager_id', m.manager_id, 'valid_conversations'))"></span></td>
                                <td>
                                    <span class="drilldown-link" @click="openDrilldown(m.manager_id, filters.base_id || null, 'quality_leads', `Кач. лиды: ${m.manager_name}`)">{{ m.quality_leads }}</span>
                                    <span v-html="trendHTML(m.quality_leads, prevValue(managersPrev, 'manager_id', m.manager_id, 'quality_leads'))"></span>
                                </td>
                                <td style="color: #8e44ad; font-weight: bold;">{{ m.transfers }} <span v-html="trendHTML(m.transfers, prevValue(managersPrev, 'manager_id', m.manager_id, 'transfers'))"></span></td>
                                <td>
                                    <span class="drilldown-link" @click="openDrilldown(m.manager_id, filters.base_id || null, 'paid_deals', `Сделки: ${m.manager_name}`)">{{ m.paid_deals }}</span>
                                    <span v-html="trendHTML(m.paid_deals, prevValue(managersPrev, 'manager_id', m.manager_id, 'paid_deals'))"></span>
                                </td>
                                <td class="money" style="text-align: right;">
                                    <span class="drilldown-link" @click="openDrilldown(m.manager_id, filters.base_id || null, 'paid_deals', `Выручка: ${m.manager_name}`)">{{ money(m.amount_sum) }}</span>
                                    <span v-html="trendHTML(m.amount_sum, prevValue(managersPrev, 'manager_id', m.manager_id, 'amount_sum'))"></span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="card">
                <h3>📁 Эффективность баз <span class="hint">кросс — по товарам; «не определён» — товары ещё не загружены</span></h3>
                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>База</th><th>Осн. продукт</th><th>Кач. лиды</th><th>Оплаты</th>
                                <th style="text-align: right;">Осн. продукт ₽</th>
                                <th style="text-align: right;">Кросс ₽</th>
                                <th style="text-align: right;" title="Сумма сделок, у которых товарные позиции ещё не загружены — не приписана основному продукту">Не определён ₽</th>
                                <th style="text-align: right;">Итого ₽</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="bases.length === 0"><td colspan="8" class="empty">Нет данных за период</td></tr>
                            <tr v-for="b in bases" :key="b.base_id">
                                <td><strong>{{ b.base_name }}</strong></td>
                                <td class="muted">{{ b.main_product_name }}</td>
                                <td>
                                    <span class="drilldown-link" @click="openDrilldown(filters.manager_id || null, b.base_id, 'quality_leads', `Кач. лиды базы: ${b.base_name}`)">{{ b.quality_leads }}</span>
                                    <span v-html="trendHTML(b.quality_leads, prevValue(basesPrev, 'base_id', b.base_id, 'quality_leads'))"></span>
                                </td>
                                <td>
                                    <span class="drilldown-link" @click="openDrilldown(filters.manager_id || null, b.base_id, 'paid_deals', `Сделки базы: ${b.base_name}`)">{{ b.paid_deals }}</span>
                                    <span v-html="trendHTML(b.paid_deals, prevValue(basesPrev, 'base_id', b.base_id, 'paid_deals'))"></span>
                                </td>
                                <td style="text-align: right; color: #2980b9; font-weight: bold;">{{ money(b.main_amount) }}</td>
                                <td style="text-align: right; color: #d35400; font-weight: bold;">
                                    <span v-if="b.cross_amount > 0" class="drilldown-link" @click="openDrilldown(filters.manager_id || null, b.base_id, 'cross_deals', `Кросс-продажи базы: ${b.base_name}`)">{{ money(b.cross_amount) }}</span>
                                    <span v-else>{{ money(b.cross_amount) }}</span>
                                </td>
                                <td style="text-align: right;" :class="{ 'unknown-amount': b.unknown_amount > 0 }">{{ money(b.unknown_amount) }}</td>
                                <td class="money" style="text-align: right;">
                                    <span class="drilldown-link" @click="openDrilldown(filters.manager_id || null, b.base_id, 'paid_deals', `Выручка базы: ${b.base_name}`)">{{ money(b.amount_sum) }}</span>
                                    <span v-html="trendHTML(b.amount_sum, prevValue(basesPrev, 'base_id', b.base_id, 'amount_sum'))"></span>
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
                    <div v-if="drilldownLoading" class="empty">Поиск в локальной базе…</div>
                    <template v-else>
                        <div class="modal-toolbar">
                            <span class="muted">Найдено: <strong>{{ drilldownData.length }}</strong> (до 200)</span>
                            <button @click="exportDrilldown" class="btn-export-sm" :disabled="drilldownData.length === 0">📥 CSV</button>
                        </div>
                        <div class="table-responsive">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>ID</th><th>Дата</th><th>Менеджер</th><th>База</th><th>Товары</th>
                                        <th>ОКВЭД</th><th>Компания / ИНН</th><th>Стадия</th>
                                        <th style="text-align: right;">Сумма</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-if="drilldownData.length === 0"><td colspan="9" class="empty">Карточки не найдены</td></tr>
                                    <tr v-for="item in drilldownData" :key="item.type + '-' + item.b24_id">
                                        <td>
                                            <a v-if="b24Link(item.type, item.b24_id)" :href="b24Link(item.type, item.b24_id)" target="_blank" rel="noopener" class="b24-id-badge b24-link">
                                                {{ item.type === 'deal' ? 'Сделка' : 'Лид' }} #{{ item.b24_id }}
                                            </a>
                                            <span v-else class="b24-id-badge">{{ item.type === 'deal' ? 'Сделка' : 'Лид' }} #{{ item.b24_id }}</span>
                                        </td>
                                        <td>{{ formatDateTime(item.created_at) }}</td>
                                        <td>{{ item.manager_name }}</td>
                                        <td>{{ item.base_name || '—' }}</td>
                                        <td class="goods-cell">
                                            <span v-if="item.type === 'deal'" class="drilldown-link" :title="item.products_list" @click="openProducts(item.b24_id)">{{ item.products_list || '—' }}</span>
                                            <span v-else :title="item.products_list">{{ item.products_list || '—' }}</span>
                                            <span v-if="item.is_cross_sale" class="cross-badge">кросс</span>
                                        </td>
                                        <td><span v-if="item.okved" class="okved-badge">{{ item.okved }}</span><span v-else class="muted">—</span></td>
                                        <td class="company-cell">
                                            <div class="company-name">{{ item.company_title || '—' }}</div>
                                            <div class="muted" style="font-size: 11px;">{{ item.inn || 'ИНН не указан' }}</div>
                                        </td>
                                        <td>{{ item.stage || '—' }}</td>
                                        <td style="text-align: right; font-weight: bold; color: #27ae60;">{{ item.amount ? money(item.amount) + ' ₽' : '—' }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </template>
                </div>
            </div>
        </div>

        <div v-if="showProducts" class="modal-overlay modal-top" @click.self="showProducts = false">
            <div class="modal-content" style="max-width: 900px;">
                <div class="modal-header">
                    <h3 style="margin: 0;">Товары сделки <span style="color: #2980b9;">#{{ productDeal?.bitrix_deal_id }}</span></h3>
                    <button @click="showProducts = false" class="btn-close">✖</button>
                </div>
                <div class="modal-body">
                    <div v-if="productsLoading" class="empty">Загрузка товарных позиций…</div>
                    <template v-else>
                        <div class="deal-info">
                            <div><span class="muted">Компания:</span> <strong>{{ productDeal?.company_title || '—' }}</strong></div>
                            <div><span class="muted">ИНН:</span> {{ productDeal?.inn || '—' }}</div>
                            <div><span class="muted">ОКВЭД:</span> {{ productDeal?.okved || 'не указан' }}</div>
                            <div><span class="muted">База:</span> {{ productDeal?.base_name || 'Без базы' }}</div>
                            <div><span class="muted">Осн. продукт базы:</span> {{ productDeal?.main_product_name || 'не назначен' }}</div>
                            <div><span class="muted">Поле «Продукт» в CRM:</span> {{ productDeal?.product_field || '—' }}</div>
                            <div><span class="muted">Сумма сделки:</span> <strong style="color:#27ae60;">{{ money(productDeal?.amount) }} ₽</strong></div>
                        </div>
                        <div v-if="fieldMismatch" class="modal-warn">⚠️ Поле «Продукт» в CRM расходится с фактическими товарами. Кросс определяется по товарам.</div>
                        <div v-if="!productDeal?.main_product_name" class="modal-warn">⚠️ У базы не назначен основной продукт — кросс по сделке не определяется.</div>
                        <div class="table-responsive">
                            <table class="data-table">
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
                                    <tr v-if="productRows.length === 0"><td colspan="6" class="empty">Позиции не загружены</td></tr>
                                    <tr v-for="(r, idx) in productRows" :key="r.bitrix_row_id || idx">
                                        <td><strong>{{ r.product_name }}</strong></td>
                                        <td class="muted">{{ r.product_group || '—' }}</td>
                                        <td style="text-align: right;">{{ r.quantity }}</td>
                                        <td style="text-align: right;">{{ money(r.price) }}</td>
                                        <td style="text-align: right; font-weight: bold;">{{ money(r.sum) }} {{ r.currency || 'RUB' }}</td>
                                        <td style="text-align: center;">
                                            <span v-if="r.is_cross_sale" class="cross-badge">кросс</span>
                                            <span v-else class="main-badge">основной</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div class="totals">
                            <span>Сумма строк: <strong>{{ money(rowsTotal) }} ₽</strong></span>
                            <span v-if="Math.abs(amountDiff) > 1" style="color:#c0392b; font-weight:bold;">Расхождение с суммой сделки: {{ money(amountDiff) }} ₽</span>
                            <span v-else style="color:#27ae60; font-weight:bold;">Суммы сходятся</span>
                        </div>
                    </template>
                </div>
            </div>
        </div>

        <div v-if="showIssuesModal" class="modal-overlay" @click.self="showIssuesModal = false">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 style="margin: 0; color: #c0392b;">Отчёт: проблемы качества данных ({{ dataIssues.total }})</h3>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button @click="exportIssues" class="btn-export-sm">📥 CSV</button>
                        <button @click="showIssuesModal = false" class="btn-close">✖</button>
                    </div>
                </div>
                <div class="modal-body">
                    <template v-for="g in issueGroups" :key="g.key">
                        <div v-if="dataIssues.details[g.key]?.length" class="issue-block">
                            <h4>{{ g.title }} ({{ dataIssues.details[g.key].length }})</h4>
                            <p class="issue-desc">{{ g.desc }}</p>
                            <div class="issue-list">
                                <template v-for="(item, i) in dataIssues.details[g.key]" :key="i">
                                    <a v-if="g.type && b24Link(g.type, item.id)" :href="b24Link(g.type, item.id)" target="_blank" rel="noopener" class="issue-chip issue-link">{{ g.fmt(item) }}</a>
                                    <span v-else class="issue-chip">{{ g.fmt(item) }}</span>
                                </template>
                            </div>
                        </div>
                    </template>
                    <div v-if="dataIssues.total === 0" class="empty">Проблем не обнаружено 🎉</div>
                    <p class="card-note">Показаны первые 50 записей каждой проверки. Список «товары не загружены» — временный: он уменьшается по мере синхронизации.</p>
                </div>
            </div>
        </div>

        <div v-if="showReasonModal" class="modal-overlay" @click.self="showReasonModal = false">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 style="margin: 0;">Причина: <span style="color: #e74c3c;">{{ selectedReasonName }}</span></h3>
                    <button @click="showReasonModal = false" class="btn-close">✖</button>
                </div>
                <div class="modal-body">
                    <div v-if="reasonLoading" class="empty">Загрузка лидов…</div>
                    <div v-else class="table-responsive">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>ID</th><th>Дата</th><th>Менеджер</th><th>База</th>
                                    <th>Продукт</th><th>ОКВЭД</th><th>Статус</th><th>Товары связанных сделок</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-if="detailedLeads.length === 0"><td colspan="8" class="empty">Лиды не найдены</td></tr>
                                <tr v-for="lead in detailedLeads" :key="lead.bitrix_lead_id">
                                    <td>
                                        <a v-if="b24Link('lead', lead.bitrix_lead_id)" :href="b24Link('lead', lead.bitrix_lead_id)" target="_blank" rel="noopener" class="b24-id-badge b24-link">#{{ lead.bitrix_lead_id }}</a>
                                        <span v-else class="b24-id-badge">#{{ lead.bitrix_lead_id }}</span>
                                    </td>
                                    <td>{{ formatDateTime(lead.created_at) }}</td>
                                    <td>{{ lead.manager_name }}</td>
                                    <td>{{ lead.base_name }}</td>
                                    <td>{{ lead.product_name }}</td>
                                    <td><span v-if="lead.okved" class="okved-badge">{{ lead.okved }}</span><span v-else class="muted">—</span></td>
                                    <td class="muted">{{ lead.status_id }}</td>
                                    <td class="goods-cell" :title="lead.products_list">{{ lead.products_list || '—' }}</td>
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
import { Chart as ChartJS, Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale } from 'chart.js';

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale);

const API = 'http://localhost:3000/api';

const managers = ref<any[]>([]);
const bases = ref<any[]>([]);
const dailyStats = ref<any[]>([]);
const refusals = ref<any[]>([]);
const silentManagers = ref<any[]>([]);
const productsStats = ref<any[]>([]);
const salesByProduct = ref<any[]>([]);
const okvedStats = ref<any[]>([]);
const callsConnectionStats = ref<any>({});
const managersPrev = ref<any[]>([]);
const basesPrev = ref<any[]>([]);
const refusalsPrev = ref<any[]>([]);
const basesList = ref<any[]>([]);
const managersList = ref<any[]>([]);
const productsList = ref<any[]>([]);
const okvedList = ref<any[]>([]);
const loading = ref(true);
const syncStatus = ref<any>(null);
const recalcLoading = ref(false);
const recalcMsg = ref('');
const portalUrl = ref(localStorage.getItem('b24_portal_url') || '');
const showSettings = ref(false);

const filters = reactive({ period: 'week', base_id: '' as any, manager_id: '', product_id: '', okved: '' });
const baseChartMetric = ref<'calls' | 'leads' | 'revenue'>('calls');
const searchBaseQuery = ref('');
const showBaseDropdown = ref(false);

const kpiCurrent = reactive({ calls: 0, conversations: 0, leads: 0, deals: 0, revenue: 0 });
const kpiPrev = reactive({ calls: 0, conversations: 0, leads: 0, deals: 0, revenue: 0 });

const showDrilldownModal = ref(false);
const drilldownLoading = ref(false);
const drilldownTitle = ref('');
const drilldownData = ref<any[]>([]);
const showProducts = ref(false);
const productsLoading = ref(false);
const productDeal = ref<any>(null);
const productRows = ref<any[]>([]);
const showIssuesModal = ref(false);
const dataIssues = ref<{ total: number; details: any }>({ total: 0, details: {} });
const showReasonModal = ref(false);
const reasonLoading = ref(false);
const selectedReasonName = ref('');
const detailedLeads = ref<any[]>([]);

const money = (v: any) => (Number(v) || 0).toLocaleString('ru-RU');
const conv = (won: number, total: number) => (!total ? 0 : Math.round((won / total) * 100));
const normName = (s: string) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
const connectionRate = computed(() => (kpiCurrent.calls ? Math.round((kpiCurrent.conversations / kpiCurrent.calls) * 100) : 0));
const totalRefusals = computed(() => refusals.value.reduce((s, r) => s + r.count, 0));
const refusalShare = (count: number) => (totalRefusals.value ? Math.round((count / totalRefusals.value) * 100) : 0);
const dealsSyncTs = computed(() => syncStatus.value?.items?.find((i: any) => i.entity === 'deals')?.last_success_ts || null);
const selectedBaseName = computed(() => basesList.value.find(b => b.id === filters.base_id)?.name || searchBaseQuery.value);
const filteredBasesList = computed(() => {
    const q = searchBaseQuery.value.toLowerCase();
    return q ? basesList.value.filter(b => b.name.toLowerCase().includes(q)) : basesList.value;
});
const dictionaryProductId = (name: string): number | null => {
    const p = productsList.value.find(x => normName(x.name) === normName(name));
    return p ? p.id : null;
};
const rowsTotal = computed(() => productRows.value.reduce((s, r) => s + (r.sum || 0), 0));
const amountDiff = computed(() => productDeal.value ? Math.round(((productDeal.value.amount || 0) - rowsTotal.value) * 100) / 100 : 0);
const fieldMismatch = computed(() => {
    const d = productDeal.value;
    if (!d?.product_field || !d?.products_list) return false;
    return !normName(d.products_list).includes(normName(d.product_field));
});

const issueGroups = [
    { key: 'dealsNoInn', type: 'deal', title: 'Оплаченные сделки без ИНН', desc: 'Невозможно связать продажу с лидами ТМ и обогатить ОКВЭД.', fmt: (d: any) => `Сделка #${d.id} (${money(d.amount)} ₽)` },
    { key: 'dealsNoOkved', type: 'deal', title: 'Оплаченные сделки без ОКВЭД', desc: 'ИНН есть, но Dadata ещё не обогатил сделку или код не найден.', fmt: (d: any) => `Сделка #${d.id} (ИНН ${d.inn || '—'})` },
    { key: 'noBase', type: 'lead', title: 'Лиды в работе без базы', desc: 'Не заполнена сегментация — лид не попадает в конверсию баз.', fmt: (l: any) => `Лид #${l.id}` },
    { key: 'noManager', type: 'lead', title: 'Лиды без ответственного', desc: 'Некому атрибутировать активность.', fmt: (l: any) => `Лид #${l.id}` },
    { key: 'productMismatch', type: 'deal', title: 'Расхождение поля «Продукт» и товаров', desc: 'Кросс определяется по товарам; поле в карточке не обновили.', fmt: (d: any) => `#${d.id}: «${d.product_field}» ≠ ${d.products_list}` },
    { key: 'ambiguousInn', type: '', title: 'Неоднозначная связь по ИНН', desc: 'Сделка без прямой связи с лидом, а на ИНН несколько лидов. Выручка не распределяется автоматически.', fmt: (d: any) => `ИНН ${d.inn}: ${d.deals_count} сделок / ${d.leads_count} лидов (${money(d.amount)} ₽)` },
    { key: 'callsNoOwner', type: '', title: 'Звонки без связи с лидом/сделкой', desc: 'Владелец — контакт, компания или не указан. В общем количестве учтены, в конверсии баз — нет.', fmt: (c: any) => `Звонок #${c.id} (${c.owner_type || 'без владельца'})` },
    { key: 'unknownQualification', type: '', title: 'Неизвестная квалификация менеджера', desc: 'Порог разговора применён по умолчанию (44 сек) — расчёт помечается как неполный.', fmt: (u: any) => u.login },
    { key: 'dealsNoProducts', type: 'deal', title: 'Сделки с незагруженными товарами', desc: 'Временная проблема: позиции догрузятся при синхронизации. Кросс по ним не определён.', fmt: (d: any) => `Сделка #${d.id} (${money(d.amount)} ₽)` }
];

const savePortal = () => {
    portalUrl.value = portalUrl.value.trim().replace(/\/+$/, '');
    localStorage.setItem('b24_portal_url', portalUrl.value);
    showSettings.value = false;
};
const b24Link = (type: string, id: any): string => {
    const base = portalUrl.value.trim().replace(/\/+$/, '');
    if (!base || !type) return '';
    return `${base}/crm/${type === 'deal' ? 'deal' : 'lead'}/details/${id}/`;
};

const formatDate = (s: string) => !s ? '' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(s));
const formatDateTime = (s: string) => {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
};
const formatTs = (ts: string | null) => {
    if (!ts) return 'ещё не выполнялась';
    const d = new Date(ts.replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? ts : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
};

const getDatesForPeriod = (period: string) => {
    if (period === 'all') return { start: '', end: '' };
    const today = new Date();
    const end = today.toISOString().split('T')[0];
    let start = end;
    if (period === 'week') { const d = new Date(); d.setDate(d.getDate() - 7); start = d.toISOString().split('T')[0]; }
    else if (period === 'month') { const d = new Date(); d.setMonth(d.getMonth() - 1); start = d.toISOString().split('T')[0]; }
    return { start, end };
};
const getPrevDates = (period: string) => {
    if (period === 'all') return { start: '', end: '' };
    const today = new Date();
    const end = new Date(); const start = new Date();
    if (period === 'today') { end.setDate(today.getDate() - 1); start.setDate(today.getDate() - 1); }
    else if (period === 'week') { end.setDate(today.getDate() - 8); start.setDate(today.getDate() - 14); }
    else if (period === 'month') { end.setDate(today.getDate() - 31); start.setDate(today.getDate() - 60); }
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
};

const buildParams = (dates: { start: string; end: string }) => {
    const p = new URLSearchParams();
    if (dates.start) p.append('startDate', dates.start);
    if (dates.end) p.append('endDate', dates.end);
    if (filters.base_id) p.append('base_id', String(filters.base_id));
    if (filters.manager_id) p.append('manager_id', String(filters.manager_id));
    if (filters.product_id) p.append('product_id', String(filters.product_id));
    if (filters.okved) p.append('okved', filters.okved);
    return p;
};

const prevValue = (arr: any[], idKey: string, idVal: any, valKey: string) => {
    const item = arr.find(i => i[idKey] === idVal);
    return item ? (item[valKey] || 0) : 0;
};
const trendHTML = (current: number, previous: number) => {
    if (filters.period === 'all') return '';
    const diff = current - previous;
    const pct = previous === 0 ? (current > 0 ? 100 : 0) : Math.round((Math.abs(diff) / previous) * 100);
    if (diff > 0) return `<span style="color:#27ae60;font-size:11px;margin-left:5px;">↑${money(diff)} (+${pct}%)</span>`;
    if (diff < 0) return `<span style="color:#e74c3c;font-size:11px;margin-left:5px;">↓${money(Math.abs(diff))} (-${pct}%)</span>`;
    return `<span style="color:#95a5a6;font-size:11px;margin-left:5px;">—</span>`;
};
const trendClass = (c: number, p: number) => c > p ? 'trend-up' : (c < p ? 'trend-down' : 'trend-neutral');
const trendArrow = (c: number, p: number) => c > p ? '↑' : (c < p ? '↓' : '—');
const trendPct = (c: number, p: number) => p === 0 ? (c > 0 ? 100 : 0) : Math.round((Math.abs(c - p) / p) * 100);

const selectBaseFilter = (base: any) => {
    filters.base_id = base.id;
    searchBaseQuery.value = base.name;
    showBaseDropdown.value = false;
    loadAnalytics();
};
const hideBaseDropdown = () => { setTimeout(() => { showBaseDropdown.value = false; }, 150); };
const handleBaseInput = () => {
    if (searchBaseQuery.value === '') { filters.base_id = ''; loadAnalytics(); }
};

const chartData = computed(() => {
    const rows = [...dailyStats.value].reverse();
    return {
        labels: rows.map(d => formatDate(d.date)),
        datasets: [
            { label: 'Исходящие наборы', backgroundColor: '#3498db', data: rows.map(d => d.total_outbound) },
            { label: 'Разговоры', backgroundColor: '#2ecc71', data: rows.map(d => d.valid_conversations) }
        ]
    };
});
const baseManagersChartData = computed(() => {
    const top = managers.value.slice(0, 15);
    const labels = top.map(m => m.manager_name);
    if (baseChartMetric.value === 'calls') return { labels, datasets: [
        { label: 'Звонки', backgroundColor: '#3498db', data: top.map(m => m.total_calls) },
        { label: 'Разговоры', backgroundColor: '#2ecc71', data: top.map(m => m.valid_conversations) }
    ] };
    if (baseChartMetric.value === 'leads') return { labels, datasets: [
        { label: 'Кач. лиды', backgroundColor: '#9b59b6', data: top.map(m => m.quality_leads) },
        { label: 'Оплаты', backgroundColor: '#f39c12', data: top.map(m => m.paid_deals) }
    ] };
    return { labels, datasets: [{ label: 'Выручка (₽)', backgroundColor: '#27ae60', data: top.map(m => m.amount_sum) }] };
});
const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top' as const } },
    scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
};

const loadLists = async () => {
    try {
        const [b, u, p, o] = await Promise.all([
            fetch(`${API}/bases`), fetch(`${API}/users`), fetch(`${API}/products`), fetch(`${API}/okved`)
        ]);
        if (b.ok) basesList.value = await b.json();
        if (u.ok) managersList.value = await u.json();
        if (p.ok) productsList.value = await p.json();
        if (o.ok) okvedList.value = await o.json();
    } catch (e) { console.error('Ошибка справочников', e); }
};
const loadSyncStatus = async () => {
    try {
        const res = await fetch(`${API}/sync-status`);
        if (res.ok) syncStatus.value = await res.json();
    } catch (e) { /* не критично */ }
};
const loadDataIssues = async () => {
    try {
        const res = await fetch(`${API}/data-issues`);
        if (res.ok) dataIssues.value = await res.json();
    } catch (e) { console.error(e); }
};

const sumKpi = (rows: any[], target: any) => {
    target.calls = rows.reduce((s, d) => s + (d.total_outbound || 0), 0);
    target.conversations = rows.reduce((s, d) => s + (d.valid_conversations || 0), 0);
    target.leads = rows.reduce((s, d) => s + (d.quality_leads || 0), 0);
    target.deals = rows.reduce((s, d) => s + (d.paid_deals || 0), 0);
    target.revenue = rows.reduce((s, d) => s + (d.amount_sum || 0), 0);
};

const loadAnalytics = async () => {
    loading.value = true;
    const cur = buildParams(getDatesForPeriod(filters.period));
    const prev = buildParams(getPrevDates(filters.period));
    // Для среза ОКВЭД фильтр по самому ОКВЭД не применяем — таблица должна показывать все коды
    const okvedParams = new URLSearchParams(cur.toString());
    okvedParams.delete('okved');
    try {
        const [rMan, rBas, rDay, rRef, rSil, rPC, rProd, rOkved] = await Promise.all([
            fetch(`${API}/analytics/managers?${cur}`),
            fetch(`${API}/analytics/bases?${cur}`),
            fetch(`${API}/dashboard?${cur}`),
            fetch(`${API}/analytics/refusals?${cur}`),
            fetch(`${API}/analytics/refusals/silent?${cur}`),
            fetch(`${API}/analytics/products-and-calls?${cur}`),
            fetch(`${API}/analytics/products?${cur}`),
            fetch(`${API}/analytics/okved?${okvedParams}`)
        ]);
        if (rMan.ok) managers.value = await rMan.json();
        if (rBas.ok) bases.value = await rBas.json();
        if (rDay.ok) dailyStats.value = await rDay.json();
        if (rRef.ok) refusals.value = await rRef.json();
        if (rSil.ok) silentManagers.value = await rSil.json();
        if (rPC.ok) {
            const data = await rPC.json();
            productsStats.value = data.leadsByProduct || [];
            callsConnectionStats.value = data.callsStats || {};
        }
        if (rProd.ok) salesByProduct.value = (await rProd.json()).salesByProduct || [];
        if (rOkved.ok) okvedStats.value = await rOkved.json();
        sumKpi(dailyStats.value, kpiCurrent);

        if (filters.period !== 'all') {
            const [pMan, pBas, pRef, pDay] = await Promise.all([
                fetch(`${API}/analytics/managers?${prev}`),
                fetch(`${API}/analytics/bases?${prev}`),
                fetch(`${API}/analytics/refusals?${prev}`),
                fetch(`${API}/dashboard?${prev}`)
            ]);
            if (pMan.ok) managersPrev.value = await pMan.json();
            if (pBas.ok) basesPrev.value = await pBas.json();
            if (pRef.ok) refusalsPrev.value = await pRef.json();
            if (pDay.ok) sumKpi(await pDay.json(), kpiPrev);
        } else {
            managersPrev.value = []; basesPrev.value = []; refusalsPrev.value = [];
            kpiPrev.calls = 0; kpiPrev.conversations = 0; kpiPrev.leads = 0; kpiPrev.deals = 0; kpiPrev.revenue = 0;
        }
    } catch (e) {
        console.error('Ошибка загрузки дашборда', e);
    } finally {
        loading.value = false;
    }
};

const recalcStats = async () => {
    recalcLoading.value = true;
    recalcMsg.value = '';
    try {
        const res = await fetch(`${API}/calculate-daily-stats`);
        if (res.ok) {
            recalcMsg.value = 'Агрегаты пересчитаны';
            await loadAnalytics();
            await loadDataIssues();
            await loadSyncStatus();
            setTimeout(() => { recalcMsg.value = ''; }, 5000);
        }
    } catch (e) {
        recalcMsg.value = 'Ошибка пересчёта';
    } finally {
        recalcLoading.value = false;
    }
};

const openDrilldown = async (managerId: any, baseId: any, metric: string, title: string, extra: Record<string, any> = {}) => {
    drilldownTitle.value = title;
    drilldownData.value = [];
    showDrilldownModal.value = true;
    drilldownLoading.value = true;
    const { start, end } = getDatesForPeriod(filters.period);
    const params = new URLSearchParams();
    if (start) params.append('startDate', start);
    if (end) params.append('endDate', end);
    params.append('metric', metric);
    if (managerId) params.append('manager_id', String(managerId));
    if (baseId) params.append('base_id', String(baseId));
    if (filters.okved && !extra.okved) params.append('okved', filters.okved);
    if (filters.product_id && !extra.product_id) params.append('product_id', String(filters.product_id));
    for (const [k, v] of Object.entries(extra)) {
        if (v !== null && v !== undefined && v !== '') params.append(k, String(v));
    }
    try {
        const res = await fetch(`${API}/analytics/drilldown?${params}`);
        if (res.ok) drilldownData.value = await res.json();
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

const openReasonDetails = async (reason: any) => {
    selectedReasonName.value = reason.reason_name;
    showReasonModal.value = true;
    reasonLoading.value = true;
    detailedLeads.value = [];
    const { start, end } = getDatesForPeriod(filters.period);
    const params = new URLSearchParams();
    if (start) params.append('startDate', start);
    if (end) params.append('endDate', end);
    if (filters.base_id) params.append('base_id', String(filters.base_id));
    if (filters.manager_id) params.append('manager_id', String(filters.manager_id));
    try {
        const res = await fetch(`${API}/analytics/refusals/${reason.id}/details?${params}`);
        if (res.ok) detailedLeads.value = await res.json();
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
    let csv = 'ID;Тип;Ссылка;Дата;Менеджер;База;Товары;Кросс;ОКВЭД;Компания;ИНН;Стадия;Сумма\n';
    drilldownData.value.forEach(i => {
        csv += [i.b24_id, i.type === 'deal' ? 'Сделка' : 'Лид', b24Link(i.type, i.b24_id),
            formatDateTime(i.created_at), i.manager_name, i.base_name, i.products_list,
            i.is_cross_sale ? 'да' : 'нет', i.okved, i.company_title, i.inn, i.stage, i.amount || 0
        ].map(csvCell).join(';') + '\n';
    });
    download(csv, `Детализация_${drilldownTitle.value.replace(/[^\wа-яА-ЯёЁ -]/g, '')}.csv`);
};

const exportIssues = () => {
    let csv = 'Проверка;Запись\n';
    issueGroups.forEach(g => {
        (dataIssues.value.details[g.key] || []).forEach((item: any) => {
            csv += [g.title, g.fmt(item)].map(csvCell).join(';') + '\n';
        });
    });
    download(csv, 'Проблемы_данных.csv');
};

const exportReport = () => {
    const { start, end } = getDatesForPeriod(filters.period);
    let csv = `Сводка по компании\nПериод;${start || 'всё время'};${end || ''}\n\n`;
    csv += 'KPI\nНаборы;Разговоры;% дозвона;Кач. лиды;Оплаты;Выручка\n';
    csv += [kpiCurrent.calls, kpiCurrent.conversations, connectionRate.value, kpiCurrent.leads, kpiCurrent.deals, kpiCurrent.revenue].map(csvCell).join(';') + '\n\n';
    csv += 'МЕНЕДЖЕРЫ\nСотрудник;Отдел;Звонки;Разговоры;Кач. лиды;Передано;Оплаты;Сумма\n';
    managers.value.forEach(m => {
        csv += [m.manager_name, m.department_name, m.total_calls, m.valid_conversations, m.quality_leads, m.transfers, m.paid_deals, m.amount_sum].map(csvCell).join(';') + '\n';
    });
    csv += '\nБАЗЫ\nБаза;Осн. продукт;Кач. лиды;Оплаты;Осн. продукт ₽;Кросс ₽;Не определён ₽;Итого ₽\n';
    bases.value.forEach(b => {
        csv += [b.base_name, b.main_product_name, b.quality_leads, b.paid_deals, b.main_amount, b.cross_amount, b.unknown_amount, b.amount_sum].map(csvCell).join(';') + '\n';
    });
    csv += '\nПРОДУКТЫ ПО ТОВАРАМ\nПродукт;Группа;Сделок;Кол-во;Сумма строк;Оплачено S;Кросс ₽\n';
    salesByProduct.value.forEach(p => {
        csv += [p.product_name, p.product_group, p.deals_count, p.quantity, p.rows_amount, p.won_amount, p.cross_amount].map(csvCell).join(';') + '\n';
    });
    csv += '\nОКВЭД\nКод;Название;Лидов передано;Сделок;Оплачено;Конверсия %;Ср. чек;Сумма оплат\n';
    okvedStats.value.forEach(o => {
        csv += [o.okved_code, o.okved_name, o.leads_transferred || 0, o.deals_count, o.won_deals, conv(o.won_deals, o.deals_count), o.avg_check || 0, o.won_amount || 0].map(csvCell).join(';') + '\n';
    });
    csv += '\nПРИЧИНЫ ОТКАЗОВ\nПричина;Лидов;Доля %\n';
    refusals.value.forEach(r => {
        csv += [r.reason_name, r.count, refusalShare(r.count)].map(csvCell).join(';') + '\n';
    });
    csv += '\nМОЛЧУНЫ\nМенеджер;Отказов без причины\n';
    silentManagers.value.forEach(s => {
        csv += [s.manager_name, s.silent_count].map(csvCell).join(';') + '\n';
    });
    download(csv, `Сводка_компании_${filters.period}.csv`);
};

onMounted(() => {
    loadLists();
    loadAnalytics();
    loadDataIssues();
    loadSyncStatus();
});
</script>

<style scoped>
.director-dashboard { width: 100%; font-family: Arial, sans-serif; }
.header-row { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px; margin-bottom: 15px; flex-wrap: wrap; gap: 10px; }
.subtitle { color: #7f8c8d; font-size: 13px; margin: 5px 0 0; }
.header-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.btn-settings { background: #f4f6f7; border: 1px solid #ddd; padding: 8px 14px; border-radius: 6px; cursor: pointer; color: #34495e; font-size: 13px; font-weight: bold; }
.btn-recalc { background: #8e44ad; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; }
.btn-recalc:hover:not(:disabled) { background: #7d3c98; }
.btn-recalc:disabled { background: #bdc3c7; cursor: not-allowed; }
.btn-export { padding: 8px 15px; background: #27ae60; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; }
.btn-export:hover:not(:disabled) { background: #2ecc71; }
.btn-export:disabled { background: #95a5a6; cursor: not-allowed; }
.btn-export-sm { padding: 6px 12px; background: #27ae60; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px; }
.btn-export-sm:disabled { background: #bdc3c7; }
.settings-card { background: white; border: 1px solid #eee; border-left: 4px solid #3498db; border-radius: 10px; padding: 15px 20px; margin-bottom: 15px; }
.settings-label { display: block; font-size: 11px; font-weight: bold; color: #7f8c8d; text-transform: uppercase; margin-bottom: 8px; }
.settings-row { display: flex; gap: 10px; flex-wrap: wrap; }
.settings-row .filter-input { flex: 1; min-width: 260px; }
.settings-hint { display: block; margin-top: 8px; color: #95a5a6; font-size: 12px; }
.btn-save { background: #3498db; color: white; border: none; padding: 9px 18px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; }
.sync-bar { display: flex; gap: 20px; flex-wrap: wrap; align-items: center; background: #f8f9fa; border: 1px solid #eee; border-radius: 8px; padding: 10px 15px; font-size: 12px; color: #34495e; margin-bottom: 15px; }
.sync-bar.warn { background: #fffcf5; border-color: #f39c12; }
.sync-warn-text { color: #d35400; font-weight: bold; }
.sync-ok-text { color: #27ae60; font-weight: bold; }
.filters-card { background: white; padding: 18px 20px; border-radius: 10px; border: 1px solid #eee; margin-bottom: 10px; display: flex; gap: 15px; flex-wrap: wrap; align-items: flex-end; }
.filter-group { flex: 1; min-width: 170px; display: flex; flex-direction: column; gap: 6px; }
.filter-group label { font-size: 11px; font-weight: bold; color: #7f8c8d; text-transform: uppercase; letter-spacing: 0.4px; }
.filter-input { padding: 9px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; background: white; color: #2c3e50; outline: none; width: 100%; box-sizing: border-box; }
.filter-hint { font-size: 12px; color: #d35400; background: #fffcf5; border: 1px solid #fad7a0; border-radius: 6px; padding: 8px 12px; margin: 0 0 15px; }
.autocomplete-wrapper { position: relative; }
.dropdown-list { position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ddd; border-radius: 6px; max-height: 250px; overflow-y: auto; z-index: 1000; box-shadow: 0 8px 16px rgba(0,0,0,0.1); margin-top: 5px; }
.dropdown-item { padding: 11px 12px; cursor: pointer; border-bottom: 1px solid #f5f6fa; font-size: 13px; }
.dropdown-item:last-child { border-bottom: none; }
.dropdown-item:hover { background: #f0f4f8; }
.dashboard-grid { display: flex; flex-direction: column; gap: 25px; }
.kpi-grid { display: flex; gap: 18px; flex-wrap: wrap; }
.kpi-card { flex: 1; min-width: 185px; background: white; padding: 18px; border-radius: 10px; border: 1px solid #eee; display: flex; flex-direction: column; }
.kpi-title { font-size: 12px; color: #7f8c8d; font-weight: bold; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.4px; }
.kpi-value { font-size: 26px; font-weight: bold; color: #2c3e50; margin-bottom: 8px; }
.kpi-sub { font-size: 12px; color: #7f8c8d; }
.kpi-trend { font-size: 13px; font-weight: bold; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.trend-sub { font-size: 11px; color: #95a5a6; font-weight: normal; }
.trend-up { color: #27ae60; }
.trend-down { color: #e74c3c; }
.trend-neutral { color: #95a5a6; }
.card { background: white; padding: 20px; border-radius: 10px; border: 1px solid #eee; min-width: 300px; }
.card h3 { margin-top: 0; color: #34495e; margin-bottom: 15px; font-size: 16px; }
.card-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 15px; }
.card-note { font-size: 12px; color: #95a5a6; margin: 10px 0 0; }
.hint { font-size: 12px; font-weight: normal; color: #95a5a6; margin-left: 8px; }
.split-row { display: flex; gap: 20px; flex-wrap: wrap; }
.metric-toggle { display: flex; gap: 8px; flex-wrap: wrap; }
.metric-btn { background: #ecf0f1; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; color: #34495e; font-size: 12px; font-weight: bold; }
.metric-btn.active { background: #9b59b6; color: white; }
.chart-container { position: relative; width: 100%; }
.conn-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px dashed #eee; font-size: 13px; color: #34495e; }
.conn-row strong { font-size: 17px; }
.conn-total { margin-top: 12px; font-size: 12px; color: #95a5a6; text-align: right; }
.table-responsive { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.scroll-320 { max-height: 320px; overflow-y: auto; }
.data-table { width: 100%; border-collapse: collapse; min-width: 600px; }
.data-table th, .data-table td { padding: 11px 12px; border-bottom: 1px solid #f0f0f0; text-align: left; font-size: 13px; white-space: nowrap; }
.data-table th { background: #f5f6fa; color: #7f8c8d; font-weight: bold; position: sticky; top: 0; z-index: 2; }
.interactive-table tbody tr { cursor: pointer; transition: background 0.2s; }
.interactive-table tbody tr:hover { background: #f8f9fa; }
.empty { text-align: center; color: #7f8c8d; padding: 22px !important; }
.muted { color: #95a5a6; }
.money { font-weight: bold; color: #27ae60; }
.unknown-amount { color: #d35400; font-weight: bold; }
.manager-cell { display: flex; align-items: center; gap: 8px; }
.dept-badge { background: #f4f6f7; color: #34495e; padding: 2px 7px; border-radius: 4px; font-size: 11px; }
.okved-badge { background: #f4ecf7; color: #7d3c98; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
.cross-badge { background: #fef5e7; color: #d35400; border: 1px solid #fad7a0; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 6px; }
.main-badge { background: #eafaf1; color: #1e8449; border: 1px solid #a9dfbf; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; }
.goods-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.company-cell { max-width: 220px; }
.company-name { font-weight: bold; overflow: hidden; text-overflow: ellipsis; }
.drilldown-link { cursor: pointer; text-decoration: underline dashed #bdc3c7; color: inherit; }
.drilldown-link:hover { color: #3498db; text-decoration: underline solid #3498db; }
.b24-id-badge { background: #e3f2fd; color: #2980b9; padding: 4px 9px; border-radius: 4px; font-size: 12px; font-weight: bold; border: 1px solid #bbdefb; display: inline-block; }
.b24-link { text-decoration: none; }
.b24-link:hover { background: #2980b9; color: white; }
.data-issues-banner { background: #fdedec; border: 1px solid #e74c3c; padding: 15px 20px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; gap: 15px; flex-wrap: wrap; }
.issues-left { display: flex; align-items: center; gap: 15px; }
.issues-sub { margin: 5px 0 0; font-size: 12px; color: #e74c3c; }
.btn-issues { background: #e74c3c; color: white; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; }
.btn-issues:hover { background: #c0392b; }
.issue-block { margin-bottom: 20px; }
.issue-block h4 { margin: 0 0 5px; color: #2c3e50; }
.issue-desc { font-size: 12px; color: #7f8c8d; margin: 0 0 8px; }
.issue-list { display: flex; flex-wrap: wrap; gap: 8px; }
.issue-chip { background: #f5f6fa; color: #2c3e50; padding: 4px 8px; border-radius: 4px; font-size: 12px; border: 1px solid #ddd; display: inline-block; }
.issue-link { text-decoration: none; border-color: #bbdefb; background: #e3f2fd; color: #2980b9; }
.issue-link:hover { background: #2980b9; color: white; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 1000; padding: 20px; }
.modal-top { z-index: 1100; }
.modal-content { background: white; border-radius: 12px; width: 100%; max-width: 1150px; max-height: 90vh; display: flex; flex-direction: column; }
.modal-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid #eee; }
.btn-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #7f8c8d; }
.btn-close:hover { color: #e74c3c; }
.modal-body { padding: 20px; overflow-y: auto; }
.modal-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 13px; }
.modal-warn { background: #fffcf5; border: 1px solid #f39c12; color: #d35400; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 12px; }
.deal-info { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px 20px; background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px; font-size: 13px; }
.totals { display: flex; justify-content: space-between; gap: 15px; flex-wrap: wrap; margin-top: 15px; padding-top: 12px; border-top: 1px solid #eee; font-size: 13px; }
@media (max-width: 768px) { .filter-group { min-width: 100%; } }
</style>