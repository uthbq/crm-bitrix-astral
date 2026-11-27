import bcrypt from 'bcrypt';
import type { Express } from 'express';
import db from './database';

const CFG = {
    productsConcurrency: Number(process.env.PRODUCTS_CONCURRENCY) || 10,
    productsPerRun: Number(process.env.PRODUCTS_PER_RUN) || 5000,
    backfillDays: Number(process.env.PRODUCTS_BACKFILL_DAYS) || 0, // 0 = вся история
    dadataConcurrency: Number(process.env.DADATA_CONCURRENCY) || 5,
    dadataGapMs: Number(process.env.DADATA_GAP_MS) || 80,
    dadataPerRun: Number(process.env.DADATA_PER_RUN) || 1500,
    dadataDailyLimit: Number(process.env.DADATA_DAILY_LIMIT) || 9000,
    overlapMinutes: Number(process.env.SYNC_OVERLAP_MIN) || 10
};

async function apiGet(path: string, params: Record<string, any> = {}): Promise<any> {
    if (!process.env.API_URL || !process.env.API_TOKEN) {
        throw new Error('Не заданы API_URL / API_TOKEN в переменных окружения');
    }
    const url = new URL(`${process.env.API_URL}${path}`);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${process.env.API_TOKEN}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.message || `API ${path}: HTTP ${res.status}`);
    return data;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<number> {
    if (items.length === 0) return 0;
    let index = 0;
    let ok = 0;
    const n = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: n }, async () => {
        while (index < items.length) {
            const item = items[index++];
            try {
                await worker(item);
                ok++;
            } catch (e: any) {
                console.error('⚠️ Задача пула:', e.message);
            }
        }
    }));
    return ok;
}

function makeGate(gapMs: number) {
    let next = 0;
    return async () => {
        const now = Date.now();
        const slot = Math.max(now, next);
        next = slot + gapMs;
        if (slot > now) await sleep(slot - now);
    };
}

function normalizeInn(raw: any): string | null {
    if (raw === null || raw === undefined) return null;
    let s = String(raw).replace(/\D/g, '');
    if ((s.length === 11 || s.length === 13) && s.startsWith('0')) s = s.slice(1);
    return s || null;
}

function normName(s: any): string {
    return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
}

function logSync(entity: string, status: string, processed: number, durationMs: number, message: string) {
    db.prepare(`
        INSERT INTO sync_log (entity, status, processed, duration_ms, message)
        VALUES (?, ?, ?, ?, ?)
    `).run(entity, status, processed, durationMs, message);
}

function getLastSyncIso(entity: string): string | undefined {
    const row = db.prepare(`
        SELECT ts FROM sync_log WHERE entity = ? AND status = 'success'
        ORDER BY id DESC LIMIT 1
    `).get(entity) as any;
    if (!row?.ts) return undefined;
    const ms = Date.parse(row.ts.replace(' ', 'T') + 'Z') - CFG.overlapMinutes * 60000;
    if (Number.isNaN(ms)) return undefined;
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function extractField(fields: any, pattern: RegExp): string | null {
    if (!fields) return null;
    for (const key of Object.keys(fields)) {
        const f = fields[key];
        if (f?.title && pattern.test(f.title) && f.value !== null && f.value !== undefined && f.value !== '') {
            return Array.isArray(f.value) ? f.value.join(', ') : String(f.value);
        }
    }
    return null;
}

function transliterate(text: string): string {
    const ru = 'А-а-Б-б-В-в-Г-г-Д-д-Е-е-Ё-ё-Ж-ж-З-з-И-и-Й-й-К-к-Л-л-М-м-Н-н-О-о-П-п-Р-р-С-с-Т-т-У-у-Ф-ф-Х-х-Ц-ц-Ч-ч-Ш-ш-Щ-щ-Ъ-ъ-Ы-ы-Ь-ь-Э-э-Ю-ю-Я-я'.split('-');
    const en = 'A-a-B-b-V-v-G-g-D-d-E-e-E-e-Zh-zh-Z-z-I-i-Y-y-K-k-L-l-M-m-N-n-O-o-P-p-R-r-S-s-T-t-U-u-F-f-Kh-kh-Ts-ts-Ch-ch-Sh-sh-Sch-sch---Y-y---E-e-Yu-yu-Ya-ya'.split('-');
    let res = '';
    for (let i = 0; i < text.length; i++) {
        const s = text.charAt(i), n = ru.indexOf(s);
        res += (n >= 0) ? en[n] : s;
    }
    return res.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.').replace(/(^\.|\.$)/g, '');
}

const backfillDaysSql = () => CFG.backfillDays > 0
    ? `AND date(d.created_at) >= date('now', '-${Math.floor(CFG.backfillDays)} days')`
    : '';

function productsPending(): number {
    const row = db.prepare(`
        SELECT COUNT(*) as cnt FROM deals d
        WHERE d.products_list IS NULL AND (d.amount > 0 OR d.stage_semantic IN ('S','P'))
        ${backfillDaysSql()}
    `).get() as any;
    return row?.cnt || 0;
}

function innsPending(): number {
    const row = db.prepare(`
        SELECT COUNT(DISTINCT d.inn) as cnt FROM deals d
        LEFT JOIN companies c ON d.inn = c.inn
        WHERE d.inn IS NOT NULL AND d.inn != ''
          AND (c.inn IS NULL OR c.enriched_at IS NULL)
          AND (d.amount > 0 OR d.stage_semantic = 'S')
    `).get() as any;
    return row?.cnt || 0;
}

function dadataUsedToday(): number {
    const row = db.prepare(`
        SELECT COUNT(*) as cnt FROM companies
        WHERE enriched_at IS NOT NULL AND date(enriched_at) = date('now')
    `).get() as any;
    return row?.cnt || 0;
}


async function enrichCompanyByInn(rawInn: string): Promise<boolean> {
    const inn = normalizeInn(rawInn);
    if (!inn || !process.env.DADATA_TOKEN) return false;

    const cached = db.prepare('SELECT inn FROM companies WHERE inn = ? AND enriched_at IS NOT NULL').get(inn);
    if (cached) return false;

    const res = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Token ${process.env.DADATA_TOKEN}`
        },
        body: JSON.stringify({ query: inn, count: 1 })
    });
    if (!res.ok) throw new Error(`Dadata HTTP ${res.status}`);
    const data = await res.json();
    const s = data.suggestions?.[0];
    const okved = s?.data?.okved || null;
    const okvedType = s?.data?.okved_type || null;
    const companyName = s?.data?.name?.full_with_opf || s?.value || null;

    const okvedName = okved ? await getOkvedName(okved) : null;

    db.transaction(() => {
        db.prepare(`
            INSERT INTO companies (inn, company_name, okved, okved_type, dadata_found, enriched_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(inn) DO UPDATE SET
                company_name = excluded.company_name, okved = excluded.okved,
                okved_type = excluded.okved_type, dadata_found = excluded.dadata_found,
                enriched_at = CURRENT_TIMESTAMP
        `).run(inn, companyName, okved, okvedType, s ? 1 : 0);

        if (okved) {
            db.prepare(`
                INSERT INTO okved (code, name) VALUES (?, ?)
                ON CONFLICT(code) DO UPDATE SET name = COALESCE(excluded.name, okved.name)
            `).run(okved, okvedName);
            db.prepare('UPDATE deals SET okved = ?, dadata_enriched = 1 WHERE inn = ?').run(okved, inn);
        }
    })();
    return true;
}

async function enrichPendingInns(limit: number): Promise<number> {
    if (!process.env.DADATA_TOKEN) return 0;
    const left = Math.max(0, CFG.dadataDailyLimit - dadataUsedToday());
    if (left === 0) {
        console.warn(`⚠️ Dadata: суточный лимит ${CFG.dadataDailyLimit} исчерпан, обогащение отложено до завтра`);
        return 0;
    }
    const batch = Math.min(limit, left);
    const inns = db.prepare(`
        SELECT DISTINCT d.inn FROM deals d
        LEFT JOIN companies c ON d.inn = c.inn
        WHERE d.inn IS NOT NULL AND d.inn != ''
          AND (c.inn IS NULL OR c.enriched_at IS NULL)
          AND (d.amount > 0 OR d.stage_semantic = 'S')
        LIMIT ?
    `).all(batch) as any[];

    const gate = makeGate(CFG.dadataGapMs);
    let done = 0;
    await runPool(inns, CFG.dadataConcurrency, async (row: any) => {
        await gate();
        if (await enrichCompanyByInn(row.inn)) done++;
    });
    return done;
}

async function syncDealProducts(dealId: number): Promise<void> {
    let afterId: number | null = 0;
    const rows: any[] = [];
    let fieldProducts: any[] = [];
    let complete = true;

    while (afterId !== null) {
        const data = await apiGet('/products', { entity: 'deal', id: dealId, limit: 500, afterId });
        if (afterId === 0) fieldProducts = data.products || [];
        rows.push(...(data.productRows || []));
        if (data.productRowsComplete === false) complete = false;
        afterId = data.nextAfterId ?? null;
    }

    const main = db.prepare(`
        SELECT p.id, p.name, p.bitrix_id
        FROM deals d
        LEFT JOIN leads l ON d.lead_id = l.bitrix_lead_id
        LEFT JOIN bases b ON l.base_id = b.id
        LEFT JOIN products p ON b.main_product_id = p.id
        WHERE d.bitrix_deal_id = ?
    `).get(dealId) as any;

    const isMainProduct = (r: any): boolean => {
        if (!main?.name) return true; 
        if (main.bitrix_id && r.productId && Number(r.productId) === Number(main.bitrix_id)) return true;
        return normName(r.productName) === normName(main.name);
    };

    db.transaction(() => {
        db.prepare('DELETE FROM deal_products WHERE bitrix_deal_id = ?').run(dealId);

        const insRow = db.prepare(`
            INSERT INTO deal_products
                (bitrix_row_id, bitrix_deal_id, bitrix_product_id, product_name, product_group,
                 quantity, price, sum, currency, is_cross_sale)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const upsertProduct = db.prepare(`
            INSERT INTO products (name, bitrix_id, product_group) VALUES (?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                bitrix_id = COALESCE(products.bitrix_id, excluded.bitrix_id),
                product_group = COALESCE(products.product_group, excluded.product_group)
        `);

        let anyCross = 0;
        for (const r of rows) {
            const name = String(r.productName || 'Без названия').trim();
            upsertProduct.run(name, r.productId ?? null, r.group ?? null);
            const cross = isMainProduct(r) ? 0 : 1;
            if (cross) anyCross = 1;
            insRow.run(
                r.id ?? null, dealId, r.productId ?? null, name, r.group ?? null,
                r.quantity ?? 1, r.price ?? 0, r.sum ?? 0, r.currency ?? 'RUB', cross
            );
        }

        const names = [...new Set(rows.map(r => String(r.productName || '').trim()).filter(Boolean))].join(', ');
        const pf = fieldProducts.find((p: any) => /продукт/i.test(p.title || '')) || fieldProducts[0];

        db.prepare(`
            UPDATE deals SET
                products_list = ?,
                product_field = COALESCE(?, product_field),
                is_cross_sale = ?
            WHERE bitrix_deal_id = ?
        `).run(complete ? names : null, pf?.value != null ? String(pf.value) : null, anyCross, dealId);
    })();
}

let productsBusy = false;

export async function syncProductsBackfill(limit: number = CFG.productsPerRun): Promise<number> {
    if (productsBusy) {
        console.log('⏭️ Догрузка товаров уже выполняется, проход пропущен');
        return 0;
    }
    productsBusy = true;
    try {
        const deals = db.prepare(`
            SELECT d.bitrix_deal_id FROM deals d
            WHERE d.products_list IS NULL AND (d.amount > 0 OR d.stage_semantic IN ('S','P'))
            ${backfillDaysSql()}
            ORDER BY (d.stage_semantic = 'S') DESC, d.amount DESC
            LIMIT ?
        `).all(limit) as any[];

        return await runPool(deals, CFG.productsConcurrency, async (d: any) => {
            await syncDealProducts(d.bitrix_deal_id);
        });
    } finally {
        productsBusy = false;
    }
}

export async function syncCalls(force: boolean = false): Promise<number> {
    const t0 = Date.now();
    const entity = 'calls';
    try {
        const updatedFrom = force ? undefined : getLastSyncIso(entity);
        console.log(`📞 Звонки: ${updatedFrom ? `изменения с ${updatedFrom}` : 'полная загрузка'}...`);
        let processed = 0;
        let dataComplete = false;
        let afterId: number | null = 0;

        const stmt = db.prepare(`
            INSERT INTO calls (bitrix_call_id, manager_id, direction, duration_seconds, started_at, owner_type, owner_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bitrix_call_id) DO UPDATE SET
                manager_id = excluded.manager_id,
                direction = excluded.direction,
                duration_seconds = excluded.duration_seconds,
                started_at = excluded.started_at,
                owner_type = excluded.owner_type,
                owner_id = excluded.owner_id
        `);

        while (afterId !== null) {
            const data = await apiGet('/calls', { limit: 500, afterId, updatedFrom });
            dataComplete = data.dataComplete === true;
            const chunk = data.calls || [];
            if (chunk.length === 0) break;

            db.transaction((calls: any[]) => {
                for (const call of calls) {
                    const startTime = call.startTime ? new Date(call.startTime).getTime() : 0;
                    const endTime = call.endTime ? new Date(call.endTime).getTime() : startTime;
                    const dur = startTime ? Math.max(0, Math.round((endTime - startTime) / 1000)) : 0;
                    const info = stmt.run(
                        call.id, call.responsibleId ?? null, call.direction ?? null,
                        dur, call.startTime ?? null, call.owner?.type ?? null, call.owner?.id ?? null
                    );
                    if (info.changes > 0) processed++;
                }
            })(chunk);

            afterId = data.nextAfterId ?? null;
        }

        logSync(entity, 'success', processed, Date.now() - t0, `dataComplete=${dataComplete}`);
        console.log(`✅ Звонки: ${processed}`);
        return processed;
    } catch (e: any) {
        logSync(entity, 'error', 0, Date.now() - t0, e.message);
        console.error('❌ Звонки:', e.message);
        return 0;
    }
}

export async function syncLeads(force: boolean = false): Promise<number> {
    const t0 = Date.now();
    const entity = 'leads';
    try {
        const updatedFrom = force ? undefined : getLastSyncIso(entity);
        console.log(`🎯 Лиды: ${updatedFrom ? `изменения с ${updatedFrom}` : 'полная загрузка'}...`);
        let processed = 0;
        let dataComplete = false;
        let afterId: number | null = 0;

        const stmtLead = db.prepare(`
            INSERT INTO leads (bitrix_lead_id, inn, status_id, status_semantic, manager_id, segmentation, base_id, is_quality, refusal_reason_id, created_at, last_activity_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bitrix_lead_id) DO UPDATE SET
                inn = COALESCE(excluded.inn, leads.inn),
                status_id = excluded.status_id,
                status_semantic = excluded.status_semantic,
                manager_id = excluded.manager_id,
                segmentation = excluded.segmentation,
                base_id = COALESCE(excluded.base_id, leads.base_id),
                is_quality = excluded.is_quality,
                refusal_reason_id = COALESCE(excluded.refusal_reason_id, leads.refusal_reason_id),
                last_activity_at = excluded.last_activity_at
        `);
        const stmtReasonInsert = db.prepare('INSERT OR IGNORE INTO refusal_reasons (name) VALUES (?)');
        const stmtReasonSelect = db.prepare('SELECT id FROM refusal_reasons WHERE name = ?');
        const stmtBaseInsert = db.prepare('INSERT OR IGNORE INTO bases (name) VALUES (?)');
        const stmtBaseSelect = db.prepare('SELECT id FROM bases WHERE name = ?');

        while (afterId !== null) {
            const data = await apiGet('/leads', { limit: 500, fields: 'yes', afterId, updatedFrom });
            dataComplete = data.dataComplete === true;
            const chunk = data.leads || [];
            if (chunk.length === 0) break;

            db.transaction((leads: any[]) => {
                for (const lead of leads) {
                    const statusId = lead.status?.id ?? null;
                    const statusSemantic = lead.status?.semantic ?? null;
                    const isQuality = (statusSemantic === 'S' || lead.isConverted) ? 1 : 0;
                    const segmentsStr = lead.segments ? JSON.stringify(lead.segments) : null;

                    let baseId = null;
                    let extractedBaseName = null;
                    if (Array.isArray(lead.segments) && lead.segments.length > 0) {
                        const firstSeg = lead.segments[0];
                        if (typeof firstSeg === 'string') extractedBaseName = firstSeg;
                        else if (firstSeg && typeof firstSeg === 'object') extractedBaseName = firstSeg.name || firstSeg.value || null;
                    }
                    if (extractedBaseName) {
                        const bName = String(extractedBaseName).trim();
                        stmtBaseInsert.run(bName);
                        const baseRow = stmtBaseSelect.get(bName) as any;
                        if (baseRow) baseId = baseRow.id;
                    }

                    let refusalReasonId = null;
                    let rawReasonText = extractField(lead.fields, /отказ|причин|почему/i);
                    if (!rawReasonText && statusSemantic === 'F' && lead.status?.name) {
                        const sName = lead.status.name;
                        if (sName !== 'Некачественный лид' && sName !== 'Провал' && sName !== 'Junk') rawReasonText = sName;
                    }
                    if (rawReasonText) {
                        const trimmed = rawReasonText.trim();
                        stmtReasonInsert.run(trimmed);
                        const row = stmtReasonSelect.get(trimmed) as any;
                        if (row) refusalReasonId = row.id;
                    }

                    const lastActivity = lead.lastActivityAt || lead.updatedAt || lead.createdAt || null;
                    const info = stmtLead.run(
                        lead.id, normalizeInn(lead.inn), statusId, statusSemantic,
                        lead.assignedById ?? null, segmentsStr, baseId, isQuality,
                        refusalReasonId, lead.createdAt ?? null, lastActivity
                    );
                    if (info.changes > 0) processed++;
                }
            })(chunk);

            afterId = data.nextAfterId ?? null;
        }

        logSync(entity, 'success', processed, Date.now() - t0, `dataComplete=${dataComplete}`);
        console.log(`✅ Лиды: ${processed}`);
        return processed;
    } catch (e: any) {
        logSync(entity, 'error', 0, Date.now() - t0, e.message);
        console.error('❌ Лиды:', e.message);
        return 0;
    }
}

export async function syncDeals(force: boolean = false): Promise<number> {
    const t0 = Date.now();
    const entity = 'deals';
    try {
        const updatedFrom = force ? undefined : getLastSyncIso(entity);
        console.log(`💼 Сделки: ${updatedFrom ? `изменения с ${updatedFrom}` : 'полная загрузка'}...`);
        let processed = 0;
        let dataComplete = false;
        let afterId: number | null = 0;

        const stmtCacheGet = db.prepare('SELECT okved FROM companies WHERE inn = ?');
        const stmt = db.prepare(`
            INSERT INTO deals (
                bitrix_deal_id, lead_id, manager_id, inn, company_title, tm_mark,
                category_id, category_name, stage_id, stage_name, stage_semantic,
                product_field, amount, created_at, stage_changed_at, last_activity_at,
                okved, dadata_enriched
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bitrix_deal_id) DO UPDATE SET
                lead_id = COALESCE(excluded.lead_id, deals.lead_id),
                manager_id = COALESCE(excluded.manager_id, deals.manager_id),
                inn = COALESCE(excluded.inn, deals.inn),
                company_title = COALESCE(excluded.company_title, deals.company_title),
                tm_mark = CASE WHEN excluded.tm_mark = 1 THEN 1 ELSE deals.tm_mark END,
                category_id = excluded.category_id,
                category_name = excluded.category_name,
                stage_id = excluded.stage_id,
                stage_name = excluded.stage_name,
                stage_semantic = excluded.stage_semantic,
                product_field = COALESCE(excluded.product_field, deals.product_field),
                amount = excluded.amount,
                stage_changed_at = COALESCE(excluded.stage_changed_at, deals.stage_changed_at),
                last_activity_at = excluded.last_activity_at,
                okved = COALESCE(excluded.okved, deals.okved),
                dadata_enriched = CASE WHEN excluded.okved IS NOT NULL THEN 1 ELSE deals.dadata_enriched END,
                products_list = CASE
                    WHEN excluded.stage_id IS NOT deals.stage_id OR excluded.amount IS NOT deals.amount THEN NULL
                    ELSE deals.products_list
                END
        `);

        while (afterId !== null) {
            const data = await apiGet('/deals', { limit: 500, fields: 'yes', afterId, updatedFrom });
            dataComplete = data.dataComplete === true;
            const chunk = data.deals || [];
            if (chunk.length === 0) break;

            db.transaction((deals: any[]) => {
                for (const deal of deals) {
                    const inn = normalizeInn(deal.inn);
                    const cached = inn ? stmtCacheGet.get(inn) as any : null;
                    const okved = cached?.okved ?? null;
                    const tmRaw = extractField(deal.fields, /тм|телемаркетинг/i);
                    const tmMark = (tmRaw && !['0', 'false', 'нет', 'n'].includes(tmRaw.toLowerCase())) ? 1 : 0;
                    const productField = extractField(deal.fields, /продукт|наименование товаров/i);
                    const lastActivity = deal.lastActivityAt || deal.updatedAt || deal.createdAt || null;

                    const info = stmt.run(
                        deal.id, deal.leadId ?? null, deal.assignedById ?? null, inn,
                        deal.companyTitle ?? null, tmMark,
                        deal.category?.id ?? 0, deal.category?.name ?? 'Общая воронка',
                        deal.stage?.id ?? null, deal.stage?.name ?? null, deal.stage?.semantic ?? null,
                        productField, deal.amount ?? 0,
                        deal.createdAt ?? null, deal.stageChangedAt ?? null, lastActivity,
                        okved, okved ? 1 : 0
                    );
                    if (info.changes > 0) processed++;
                }
            })(chunk);

            afterId = data.nextAfterId ?? null;
        }

        const productsDone = await syncProductsBackfill(CFG.productsPerRun);
        const dadataDone = await enrichPendingInns(CFG.dadataPerRun);

        logSync(entity, 'success', processed, Date.now() - t0,
            `dataComplete=${dataComplete}; товаров: ${productsDone}; ИНН: ${dadataDone}; осталось товаров: ${productsPending()}, ИНН: ${innsPending()}`);
        console.log(`✅ Сделки: ${processed}, товары: ${productsDone}, Dadata: ${dadataDone}`);
        return processed;
    } catch (e: any) {
        logSync(entity, 'error', 0, Date.now() - t0, e.message);
        console.error('❌ Сделки:', e.message);
        return 0;
    }
}

export async function syncSegments(): Promise<number> {
    const t0 = Date.now();
    try {
        const data = await apiGet('/segments');
        const segments = data.segments || [];
        const stmtSegment = db.prepare(`
            INSERT INTO segments (name, entity) VALUES (?, ?)
            ON CONFLICT(name) DO UPDATE SET entity = excluded.entity
        `);
        const stmtBase = db.prepare('INSERT OR IGNORE INTO bases (name) VALUES (?)');
        db.transaction((list: any[]) => {
            for (const seg of list) {
                if (!seg.name) continue;
                stmtSegment.run(seg.name, seg.entity ?? null);
                stmtBase.run(seg.name);
            }
        })(segments);
        logSync('segments', 'success', segments.length, Date.now() - t0, '');
        console.log(`✅ Сегменты: ${segments.length}`);
        return segments.length;
    } catch (e: any) {
        logSync('segments', 'error', 0, Date.now() - t0, e.message);
        console.error('❌ Сегменты:', e.message);
        return 0;
    }
}

export async function autoSyncUsers(): Promise<void> {
    try {
        const data = await apiGet('/users');
        const defaultPassword = await bcrypt.hash('crm12345', 10);
        const checkBitrixId = db.prepare('SELECT id FROM users WHERE bitrix_id = ?');
        const checkLogin = db.prepare('SELECT id FROM users WHERE login = ?');
        const insertUser = db.prepare('INSERT INTO users (bitrix_id, login, password_hash, role) VALUES (?, ?, ?, ?)');
        let added = 0;

        db.transaction((usersList: any[]) => {
            for (const u of usersList) {
                if (!u.id || checkBitrixId.get(u.id)) continue;
                let baseName = u.name ? transliterate(u.name) : '';
                if (!baseName) baseName = `user_${u.id}`;
                let login = baseName;
                if (checkLogin.get(login)) login = `${login}.${u.id}`;
                insertUser.run(u.id, login, defaultPassword, 'MANAGER');
                added++;
            }
        })(data.users || []);

        const info = db.prepare(`
            INSERT INTO users (bitrix_id, login, password_hash, role)
            SELECT DISTINCT manager_id, 'system_bot_' || manager_id, ?, 'MANAGER'
            FROM (
                SELECT manager_id FROM leads WHERE manager_id IS NOT NULL
                UNION SELECT manager_id FROM deals WHERE manager_id IS NOT NULL
                UNION SELECT manager_id FROM calls WHERE manager_id IS NOT NULL
            )
            WHERE manager_id NOT IN (SELECT bitrix_id FROM users WHERE bitrix_id IS NOT NULL)
        `).run(defaultPassword);

        if (added > 0 || info.changes > 0) console.log(`✅ Сотрудники: из API ${added}, системных ${info.changes}`);
    } catch (e: any) {
        console.error('❌ Сотрудники:', e.message);
    }
}

export function calculateDailyStats(): void {
    db.transaction(() => {
        db.prepare('DELETE FROM daily_stats').run();

        db.prepare(`
            INSERT INTO daily_stats (date, manager_id, base_id, product_id, work_type, total_calls, valid_conversations)
            SELECT date(c.started_at), c.manager_id,
                COALESCE(l.base_id, l2.base_id, 0), COALESCE(b.main_product_id, 0), 'primary',
                COUNT(c.id),
                SUM(CASE
                    WHEN u.qualification = 'ведущий' AND c.duration_seconds >= 59 THEN 1
                    WHEN (u.qualification IS NULL OR u.qualification = 'обычный') AND c.duration_seconds >= 44 THEN 1
                    ELSE 0 END)
            FROM calls c
            LEFT JOIN users u ON c.manager_id = u.bitrix_id
            LEFT JOIN leads l ON c.owner_type = 'lead' AND c.owner_id = l.bitrix_lead_id
            LEFT JOIN deals dd ON c.owner_type = 'deal' AND c.owner_id = dd.bitrix_deal_id
            LEFT JOIN leads l2 ON dd.lead_id = l2.bitrix_lead_id
            LEFT JOIN bases b ON b.id = COALESCE(l.base_id, l2.base_id, 0)
            WHERE c.manager_id IS NOT NULL AND c.direction = 'outgoing' AND c.started_at IS NOT NULL
            GROUP BY date(c.started_at), c.manager_id, COALESCE(l.base_id, l2.base_id, 0), COALESCE(b.main_product_id, 0)
        `).run();

        db.prepare(`
            INSERT INTO daily_stats (date, manager_id, base_id, product_id, work_type, unique_leads, quality_leads, transfers)
            SELECT date(l.created_at), l.manager_id, COALESCE(l.base_id, 0), COALESCE(b.main_product_id, 0), 'primary',
                SUM(CASE WHEN l.status_id NOT LIKE '%NEW%' AND l.status_id NOT LIKE '%IMPORT%' THEN 1 ELSE 0 END),
                SUM(CASE WHEN l.is_quality = 1 THEN 1 ELSE 0 END),
                SUM(CASE WHEN l.status_semantic = 'S' THEN 1 ELSE 0 END)
            FROM leads l
            LEFT JOIN bases b ON l.base_id = b.id
            WHERE l.manager_id IS NOT NULL AND l.created_at IS NOT NULL
            GROUP BY date(l.created_at), l.manager_id, COALESCE(l.base_id, 0), COALESCE(b.main_product_id, 0)
            ON CONFLICT(date, manager_id, base_id, product_id, work_type) DO UPDATE SET
                unique_leads = excluded.unique_leads,
                quality_leads = excluded.quality_leads,
                transfers = excluded.transfers
        `).run();

        db.prepare(`
            INSERT INTO daily_stats (date, manager_id, base_id, product_id, work_type, paid_deals, amount_sum)
            SELECT date(d.created_at), d.manager_id, COALESCE(l.base_id, 0), COALESCE(b.main_product_id, 0), 'primary',
                COUNT(d.id), SUM(d.amount)
            FROM deals d
            LEFT JOIN leads l ON d.lead_id = l.bitrix_lead_id
            LEFT JOIN bases b ON l.base_id = b.id
            WHERE d.manager_id IS NOT NULL AND d.created_at IS NOT NULL AND d.amount > 0
            GROUP BY date(d.created_at), d.manager_id, COALESCE(l.base_id, 0), COALESCE(b.main_product_id, 0)
            ON CONFLICT(date, manager_id, base_id, product_id, work_type) DO UPDATE SET
                paid_deals = excluded.paid_deals,
                amount_sum = excluded.amount_sum
        `).run();
    })();
    console.log('📊 Агрегаты пересчитаны');
}

let syncRunning = false;

export async function runBackgroundSync(): Promise<void> {
    if (syncRunning || turbo.running) {
        console.log('⏭️ Синхронизация уже идёт, проход пропущен');
        return;
    }
    syncRunning = true;
    console.log('🔄 Фоновая синхронизация...');
    try {
        await autoSyncUsers();
        await syncSegments();
        await syncCalls();
        await syncLeads();
        await syncDeals();
        calculateDailyStats();
        console.log('✅ Фоновая синхронизация завершена');
    } finally {
        syncRunning = false;
    }
}

const turbo = {
    running: false,
    startedAt: null as string | null,
    finishedAt: null as string | null,
    rounds: 0,
    productsDone: 0,
    dadataDone: 0,
    productsPending: 0,
    dadataPending: 0,
    dadataUsedToday: 0,
    lastError: ''
};

async function runTurbo(opts: { deals?: boolean; rounds?: number; minutes?: number; products?: number; dadata?: number } = {}) {
    if (turbo.running) return;
    const rounds = Math.max(1, Math.min(100, opts.rounds || 30));
    const deadline = Date.now() + Math.max(1, Math.min(120, opts.minutes || 20)) * 60000;
    const productsBatch = Math.max(1, opts.products || CFG.productsPerRun);
    const dadataBatch = Math.max(1, opts.dadata || CFG.dadataPerRun);

    turbo.running = true;
    turbo.startedAt = new Date().toISOString();
    turbo.finishedAt = null;
    turbo.rounds = 0;
    turbo.productsDone = 0;
    turbo.dadataDone = 0;
    turbo.lastError = '';

    console.log(`🚀 ТУРБО запущен: до ${rounds} раундов, товары ${productsBatch}/раунд, ИНН ${dadataBatch}/раунд`);
    try {
        if (opts.deals) {
            await autoSyncUsers();
            await syncSegments();
            await syncCalls();
            await syncLeads();
            await syncDeals();
        }

        for (let round = 1; round <= rounds && Date.now() < deadline; round++) {
            turbo.rounds = round;
            const p = await syncProductsBackfill(productsBatch);
            const d = await enrichPendingInns(dadataBatch);
            turbo.productsDone += p;
            turbo.dadataDone += d;
            turbo.productsPending = productsPending();
            turbo.dadataPending = innsPending();
            turbo.dadataUsedToday = dadataUsedToday();
            console.log(`🚀 Раунд ${round}: товары +${p}, ИНН +${d}; осталось ${turbo.productsPending} / ${turbo.dadataPending}`);
            if (p === 0 && d === 0) break; // очереди пусты или упёрлись в лимит Dadata
        }

        calculateDailyStats();
        logSync('turbo', 'success', turbo.productsDone + turbo.dadataDone,
            turbo.startedAt ? Date.now() - Date.parse(turbo.startedAt) : 0,
            `раундов: ${turbo.rounds}; товаров: ${turbo.productsDone}; ИНН: ${turbo.dadataDone}; осталось: ${turbo.productsPending}/${turbo.dadataPending}`);
        console.log('✅ ТУРБО завершён');
    } catch (e: any) {
        turbo.lastError = e.message;
        logSync('turbo', 'error', 0, 0, e.message);
        console.error('❌ ТУРБО:', e.message);
    } finally {
        turbo.productsPending = productsPending();
        turbo.dadataPending = innsPending();
        turbo.finishedAt = new Date().toISOString();
        turbo.running = false;
    }
}

export function registerSyncRoutes(app: Express, authenticateToken: any): void {
    let cachedUsers: any = null;
    let cacheTime = 0;
    const CACHE_LIFETIME_MS = 60 * 60 * 1000;

    app.get('/api/bitrix-users', authenticateToken, async (req: any, res: any) => {
        const now = Date.now();
        if (cachedUsers && (now - cacheTime < CACHE_LIFETIME_MS)) return res.json(cachedUsers);
        try {
            const data = await apiGet('/users');
            cachedUsers = (data.users || []).map((u: any) => ({ id: u.id, name: u.name || 'Без имени' }));
            cacheTime = now;
            res.json(cachedUsers);
        } catch (e: any) {
            res.status(500).json({ error: 'Ошибка загрузки из API' });
        }
    });

    app.get('/api/calls-test', async (req: any, res: any) => {
        try { res.json(await apiGet('/calls', { limit: 5 })); }
        catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/sync-calls', (req: any, res: any) => {
        res.json({ message: 'Синхронизация звонков запущена в фоне.' });
        syncCalls(req.query.force === 'true').then(n => { if (n > 0) calculateDailyStats(); });
    });

    app.get('/api/sync-leads', (req: any, res: any) => {
        res.json({ message: 'Синхронизация лидов запущена в фоне.' });
        syncLeads(req.query.force === 'true').then(n => { if (n > 0) calculateDailyStats(); });
    });

    app.get('/api/sync-deals', (req: any, res: any) => {
        res.json({ message: 'Синхронизация сделок запущена в фоне (товары + Dadata).' });
        syncDeals(req.query.force === 'true').then(n => { if (n > 0) calculateDailyStats(); });
    });

    app.get('/api/sync-segments', async (req: any, res: any) => {
        const n = await syncSegments();
        res.json({ message: 'Синхронизация сегментов завершена', total_fetched: n });
    });

    app.get('/api/sync-products', (req: any, res: any) => {
        const limit = Math.min(20000, Math.max(1, Number(req.query.limit) || CFG.productsPerRun));
        res.json({ message: `Догрузка товаров запущена (до ${limit} сделок, ${CFG.productsConcurrency} параллельно).` });
        syncProductsBackfill(limit).then(n => console.log(`✅ Догрузка товаров: ${n}`));
    });

    app.get('/api/sync-dadata', (req: any, res: any) => {
        const limit = Math.min(10000, Math.max(1, Number(req.query.limit) || CFG.dadataPerRun));
        res.json({ message: `Обогащение ОКВЭД запущено (до ${limit} ИНН).` });
        enrichPendingInns(limit).then(n => console.log(`✅ Dadata: ${n} ИНН`));
    });

    // ТУРБО: грузит подряд, пока очереди не опустеют
    app.get('/api/sync-turbo', (req: any, res: any) => {
        if (turbo.running) return res.json({ message: 'ТУРБО уже выполняется', status: turbo });
        const opts = {
            deals: req.query.deals === 'true',
            rounds: Number(req.query.rounds) || 30,
            minutes: Number(req.query.minutes) || 20,
            products: Number(req.query.products) || CFG.productsPerRun,
            dadata: Number(req.query.dadata) || CFG.dadataPerRun
        };
        res.json({ message: 'ТУРБО запущен. Прогресс: /api/sync-turbo/status', opts });
        runTurbo(opts);
    });

    app.get('/api/sync-turbo/status', (req: any, res: any) => {
        res.json({
            ...turbo,
            productsPending: productsPending(),
            dadataPending: innsPending(),
            dadataUsedToday: dadataUsedToday(),
            dadataDailyLimit: CFG.dadataDailyLimit,
            config: CFG
        });
    });

    app.get('/api/calculate-daily-stats', (req: any, res: any) => {
        try {
            calculateDailyStats();
            res.json({ message: 'Агрегация данных завершена.' });
        } catch (e: any) {
            res.status(500).json({ error: 'Ошибка агрегации данных' });
        }
    });

    app.get('/api/sync-log', (req: any, res: any) => {
        try { res.json(db.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 50').all()); }
        catch (e) { res.status(500).json({ error: 'Ошибка чтения журнала' }); }
    });
}