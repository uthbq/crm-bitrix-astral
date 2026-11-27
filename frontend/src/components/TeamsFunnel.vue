<template>
    <div class="teams-funnel">
        <div class="header-row">
            <div>
                <h2 style="margin: 0; color: #2c3e50;">🚀 Команды и воронка подключений</h2>
                <p class="subtitle">Сделки по отделам, воронкам, стадиям потерь, компаниям, ОКВЭД и фактическим продуктам</p>
            </div>
            <div class="header-actions">
                <button @click="showSettings = !showSettings" class="btn-settings">⚙️ Портал</button>
                <button @click="exportReport" class="btn-export" :disabled="loading">📥 Экспорт отчёта</button>
            </div>
        </div>

        <div v-if="showSettings" class="settings-card">
            <label class="settings-label">Адрес портала Битрикс24 для ссылок на карточки</label>
            <div class="settings-row">
                <input v-model="portalUrl" placeholder="https://yourcompany.bitrix24.ru" class="filter-input" />
                <button @click="savePortal" class="btn-save">Сохранить</button>
            </div>
            <small class="settings-hint">Задаётся отдельно от адреса Chatium API, хранится в браузере.</small>
        </div>

        <div v-if="syncStatus" class="sync-bar" :class="{ warn: syncStatus.incomplete }">
            <span>Последняя синхронизация сделок: <strong>{{ formatTs(dealsSyncTs) }}</strong></span>
            <span v-if="syncStatus.products_pending > 0" class="sync-warn-text">
                Товары не загружены у {{ syncStatus.products_pending }} сделок — кросс-продажи по ним не определены
            </span>
            <span v-else class="sync-ok-text">Данные полные</span>
        </div>

        <div class="filters-card">
            <div class="filter-group">
                <label>Период</label>
                <select v-model="filters.period" @change="loadData" class="filter-input">
                    <option value="all">За всё время</option>
                    <option value="today">Сегодня</option>
                    <option value="week">Последние 7 дней</option>
                    <option value="month">Последние 30 дней</option>
                    <option value="year">Последний год</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Воронка</label>
                <select v-model="filters.category_id" @change="loadData" class="filter-input">
                    <option value="">Все воронки</option>
                    <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Отдел (команда)</label>
                <select v-model="filters.department_id" @change="loadData" class="filter-input">
                    <option value="">Все отделы</option>
                    <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
                </select>
            </div>
            <div class="filter-group">
                <label>ОКВЭД</label>
                <select v-model="filters.okved" @change="loadData" class="filter-input">
                    <option value="">Все ОКВЭД</option>
                    <option v-for="o in okvedList" :key="o.code" :value="o.code">
                        {{ o.code }}{{ o.name ? ' — ' + o.name : '' }}
                    </option>
                </select>
            </div>
            <div class="filter-group">
                <label>Фактический продукт (по товарам)</label>
                <select v-model="filters.product_id" @change="loadData" class="filter-input">
                    <option value="">Все продукты</option>
                    <option v-for="p in productsList" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
            </div>
            <div class="filter-group filter-checkboxes">
                <label class="tm-checkbox">
                    <input type="checkbox" v-model="filters.onlyTm" @change="loadData" />
                    <span>Только от ТМ</span>
                </label>
                <label class="cross-checkbox">
                    <input type="checkbox" v-model="filters.cross_only" @change="loadData" />
                    <span>Только кросс</span>
                </label>
            </div>
        </div>

        <div v-if="loading" class="empty">Загрузка аналитики…</div>
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
                    <div class="kpi-value" style="color: #2980b9;">{{ money(summary.won_amount) }} ₽</div>
                    <div class="kpi-sub">Сред. время до оплаты: <strong>{{ summary.avg_days_to_pay ?? '—' }} дн.</strong></div>
                </div>
                <div class="kpi-card" style="border-left: 4px solid #f39c12;">
                    <div class="kpi-title">🔀 Кросс-продажи</div>
                    <div class="kpi-value" style="color: #d35400;">{{ summary.cross_deals || 0 }}</div>
                    <div class="kpi-sub">Сумма: <strong>{{ money(summary.cross_amount) }} ₽</strong> (по товарам)</div>
                </div>
            </div>

            <div v-if="summary.no_okved > 0" class="warn-banner">
                Без ОКВЭД: <strong>{{ summary.no_okved }}</strong> сделок.
                Коды подтягиваются из Dadata по ИНН при синхронизации; сделки без ИНН обогатить невозможно.
            </div>

            <div class="split-row">
                <div class="card" style="flex: 1.6;">
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
                                    <th style="text-align: center;">Кросс шт</th>
                                    <th style="text-align: right;">Кросс ₽</th>
                                    <th style="text-align: right;">Выручка</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-if="byDepartment.length === 0"><td colspan="9" class="empty">Нет данных</td></tr>
                                <tr v-for="d in byDepartment" :key="d.department_id">
                                    <td><strong>{{ d.department_name }}</strong></td>
                                    <td>{{ d.total_deals }}</td>
                                    <td>{{ d.in_work }}</td>
                                    <td style="color: #27ae60; font-weight: bold;">{{ d.won_deals }}</td>
                                    <td style="color: #e74c3c;">{{ d.lost_deals }}</td>
                                    <td><strong>{{ calcConv(d.won_deals, d.total_deals) }}%</strong></td>
                                    <td style="text-align: center; color: #d35400; font-weight: bold;">{{ d.cross_deals || 0 }}</td>
                                    <td style="text-align: right; color: #d35400;">{{ money(d.cross_amount) }}</td>
                                    <td style="text-align: right; font-weight: bold; color: #27ae60;">{{ money(d.won_amount) }} ₽</td>
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
                                    <th style="text-align: right;">Сумма</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-if="lossStages.length === 0"><td colspan="4" class="empty">Потерь нет</td></tr>
                                <tr v-for="(s, idx) in lossStages" :key="idx">
                                    <td><strong>{{ s.stage_name }}</strong></td>
                                    <td class="muted">{{ s.category_name }}</td>
                                    <td style="text-align: right; color: #e74c3c; font-weight: bold;">{{ s.count }}</td>
                                    <td style="text-align: right;" class="muted">{{ money(s.lost_amount) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="card">
                <h3>🏆 Рейтинг менеджеров по сделкам
                    <span class="hint">подчёркнутые цифры открывают детализацию</span>
                </h3>
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
                                <th style="text-align: center;">Кросс шт</th>
                                <th style="text-align: right;">Кросс ₽</th>
                                <th>Цикл оплаты</th>
                                <th style="text-align: right;">Выручка</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="managersRating.length === 0"><td colspan="11" class="empty">Нет данных</td></tr>
                            <tr v-for="(m, idx) in managersRating" :key="m.manager_id">
                                <td>
                                    <span v-if="idx < 3">{{ ['🥇','🥈','🥉'][idx] }} </span>
                                    <strong>{{ m.manager_name }}</strong>
                                </td>
                                <td><span class="dept-badge">{{ m.department_name }}</span></td>
                                <td>{{ m.total_deals }}</td>
                                <td>{{ m.in_work }}</td>
                                <td style="color: #27ae60; font-weight: bold;">
                                    <span class="drill-link" @click="openDrilldown({ manager_id: m.manager_id }, 'won_deals', `Оплаченные сделки: ${m.manager_name}`)">
                                        {{ m.won_deals }}
                                    </span>
                                </td>
                                <td style="color: #e74c3c;">{{ m.lost_deals }}</td>
                                <td><strong>{{ calcConv(m.won_deals, m.total_deals) }}%</strong></td>
                                <td style="text-align: center;">
                                    <span v-if="m.cross_deals" class="drill-link cross-text" @click="openDrilldown({ manager_id: m.manager_id }, 'cross_deals', `Кросс-продажи: ${m.manager_name}`)">
                                        {{ m.cross_deals }}
                                    </span>
                                    <span v-else class="muted">0</span>
                                </td>
                                <td style="text-align: right; color: #d35400;">{{ money(m.cross_amount) }}</td>
                                <td>{{ m.avg_days_to_pay !== null ? m.avg_days_to_pay + ' дн.' : '—' }}</td>
                                <td style="text-align: right; font-weight: bold; color: #27ae60;">
                                    <span class="drill-link" @click="openDrilldown({ manager_id: m.manager_id }, 'paid_deals', `Сделки с суммой: ${m.manager_name}`)">
                                        {{ money(m.won_amount) }} ₽
                                    </span>
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
                                <th>ОКВЭД</th>
                                <th>Товары</th>
                                <th>Сделок</th>
                                <th>Оплачено</th>
                                <th style="text-align: center;">Кросс</th>
                                <th style="text-align: right;">Выручка</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="companiesRating.length === 0"><td colspan="8" class="empty">Нет данных по компаниям</td></tr>
                            <tr v-for="(c, idx) in companiesRating" :key="c.company_key || idx">
                                <td><strong>{{ c.company_name }}</strong></td>
                                <td class="muted">{{ c.inn || '—' }}</td>
                                <td>
                                    <span v-if="c.okved" class="okved-badge">{{ c.okved }}</span>
                                    <span v-else class="muted">—</span>
                                </td>
                                <td class="goods-cell" :title="c.products_list">{{ c.products_list || '—' }}</td>
                                <td>{{ c.deals_count }}</td>
                                <td style="color: #27ae60; font-weight: bold;">{{ c.won_deals }}</td>
                                <td style="text-align: center; color: #d35400; font-weight: bold;">{{ c.cross_deals || 0 }}</td>
                                <td style="text-align: right; font-weight: bold; color: #27ae60;">{{ money(c.won_amount) }} ₽</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="card" style="border-left: 4px solid #7d3c98;">
                <div class="card-head">
                    <h3 style="margin: 0;">🏭 Срез по ОКВЭД</h3>
                    <select v-model="okvedSort" class="filter-input" style="max-width: 240px;">
                        <option value="amount">Топ по сумме оплат</option>
                        <option value="leads">Топ по переданным лидам</option>
                        <option value="conv">Топ по конверсии</option>
                        <option value="avg">Топ по среднему чеку</option>
                        <option value="speed">Топ по скорости закрытия</option>
                        <option value="lost">Топ по отказам</option>
                    </select>
                </div>
                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>ОКВЭД</th>
                                <th>Название</th>
                                <th>Лидов передано</th>
                                <th>Сделок</th>
                                <th>Оплачено</th>
                                <th>Отказы</th>
                                <th>Конверсия</th>
                                <th style="text-align: right;">Ср. чек</th>
                                <th>Ср. цикл</th>
                                <th style="text-align: right;">Сумма оплат</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="sortedOkved.length === 0"><td colspan="10" class="empty">Нет данных по ОКВЭД</td></tr>
                            <tr v-for="o in sortedOkved" :key="o.okved_code">
                                <td><span class="okved-badge">{{ o.okved_code }}</span></td>
                                <td class="goods-cell muted" :title="o.okved_name">{{ o.okved_name || '—' }}</td>
                                <td>{{ o.leads_transferred || 0 }}</td>
                                <td>{{ o.deals_count }}</td>
                                <td style="color: #27ae60; font-weight: bold;">
                                    <span class="drill-link" @click="openDrilldown({ okved: o.okved_code }, 'won_deals', `Оплаченные сделки ОКВЭД ${o.okved_code}`)">
                                        {{ o.won_deals }}
                                    </span>
                                </td>
                                <td style="color: #e74c3c;">{{ o.lost_deals }}</td>
                                <td><strong>{{ calcConv(o.won_deals, o.deals_count) }}%</strong></td>
                                <td style="text-align: right;">{{ money(o.avg_check) }} ₽</td>
                                <td>{{ o.avg_days_to_pay !== null ? o.avg_days_to_pay + ' дн.' : '—' }}</td>
                                <td style="text-align: right; font-weight: bold; color: #27ae60;">{{ money(o.won_amount) }} ₽</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="note">Названия ОКВЭД заполняются в справочнике; коды приходят из Dadata автоматически.</p>
            </div>

            <div class="card" style="border-left: 4px solid #16a085;">
                <h3>📦 Продажи по фактическим продуктам (товарные строки)</h3>
                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Продукт</th>
                                <th>Группа</th>
                                <th>Сделок</th>
                                <th style="text-align: right;">Кол-во</th>
                                <th style="text-align: right;">Сумма строк</th>
                                <th style="text-align: right;">Из них оплачено (S)</th>
                                <th style="text-align: right;">Кросс ₽</th>
                                <th style="text-align: center;">Кросс строк</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-if="productStats.length === 0"><td colspan="8" class="empty">Товарные позиции не загружены</td></tr>
                            <tr v-for="(p, idx) in productStats" :key="idx">
                                <td>
                                    <span v-if="dictionaryProductId(p.product_name)" class="drill-link"
                                          @click="openDrilldown({ product_id: dictionaryProductId(p.product_name) }, 'paid_deals', `Сделки с продуктом: ${p.product_name}`)">
                                        <strong>{{ p.product_name }}</strong>
                                    </span>
                                    <strong v-else :title="'Продукта нет в справочнике — детализация недоступна'">{{ p.product_name }}</strong>
                                </td>
                                <td class="muted">{{ p.product_group }}</td>
                                <td>{{ p.deals_count }}</td>
                                <td style="text-align: right;">{{ p.quantity }}</td>
                                <td style="text-align: right; font-weight: bold;">{{ money(p.rows_amount) }} ₽</td>
                                <td style="text-align: right; color: #27ae60;">{{ money(p.won_amount) }} ₽</td>
                                <td style="text-align: right; color: #d35400; font-weight: bold;">{{ money(p.cross_amount) }} ₽</td>
                                <td style="text-align: center; color: #d35400;">{{ p.cross_rows }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="note">
                    Суммы берутся из товарных позиций сделки, а не из поля «Продукт» в CRM — поэтому продажа КЭДО
                    при основном продукте базы КЦР видна как кросс, даже если поле не обновили.
                </p>
            </div>
        </div>

        <div v-if="showDrilldown" class="modal-overlay" @click.self="showDrilldown = false">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 style="margin: 0;">Детализация: <span style="color: #3498db;">{{ drilldownTitle }}</span></h3>
                    <button @click="showDrilldown = false" class="btn-close">✖</button>
                </div>
                <div class="modal-body">
                    <div v-if="drilldownLoading" class="empty">Поиск в локальной базе…</div>
                    <template v-else>
                        <div class="modal-toolbar">
                            <span class="muted">Найдено записей: <strong>{{ drilldownRows.length }}</strong> (до 200)</span>
                            <button @click="exportDrilldown" class="btn-export-sm" :disabled="drilldownRows.length === 0">📥 CSV</button>
                        </div>
                        <div class="table-responsive">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Дата</th>
                                        <th>Менеджер</th>
                                        <th>База</th>
                                        <th>Товары</th>
                                        <th>ОКВЭД</th>
                                        <th>Компания / ИНН</th>
                                        <th>Стадия</th>
                                        <th style="text-align: right;">Сумма</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-if="drilldownRows.length === 0"><td colspan="9" class="empty">Карточки не найдены</td></tr>
                                    <tr v-for="item in drilldownRows" :key="item.type + '-' + item.b24_id">
                                        <td>
                                            <a v-if="b24Link(item.type, item.b24_id)" :href="b24Link(item.type, item.b24_id)"
                                               target="_blank" rel="noopener" class="id-badge id-link">
                                                {{ item.type === 'deal' ? 'Сделка' : 'Лид' }} #{{ item.b24_id }}
                                            </a>
                                            <span v-else class="id-badge">{{ item.type === 'deal' ? 'Сделка' : 'Лид' }} #{{ item.b24_id }}</span>
                                        </td>
                                        <td>{{ formatDate(item.created_at) }}</td>
                                        <td>{{ item.manager_name }}</td>
                                        <td>{{ item.base_name || '—' }}</td>
                                        <td class="goods-cell">
                                            <span v-if="item.type === 'deal'" class="drill-link" :title="item.products_list"
                                                  @click="openProducts(item.b24_id)">{{ item.products_list || '—' }}</span>
                                            <span v-else :title="item.products_list">{{ item.products_list || '—' }}</span>
                                            <span v-if="item.is_cross_sale" class="cross-badge">кросс</span>
                                        </td>
                                        <td>
                                            <span v-if="item.okved" class="okved-badge">{{ item.okved }}</span>
                                            <span v-else class="muted">—</span>
                                        </td>
                                        <td class="company-cell">
                                            <div class="company-name">{{ item.company_title || '—' }}</div>
                                            <div class="muted" style="font-size: 11px;">{{ item.inn || 'ИНН не указан' }}</div>
                                        </td>
                                        <td>{{ item.stage || '—' }}</td>
                                        <td style="text-align: right; font-weight: bold; color: #27ae60;">
                                            {{ item.amount ? money(item.amount) + ' ₽' : '—' }}
                                        </td>
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
                        <div v-if="!productDeal?.main_product_name" class="warn-banner">
                            У базы не назначен основной продукт — кросс по этой сделке не определяется.
                        </div>
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
                            <span v-if="Math.abs(amountDiff) > 1" style="color:#c0392b; font-weight:bold;">
                                Расхождение с суммой сделки: {{ money(amountDiff) }} ₽
                            </span>
                            <span v-else style="color:#27ae60; font-weight:bold;">Суммы сходятся</span>
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

const loading = ref(true);
const categories = ref<any[]>([]);
const departments = ref<any[]>([]);
const productsList = ref<any[]>([]);
const okvedList = ref<any[]>([]);
const summary = ref<any>({});
const byDepartment = ref<any[]>([]);
const lossStages = ref<any[]>([]);
const managersRating = ref<any[]>([]);
const companiesRating = ref<any[]>([]);
const okvedStats = ref<any[]>([]);
const productStats = ref<any[]>([]);
const syncStatus = ref<any>(null);
const okvedSort = ref('amount');
const portalUrl = ref(localStorage.getItem('b24_portal_url') || '');
const showSettings = ref(false);

const filters = reactive({
    period: 'month',
    category_id: '',
    department_id: '',
    okved: '',
    product_id: '',
    onlyTm: true,
    cross_only: false
});

const showDrilldown = ref(false);
const drilldownLoading = ref(false);
const drilldownTitle = ref('');
const drilldownRows = ref<any[]>([]);

const showProducts = ref(false);
const productsLoading = ref(false);
const productDeal = ref<any>(null);
const productRows = ref<any[]>([]);

const money = (v: any) => (Number(v) || 0).toLocaleString('ru-RU');
const calcConv = (won: number, total: number) => (!total ? 0 : Math.round((won / total) * 100));
const conversionRate = computed(() => calcConv(summary.value.won_deals, summary.value.total_deals));
const normName = (s: string) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();

const dealsSyncTs = computed(() => {
    const item = syncStatus.value?.items?.find((i: any) => i.entity === 'deals');
    return item?.last_success_ts || null;
});

const sortedOkved = computed(() => {
    const arr = [...okvedStats.value];
    const conv = (o: any) => (o.deals_count ? o.won_deals / o.deals_count : 0);
    switch (okvedSort.value) {
        case 'leads': return arr.sort((a, b) => (b.leads_transferred || 0) - (a.leads_transferred || 0));
        case 'conv': return arr.sort((a, b) => conv(b) - conv(a));
        case 'avg': return arr.sort((a, b) => (b.avg_check || 0) - (a.avg_check || 0));
        case 'speed': return arr.sort((a, b) => (a.avg_days_to_pay ?? 9999) - (b.avg_days_to_pay ?? 9999));
        case 'lost': return arr.sort((a, b) => (b.lost_deals || 0) - (a.lost_deals || 0));
        default: return arr.sort((a, b) => (b.won_amount || 0) - (a.won_amount || 0));
    }
});

const dictionaryProductId = (name: string): number | null => {
    const p = productsList.value.find(x => normName(x.name) === normName(name));
    return p ? p.id : null;
};

const rowsTotal = computed(() => productRows.value.reduce((s, r) => s + (r.sum || 0), 0));
const amountDiff = computed(() =>
    productDeal.value ? Math.round(((productDeal.value.amount || 0) - rowsTotal.value) * 100) / 100 : 0
);

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

const formatDate = (s: string) => {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
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
    const d = new Date();
    if (period === 'week') d.setDate(d.getDate() - 7);
    else if (period === 'month') d.setMonth(d.getMonth() - 1);
    else if (period === 'year') d.setFullYear(d.getFullYear() - 1);
    return { start: d.toISOString().split('T')[0], end };
};

const buildParams = () => {
    const { start, end } = getDatesForPeriod(filters.period);
    const params = new URLSearchParams();
    if (start) params.append('startDate', start);
    if (end) params.append('endDate', end);
    if (filters.category_id !== '') params.append('category_id', String(filters.category_id));
    if (filters.department_id) params.append('department_id', String(filters.department_id));
    if (filters.okved) params.append('okved', filters.okved);
    if (filters.product_id) params.append('product_id', String(filters.product_id));
    if (filters.cross_only) params.append('cross_only', 'true');
    params.append('onlyTm', String(filters.onlyTm));
    return params;
};

const loadDictionaries = async () => {
    try {
        const [d, p, o] = await Promise.all([
            fetch(`${API}/departments`), fetch(`${API}/products`), fetch(`${API}/okved`)
        ]);
        if (d.ok) departments.value = await d.json();
        if (p.ok) productsList.value = await p.json();
        if (o.ok) okvedList.value = await o.json();
    } catch (e) {
        console.error('Ошибка загрузки справочников', e);
    }
};

const loadData = async () => {
    loading.value = true;
    const params = buildParams();
    const okvedParams = new URLSearchParams(params.toString());
    okvedParams.delete('okved');
    okvedParams.delete('category_id');
    okvedParams.delete('cross_only');
    try {
        const [resFunnel, resOkved, resProducts, resSync] = await Promise.all([
            fetch(`${API}/analytics/teams-funnel?${params.toString()}`),
            fetch(`${API}/analytics/okved?${okvedParams.toString()}`),
            fetch(`${API}/analytics/products?${params.toString()}`),
            fetch(`${API}/sync-status`)
        ]);
        if (resFunnel.ok) {
            const data = await resFunnel.json();
            categories.value = data.categories || [];
            summary.value = data.summary || {};
            byDepartment.value = data.byDepartment || [];
            lossStages.value = data.lossStages || [];
            managersRating.value = data.managersRating || [];
            companiesRating.value = data.companiesRating || [];
        }
        if (resOkved.ok) okvedStats.value = await resOkved.json();
        if (resProducts.ok) {
            const data = await resProducts.json();
            productStats.value = data.salesByProduct || [];
        }
        if (resSync.ok) syncStatus.value = await resSync.json();
    } catch (e) {
        console.error('Ошибка загрузки воронки команд:', e);
    } finally {
        loading.value = false;
    }
};

const openDrilldown = async (extra: Record<string, any>, metric: string, title: string) => {
    drilldownTitle.value = title;
    drilldownRows.value = [];
    showDrilldown.value = true;
    drilldownLoading.value = true;
    const { start, end } = getDatesForPeriod(filters.period);
    const params = new URLSearchParams();
    if (start) params.append('startDate', start);
    if (end) params.append('endDate', end);
    params.append('metric', metric);
    if (filters.okved && !extra.okved) params.append('okved', filters.okved);
    if (filters.product_id && !extra.product_id) params.append('product_id', String(filters.product_id));
    for (const [k, v] of Object.entries(extra)) {
        if (v !== null && v !== undefined && v !== '') params.append(k, String(v));
    }
    try {
        const res = await fetch(`${API}/analytics/drilldown?${params.toString()}`);
        if (res.ok) drilldownRows.value = await res.json();
    } catch (e) {
        console.error('Ошибка детализации', e);
    } finally {
        drilldownLoading.value = false;
    }
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
    } catch (e) {
        console.error('Ошибка загрузки товаров', e);
    } finally {
        productsLoading.value = false;
    }
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
    drilldownRows.value.forEach(i => {
        csv += [
            i.b24_id, i.type === 'deal' ? 'Сделка' : 'Лид', b24Link(i.type, i.b24_id),
            formatDate(i.created_at), i.manager_name, i.base_name, i.products_list,
            i.is_cross_sale ? 'да' : 'нет', i.okved, i.company_title, i.inn, i.stage, i.amount || 0
        ].map(csvCell).join(';') + '\n';
    });
    download(csv, `Детализация_${drilldownTitle.value.replace(/[^\wа-яА-ЯёЁ -]/g, '')}.csv`);
};

const exportReport = () => {
    const { start, end } = getDatesForPeriod(filters.period);
    let csv = `Отчёт: Команды и воронка подключений\nПериод;${start || 'всё время'};${end || ''}\n\n`;

    csv += 'СВОДКА\nВсего сделок;В работе;Оплачено;Потеряно;Выручка;Кросс сделок;Кросс сумма;Без ОКВЭД;Ср. цикл оплаты;Ср. цикл отказа\n';
    csv += [
        summary.value.total_deals || 0, summary.value.in_work || 0, summary.value.won_deals || 0,
        summary.value.lost_deals || 0, summary.value.won_amount || 0, summary.value.cross_deals || 0,
        summary.value.cross_amount || 0, summary.value.no_okved || 0,
        summary.value.avg_days_to_pay ?? '', summary.value.avg_days_to_loss ?? ''
    ].map(csvCell).join(';') + '\n\n';

    csv += 'ОТДЕЛЫ\nОтдел;Всего;В работе;Оплачено;Потеряно;Конверсия %;Кросс шт;Кросс сумма;Выручка\n';
    byDepartment.value.forEach(d => {
        csv += [d.department_name, d.total_deals, d.in_work, d.won_deals, d.lost_deals,
            calcConv(d.won_deals, d.total_deals), d.cross_deals || 0, d.cross_amount || 0, d.won_amount || 0
        ].map(csvCell).join(';') + '\n';
    });

    csv += '\nСТАДИИ ПОТЕРЬ\nСтадия;Воронка;Сделок;Сумма\n';
    lossStages.value.forEach(s => {
        csv += [s.stage_name, s.category_name, s.count, s.lost_amount || 0].map(csvCell).join(';') + '\n';
    });

    csv += '\nМЕНЕДЖЕРЫ\nМенеджер;Отдел;Принято;В работе;Оплачено;Потеряно;Конверсия %;Кросс шт;Кросс сумма;Цикл оплаты;Выручка\n';
    managersRating.value.forEach(m => {
        csv += [m.manager_name, m.department_name, m.total_deals, m.in_work, m.won_deals, m.lost_deals,
            calcConv(m.won_deals, m.total_deals), m.cross_deals || 0, m.cross_amount || 0,
            m.avg_days_to_pay ?? '', m.won_amount || 0].map(csvCell).join(';') + '\n';
    });

    csv += '\nКОМПАНИИ\nКомпания;ИНН;ОКВЭД;Товары;Сделок;Оплачено;Кросс;Выручка\n';
    companiesRating.value.forEach(c => {
        csv += [c.company_name, c.inn, c.okved, c.products_list, c.deals_count, c.won_deals,
            c.cross_deals || 0, c.won_amount || 0].map(csvCell).join(';') + '\n';
    });

    csv += '\nОКВЭД\nКод;Название;Лидов передано;Сделок;Оплачено;Отказы;Конверсия %;Ср. чек;Ср. цикл;Сумма оплат\n';
    sortedOkved.value.forEach(o => {
        csv += [o.okved_code, o.okved_name, o.leads_transferred || 0, o.deals_count, o.won_deals,
            o.lost_deals, calcConv(o.won_deals, o.deals_count), o.avg_check || 0,
            o.avg_days_to_pay ?? '', o.won_amount || 0].map(csvCell).join(';') + '\n';
    });

    csv += '\nПРОДУКТЫ ПО ТОВАРАМ\nПродукт;Группа;Сделок;Кол-во;Сумма строк;Оплачено S;Кросс сумма;Кросс строк\n';
    productStats.value.forEach(p => {
        csv += [p.product_name, p.product_group, p.deals_count, p.quantity, p.rows_amount,
            p.won_amount, p.cross_amount, p.cross_rows].map(csvCell).join(';') + '\n';
    });

    download(csv, `Команды_и_воронки_${filters.period}.csv`);
};

onMounted(() => {
    loadDictionaries();
    loadData();
});
</script>

<style scoped>
.teams-funnel { width: 100%; font-family: Arial, sans-serif; }
.header-row { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f5f6fa; padding-bottom: 15px; margin-bottom: 15px; flex-wrap: wrap; gap: 15px; }
.subtitle { color: #7f8c8d; font-size: 13px; margin: 5px 0 0; max-width: 720px; }
.header-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.btn-settings { background: #f4f6f7; border: 1px solid #ddd; padding: 9px 14px; border-radius: 6px; cursor: pointer; color: #34495e; font-size: 13px; font-weight: bold; }
.btn-export { padding: 9px 16px; background: #27ae60; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; }
.btn-export:hover:not(:disabled) { background: #2ecc71; }
.btn-export:disabled { background: #bdc3c7; cursor: not-allowed; }
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
.filters-card { background: white; padding: 18px 20px; border-radius: 10px; border: 1px solid #eee; margin-bottom: 20px; display: flex; gap: 15px; flex-wrap: wrap; align-items: flex-end; }
.filter-group { flex: 1; min-width: 165px; display: flex; flex-direction: column; gap: 6px; }
.filter-group label { font-size: 11px; font-weight: bold; color: #7f8c8d; text-transform: uppercase; letter-spacing: 0.4px; }
.filter-input { padding: 9px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; background: white; color: #2c3e50; outline: none; width: 100%; box-sizing: border-box; }
.filter-checkboxes { gap: 8px; min-width: 180px; }
.tm-checkbox, .cross-checkbox { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: bold; padding: 6px 10px; border-radius: 6px; cursor: pointer; text-transform: none !important; letter-spacing: 0 !important; }
.tm-checkbox { color: #1e8449; background: #eafaf1; border: 1px solid #a9dfbf; }
.cross-checkbox { color: #d35400; background: #fef5e7; border: 1px solid #fad7a0; }
.content-grid { display: flex; flex-direction: column; gap: 25px; }
.kpi-grid { display: flex; gap: 18px; flex-wrap: wrap; }
.kpi-card { flex: 1; min-width: 195px; background: white; padding: 18px; border-radius: 10px; border: 1px solid #eee; }
.kpi-title { font-size: 12px; color: #7f8c8d; font-weight: bold; text-transform: uppercase; margin-bottom: 8px; }
.kpi-value { font-size: 25px; font-weight: bold; color: #2c3e50; margin-bottom: 6px; }
.kpi-sub { font-size: 12px; color: #7f8c8d; }
.warn-banner { background: #fffcf5; border: 1px solid #f39c12; color: #d35400; padding: 12px 16px; border-radius: 8px; font-size: 13px; }
.split-row { display: flex; gap: 20px; flex-wrap: wrap; }
.card { background: white; padding: 20px; border-radius: 10px; border: 1px solid #eee; min-width: 300px; }
.card h3 { margin-top: 0; color: #34495e; margin-bottom: 15px; font-size: 16px; }
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 15px; flex-wrap: wrap; margin-bottom: 15px; }
.hint { font-size: 12px; font-weight: normal; color: #95a5a6; margin-left: 8px; }
.table-responsive { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.data-table { width: 100%; border-collapse: collapse; min-width: 600px; }
.data-table th, .data-table td { padding: 11px 12px; border-bottom: 1px solid #f0f0f0; text-align: left; font-size: 13px; white-space: nowrap; }
.data-table th { background: #f5f6fa; color: #7f8c8d; font-weight: bold; }
.muted { color: #95a5a6; }
.empty { text-align: center; color: #7f8c8d; padding: 25px !important; }
.dept-badge { background: #f4f6f7; color: #34495e; padding: 3px 8px; border-radius: 4px; font-size: 12px; }
.okved-badge { background: #f4ecf7; color: #7d3c98; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
.cross-badge { background: #fef5e7; color: #d35400; border: 1px solid #fad7a0; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 6px; }
.main-badge { background: #eafaf1; color: #1e8449; border: 1px solid #a9dfbf; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; }
.cross-text { color: #d35400; font-weight: bold; }
.goods-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.company-cell { max-width: 220px; }
.company-name { font-weight: bold; overflow: hidden; text-overflow: ellipsis; }
.drill-link { cursor: pointer; text-decoration: underline dashed #bdc3c7; }
.drill-link:hover { color: #2980b9; text-decoration: underline solid #2980b9; }
.id-badge { background: #e3f2fd; color: #2980b9; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; display: inline-block; }
.id-link { text-decoration: none; border: 1px solid #bbdefb; }
.id-link:hover { background: #2980b9; color: white; }
.note { margin: 12px 0 0; font-size: 12px; color: #95a5a6; line-height: 1.5; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 1000; padding: 20px; }
.modal-top { z-index: 1100; }
.modal-content { background: white; border-radius: 12px; width: 100%; max-width: 1150px; max-height: 90vh; display: flex; flex-direction: column; }
.modal-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid #eee; }
.btn-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #7f8c8d; }
.btn-close:hover { color: #e74c3c; }
.modal-body { padding: 20px; overflow-y: auto; }
.modal-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 13px; }
.deal-info { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px 20px; background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px; font-size: 13px; }
.totals { display: flex; justify-content: space-between; gap: 15px; flex-wrap: wrap; margin-top: 15px; padding-top: 12px; border-top: 1px solid #eee; font-size: 13px; }
@media (max-width: 768px) { .filter-group { min-width: 100%; } }
</style>