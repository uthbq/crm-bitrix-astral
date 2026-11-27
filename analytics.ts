import type { Express } from 'express';
import db from './database';

const normName = (s: any): string =>
    String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();

try {
    db.function('norm_name', { deterministic: true }, normName);
} catch (e) {  }

function actualProductFilter(productId: any, alias: string = 'd'): { sql: string; params: any[] } {
    return {
        sql: `EXISTS (
            SELECT 1 FROM deal_products dp
            WHERE dp.bitrix_deal_id = ${alias}.bitrix_deal_id
              AND (dp.bitrix_product_id = (SELECT bitrix_id FROM products WHERE id = ?)
                   OR norm_name(dp.product_name) = (SELECT norm_name(name) FROM products WHERE id = ?))
        )`,
        params: [productId, productId]
    };
}

export function registerAnalyticsRoutes(app: Express): void {

    app.get('/api/dashboard', (req: any, res: any) => {
        try {
            const { manager_id, startDate, endDate, base_id, product_id, work_type } = req.query;
            const where: string[] = [];
            const params: any[] = [];
            if (manager_id) { where.push('manager_id = ?'); params.push(manager_id); }
            if (startDate) { where.push('date >= ?'); params.push(startDate); }
            if (endDate) { where.push('date <= ?'); params.push(endDate); }
            if (base_id) { where.push('base_id = ?'); params.push(base_id); }
            if (product_id) { where.push('product_id = ?'); params.push(product_id); }
            if (work_type) { where.push('work_type = ?'); params.push(work_type); }
            const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
            res.json(db.prepare(`
                SELECT date,
                    SUM(total_calls) as total_outbound,
                    SUM(valid_conversations) as valid_conversations,
                    SUM(unique_leads) as unique_leads,
                    SUM(quality_leads) as quality_leads,
                    SUM(transfers) as transfers,
                    SUM(paid_deals) as paid_deals,
                    SUM(amount_sum) as amount_sum
                FROM daily_stats ${whereClause}
                GROUP BY date ORDER BY date DESC
            `).all(...params));
        } catch (e) {
            console.error('Ошибка дашборда:', e);
            res.status(500).json({ error: 'Ошибка дашборда' });
        }
    });

    app.get('/api/stats/calls', (req: any, res: any) => {
        try {
            res.json(db.prepare(`
                SELECT c.manager_id,
                    COUNT(*) as total_outbound,
                    SUM(CASE
                        WHEN u.qualification = 'ведущий' AND c.duration_seconds >= 59 THEN 1
                        WHEN (u.qualification IS NULL OR u.qualification = 'обычный') AND c.duration_seconds >= 44 THEN 1
                        ELSE 0 END) as valid_conversations
                FROM calls c
                LEFT JOIN users u ON c.manager_id = u.bitrix_id
                WHERE c.direction = 'outgoing'
                GROUP BY c.manager_id
            `).all());
        } catch (e) {
            res.status(500).json({ error: 'Внутренняя ошибка сервера' });
        }
    });

    app.get('/api/analytics/managers', (req: any, res: any) => {
        try {
            const { startDate, endDate, base_id, product_id, department_id, manager_id } = req.query;
            const where: string[] = [];
            const params: any[] = [];
            if (startDate) { where.push('ds.date >= ?'); params.push(startDate); }
            if (endDate) { where.push('ds.date <= ?'); params.push(endDate); }
            if (base_id) { where.push('ds.base_id = ?'); params.push(base_id); }
            if (product_id) { where.push('ds.product_id = ?'); params.push(product_id); }
            if (department_id) { where.push('u.department_id = ?'); params.push(department_id); }
            if (manager_id) { where.push('ds.manager_id = ?'); params.push(manager_id); }
            const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
            res.json(db.prepare(`
                SELECT ds.manager_id,
                    COALESCE(u.login, 'ID ' || ds.manager_id) as manager_name,
                    COALESCE(dept.name, 'Без отдела') as department_name,
                    COALESCE(u.qualification, 'обычный') as qualification,
                    CASE WHEN u.qualification = 'ведущий' THEN 59 ELSE 44 END as threshold,
                    SUM(ds.total_calls) as total_calls,
                    SUM(ds.valid_conversations) as valid_conversations,
                    SUM(ds.unique_leads) as unique_leads,
                    SUM(ds.quality_leads) as quality_leads,
                    SUM(ds.transfers) as transfers,
                    SUM(ds.paid_deals) as paid_deals,
                    SUM(ds.amount_sum) as amount_sum
                FROM daily_stats ds
                LEFT JOIN users u ON ds.manager_id = u.bitrix_id
                LEFT JOIN departments dept ON u.department_id = dept.id
                ${whereClause}
                GROUP BY ds.manager_id
                ORDER BY amount_sum DESC, quality_leads DESC, valid_conversations DESC, total_calls DESC
            `).all(...params));
        } catch (e) {
            console.error('Ошибка рейтинга:', e);
            res.status(500).json({ error: 'Ошибка получения рейтинга' });
        }
    });

    app.get('/api/analytics/bases', (req: any, res: any) => {
        try {
            const { startDate, endDate, manager_id, product_id, okved } = req.query;
            const leadOn: string[] = []; const leadParams: any[] = [];
            if (startDate) { leadOn.push('date(l.created_at) >= ?'); leadParams.push(startDate); }
            if (endDate) { leadOn.push('date(l.created_at) <= ?'); leadParams.push(endDate); }
            if (manager_id) { leadOn.push('l.manager_id = ?'); leadParams.push(manager_id); }
            const leadOnSql = leadOn.length ? ' AND ' + leadOn.join(' AND ') : '';

            const dealWhere: string[] = ['d.amount > 0']; const dealParams: any[] = [];
            if (startDate) { dealWhere.push('date(d.created_at) >= ?'); dealParams.push(startDate); }
            if (endDate) { dealWhere.push('date(d.created_at) <= ?'); dealParams.push(endDate); }
            if (manager_id) { dealWhere.push('d.manager_id = ?'); dealParams.push(manager_id); }
            if (product_id) { dealWhere.push('b.main_product_id = ?'); dealParams.push(product_id); }
            if (okved) { dealWhere.push('d.okved = ?'); dealParams.push(okved); }

            const query = `
                WITH LeadStats AS (
                    SELECT b.id as base_id, b.name as base_name, b.main_product_id,
                        COUNT(l.id) as total_leads,
                        SUM(CASE WHEN l.status_id LIKE '%NEW%' OR l.status_id LIKE '%IMPORT%' THEN 1 ELSE 0 END) as import_leads,
                        SUM(CASE WHEN l.is_quality = 1 THEN 1 ELSE 0 END) as quality_leads,
                        SUM(CASE WHEN l.status_semantic = 'S' THEN 1 ELSE 0 END) as transfers
                    FROM bases b
                    LEFT JOIN leads l ON b.id = l.base_id${leadOnSql}
                    GROUP BY b.id
                ),
                FilteredDeals AS (
                    SELECT b.id as base_id, d.id, d.bitrix_deal_id, d.amount, d.is_cross_sale
                    FROM bases b
                    JOIN leads l ON l.base_id = b.id
                    JOIN deals d ON d.lead_id = l.bitrix_lead_id
                    WHERE ${dealWhere.join(' AND ')}
                ),
                RowStats AS (
                    SELECT dp.bitrix_deal_id,
                        COUNT(*) as rows_count, SUM(dp.sum) as rows_sum,
                        SUM(CASE WHEN dp.is_cross_sale = 0 THEN dp.sum ELSE 0 END) as main_sum,
                        SUM(CASE WHEN dp.is_cross_sale = 1 THEN dp.sum ELSE 0 END) as cross_sum,
                        SUM(CASE WHEN dp.is_cross_sale = 0 THEN 1 ELSE 0 END) as main_count,
                        SUM(CASE WHEN dp.is_cross_sale = 1 THEN 1 ELSE 0 END) as cross_count
                    FROM (SELECT DISTINCT bitrix_deal_id FROM FilteredDeals) fd
                    JOIN deal_products dp ON dp.bitrix_deal_id = fd.bitrix_deal_id
                    GROUP BY dp.bitrix_deal_id
                ),
                DealStats AS (
                    SELECT d.base_id,
                        COUNT(d.id) as paid_deals,
                        SUM(d.amount) as amount_sum,
                        SUM(CASE WHEN d.is_cross_sale = 1 THEN 1 ELSE 0 END) as cross_deals,
                        SUM(CASE
                            WHEN rs.rows_sum > 0 THEN d.amount * rs.main_sum / rs.rows_sum
                            WHEN rs.rows_count > 0 THEN d.amount * rs.main_count * 1.0 / rs.rows_count
                            ELSE 0 END) as main_amount,
                        SUM(CASE
                            WHEN rs.rows_sum > 0 THEN d.amount * rs.cross_sum / rs.rows_sum
                            WHEN rs.rows_count > 0 THEN d.amount * rs.cross_count * 1.0 / rs.rows_count
                            ELSE 0 END) as cross_amount,
                        SUM(CASE WHEN rs.rows_count IS NULL THEN d.amount ELSE 0 END) as unknown_amount
                    FROM FilteredDeals d
                    LEFT JOIN RowStats rs ON rs.bitrix_deal_id = d.bitrix_deal_id
                    GROUP BY d.base_id
                )
                SELECT ls.base_id, ls.base_name,
                    COALESCE(p.name, 'Не назначен') as main_product_name,
                    ls.total_leads, ls.import_leads, ls.quality_leads, ls.transfers,
                    COALESCE(ds.paid_deals, 0) as paid_deals,
                    COALESCE(ds.cross_deals, 0) as cross_deals,
                    ROUND(COALESCE(ds.amount_sum, 0), 2) as amount_sum,
                    ROUND(COALESCE(ds.main_amount, 0), 2) as main_amount,
                    ROUND(COALESCE(ds.cross_amount, 0), 2) as cross_amount,
                    ROUND(COALESCE(ds.unknown_amount, 0), 2) as unknown_amount
                FROM LeadStats ls
                LEFT JOIN DealStats ds ON ds.base_id = ls.base_id
                LEFT JOIN products p ON p.id = ls.main_product_id
                ORDER BY amount_sum DESC, quality_leads DESC
                LIMIT 200
            `;
            res.json(db.prepare(query).all(...leadParams, ...dealParams));
        } catch (e) {
            console.error('Ошибка аналитики баз:', e);
            res.status(500).json({ error: 'Ошибка получения аналитики баз' });
        }
    });

    app.get('/api/analytics/teams-funnel', (req: any, res: any) => {
        try {
            const { startDate, endDate, category_id, department_id, onlyTm, okved, product_id, cross_only } = req.query;
            const where: string[] = ['1=1'];
            const params: any[] = [];
            if (startDate) { where.push('date(d.created_at) >= ?'); params.push(startDate); }
            if (endDate) { where.push('date(d.created_at) <= ?'); params.push(endDate); }
            if (category_id !== undefined && category_id !== '') { where.push('d.category_id = ?'); params.push(Number(category_id)); }
            if (department_id) { where.push('u.department_id = ?'); params.push(Number(department_id)); }
            if (okved) { where.push('d.okved = ?'); params.push(okved); }
            if (cross_only === 'true') { where.push('d.is_cross_sale = 1'); }
            if (product_id) {
                const f = actualProductFilter(product_id);
                where.push(f.sql); params.push(...f.params);
            }
            if (onlyTm === 'true') {
                where.push(`(
                    d.lead_id IS NOT NULL OR d.tm_mark = 1
                    OR (d.inn IS NOT NULL AND d.inn != '' AND d.inn IN (SELECT DISTINCT inn FROM leads WHERE inn IS NOT NULL AND inn != ''))
                )`);
            }
            const whereClause = 'WHERE ' + where.join(' AND ');

            const categories = db.prepare(`
                SELECT DISTINCT category_id as id, COALESCE(category_name, 'Воронка #' || category_id) as name
                FROM deals WHERE category_id IS NOT NULL ORDER BY category_id ASC
            `).all();

            const summary = db.prepare(`
                SELECT
                    COUNT(d.id) as total_deals,
                    SUM(CASE WHEN d.stage_semantic = 'P' OR d.stage_semantic IS NULL THEN 1 ELSE 0 END) as in_work,
                    SUM(CASE WHEN d.stage_semantic = 'S' THEN 1 ELSE 0 END) as won_deals,
                    SUM(CASE WHEN d.stage_semantic = 'F' THEN 1 ELSE 0 END) as lost_deals,
                    SUM(CASE WHEN d.stage_semantic = 'S' THEN d.amount ELSE 0 END) as won_amount,
                    SUM(CASE WHEN d.is_cross_sale = 1 THEN 1 ELSE 0 END) as cross_deals,
                    SUM(CASE WHEN d.stage_semantic = 'S' AND d.is_cross_sale = 1 THEN d.amount ELSE 0 END) as cross_amount,
                    SUM(CASE WHEN d.okved IS NULL OR d.okved = '' THEN 1 ELSE 0 END) as no_okved,
                    ROUND(AVG(CASE WHEN d.stage_semantic = 'S' AND d.stage_changed_at IS NOT NULL AND d.created_at IS NOT NULL
                        THEN MAX(0, julianday(d.stage_changed_at) - julianday(d.created_at)) END), 1) as avg_days_to_pay,
                    ROUND(AVG(CASE WHEN d.stage_semantic = 'F' AND d.stage_changed_at IS NOT NULL AND d.created_at IS NOT NULL
                        THEN MAX(0, julianday(d.stage_changed_at) - julianday(d.created_at)) END), 1) as avg_days_to_loss
                FROM deals d
                LEFT JOIN users u ON d.manager_id = u.bitrix_id
                ${whereClause}
            `).get(...params);

            const byDepartment = db.prepare(`
                SELECT COALESCE(dept.id, 0) as department_id,
                    COALESCE(dept.name, 'Без отдела') as department_name,
                    COUNT(d.id) as total_deals,
                    SUM(CASE WHEN d.stage_semantic = 'P' OR d.stage_semantic IS NULL THEN 1 ELSE 0 END) as in_work,
                    SUM(CASE WHEN d.stage_semantic = 'S' THEN 1 ELSE 0 END) as won_deals,
                    SUM(CASE WHEN d.stage_semantic = 'F' THEN 1 ELSE 0 END) as lost_deals,
                    SUM(CASE WHEN d.stage_semantic = 'S' THEN d.amount ELSE 0 END) as won_amount,
                    SUM(CASE WHEN d.is_cross_sale = 1 THEN 1 ELSE 0 END) as cross_deals,
                    SUM(CASE WHEN d.stage_semantic = 'S' AND d.is_cross_sale = 1 THEN d.amount ELSE 0 END) as cross_amount
                FROM deals d
                LEFT JOIN users u ON d.manager_id = u.bitrix_id
                LEFT JOIN departments dept ON u.department_id = dept.id
                ${whereClause}
                GROUP BY COALESCE(dept.id, 0)
                ORDER BY won_amount DESC, total_deals DESC
            `).all(...params);

            const lossStages = db.prepare(`
                SELECT COALESCE(d.stage_name, d.stage_id, 'Не указана') as stage_name,
                    COALESCE(d.category_name, 'Общая воронка') as category_name,
                    COUNT(d.id) as count,
                    SUM(d.amount) as lost_amount
                FROM deals d
                LEFT JOIN users u ON d.manager_id = u.bitrix_id
                ${whereClause} AND d.stage_semantic = 'F'
                GROUP BY d.stage_id, d.category_id
                ORDER BY count DESC LIMIT 15
            `).all(...params);

            const managersRating = db.prepare(`
                SELECT d.manager_id,
                    COALESCE(u.login, 'ID ' || d.manager_id) as manager_name,
                    COALESCE(dept.name, 'Без отдела') as department_name,
                    COUNT(d.id) as total_deals,
                    SUM(CASE WHEN d.stage_semantic = 'P' OR d.stage_semantic IS NULL THEN 1 ELSE 0 END) as in_work,
                    SUM(CASE WHEN d.stage_semantic = 'S' THEN 1 ELSE 0 END) as won_deals,
                    SUM(CASE WHEN d.stage_semantic = 'F' THEN 1 ELSE 0 END) as lost_deals,
                    SUM(CASE WHEN d.stage_semantic = 'S' THEN d.amount ELSE 0 END) as won_amount,
                    SUM(CASE WHEN d.is_cross_sale = 1 THEN 1 ELSE 0 END) as cross_deals,
                    SUM(CASE WHEN d.stage_semantic = 'S' AND d.is_cross_sale = 1 THEN d.amount ELSE 0 END) as cross_amount,
                    ROUND(AVG(CASE WHEN d.stage_semantic = 'S' AND d.stage_changed_at IS NOT NULL AND d.created_at IS NOT NULL
                        THEN MAX(0, julianday(d.stage_changed_at) - julianday(d.created_at)) END), 1) as avg_days_to_pay
                FROM deals d
                LEFT JOIN users u ON d.manager_id = u.bitrix_id
                LEFT JOIN departments dept ON u.department_id = dept.id
                ${whereClause}
                GROUP BY d.manager_id
                ORDER BY won_amount DESC, won_deals DESC, total_deals DESC
                LIMIT 30
            `).all(...params);

            const companiesRating = db.prepare(`
                SELECT
                    COALESCE(NULLIF(d.inn, ''), d.company_title) as company_key,
                    COALESCE(NULLIF(d.company_title, ''), MAX(c.company_name), 'ИНН ' || NULLIF(d.inn, ''), 'Без компании') as company_name,
                    d.inn,
                    COALESCE(MAX(d.okved), MAX(c.okved)) as okved,
                    COUNT(d.id) as deals_count,
                    SUM(CASE WHEN d.stage_semantic = 'S' THEN 1 ELSE 0 END) as won_deals,
                    SUM(CASE WHEN d.stage_semantic = 'S' THEN d.amount ELSE 0 END) as won_amount,
                    SUM(CASE WHEN d.is_cross_sale = 1 THEN 1 ELSE 0 END) as cross_deals,
                    (SELECT GROUP_CONCAT(pn, ', ') FROM (
                        SELECT DISTINCT dp.product_name as pn
                        FROM deals d2
                        JOIN deal_products dp ON dp.bitrix_deal_id = d2.bitrix_deal_id
                        WHERE COALESCE(NULLIF(d2.inn, ''), d2.company_title) = COALESCE(NULLIF(d.inn, ''), d.company_title)
                    )) as products_list
                FROM deals d
                LEFT JOIN users u ON d.manager_id = u.bitrix_id
                LEFT JOIN companies c ON c.inn = d.inn
                ${whereClause} AND (d.company_title IS NOT NULL OR d.inn IS NOT NULL)
                GROUP BY company_key
                ORDER BY won_amount DESC, deals_count DESC
                LIMIT 25
            `).all(...params);

            res.json({ categories, summary, byDepartment, lossStages, managersRating, companiesRating });
        } catch (e) {
            console.error('Ошибка аналитики команд и воронок:', e);
            res.status(500).json({ error: 'Ошибка загрузки аналитики команд' });
        }
    });

    app.get('/api/analytics/stuck', (req: any, res: any) => {
        try {
            const entity = req.query.entity === 'leads' ? 'leads' : 'deals';
            const days = Math.max(1, Number(req.query.days) || 7);
            const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
            const { base_id, product_id, manager_id, department_id, okved, cross_only } = req.query;
            const where: string[] = [];
            const params: any[] = [];

            if (entity === 'deals') {
                where.push("(d.stage_semantic = 'P' OR d.stage_semantic IS NULL)");
                where.push("CAST(julianday('now') - julianday(COALESCE(d.last_activity_at, d.created_at)) AS INTEGER) >= ?");
                params.push(days);
                if (base_id) { where.push('l.base_id = ?'); params.push(base_id); }
                if (product_id) { where.push('b.main_product_id = ?'); params.push(product_id); }
                if (manager_id) { where.push('d.manager_id = ?'); params.push(manager_id); }
                if (department_id) { where.push('u.department_id = ?'); params.push(department_id); }
                if (okved) { where.push('COALESCE(d.okved, c.okved) = ?'); params.push(okved); }
                if (cross_only === 'true') { where.push('d.is_cross_sale = 1'); }
                params.push(limit);
                res.json(db.prepare(`
                    SELECT d.bitrix_deal_id as id, 'deal' as entity_type,
                        COALESCE(b.name, 'Без базы') as base_name,
                        COALESCE(p.name, 'Не назначен') as product_name,
                        COALESCE(NULLIF(d.products_list, ''), 'Не загружены') as products_list,
                        d.product_field, d.is_cross_sale,
                        COALESCE(d.okved, c.okved) as okved,
                        d.inn, d.company_title, d.lead_id,
                        COALESCE(u.login, 'ID ' || d.manager_id) as manager_name,
                        COALESCE(dept.name, 'Без отдела') as department_name,
                        COALESCE(d.stage_name, d.stage_id, 'Не указана') as stage,
                        COALESCE(d.category_name, 'Общая воронка') as category_name,
                        COALESCE(d.last_activity_at, d.created_at) as last_contact_at,
                        CAST(julianday('now') - julianday(COALESCE(d.last_activity_at, d.created_at)) AS INTEGER) as days_stuck,
                        d.amount
                    FROM deals d
                    LEFT JOIN leads l ON d.lead_id = l.bitrix_lead_id
                    LEFT JOIN bases b ON l.base_id = b.id
                    LEFT JOIN products p ON b.main_product_id = p.id
                    LEFT JOIN users u ON d.manager_id = u.bitrix_id
                    LEFT JOIN departments dept ON u.department_id = dept.id
                    LEFT JOIN companies c ON c.inn = d.inn
                    WHERE ${where.join(' AND ')}
                    ORDER BY days_stuck DESC LIMIT ?
                `).all(...params));
            } else {
                where.push("l.status_semantic = 'P'");
                where.push("l.status_id NOT LIKE '%NEW%'");
                where.push("CAST(julianday('now') - julianday(COALESCE(l.last_activity_at, l.created_at)) AS INTEGER) >= ?");
                params.push(days);
                if (base_id) { where.push('l.base_id = ?'); params.push(base_id); }
                if (product_id) { where.push('b.main_product_id = ?'); params.push(product_id); }
                if (manager_id) { where.push('l.manager_id = ?'); params.push(manager_id); }
                if (department_id) { where.push('u.department_id = ?'); params.push(department_id); }
                if (okved) { where.push('c.okved = ?'); params.push(okved); }
                params.push(limit);
                res.json(db.prepare(`
                    SELECT l.bitrix_lead_id as id, 'lead' as entity_type,
                        COALESCE(b.name, 'Без базы') as base_name,
                        COALESCE(p.name, 'Не назначен') as product_name,
                        (SELECT GROUP_CONCAT(DISTINCT dp.product_name)
                         FROM deals d JOIN deal_products dp ON dp.bitrix_deal_id = d.bitrix_deal_id
                         WHERE d.lead_id = l.bitrix_lead_id) as products_list,
                        c.okved as okved, l.inn,
                        (SELECT COUNT(*) FROM deals d WHERE d.lead_id = l.bitrix_lead_id) as deals_count,
                        COALESCE(u.login, 'ID ' || l.manager_id) as manager_name,
                        COALESCE(dept.name, 'Без отдела') as department_name,
                        COALESCE(l.status_id, 'В работе') as stage,
                        COALESCE(l.last_activity_at, l.created_at) as last_contact_at,
                        CAST(julianday('now') - julianday(COALESCE(l.last_activity_at, l.created_at)) AS INTEGER) as days_stuck,
                        0 as amount
                    FROM leads l
                    LEFT JOIN bases b ON l.base_id = b.id
                    LEFT JOIN products p ON b.main_product_id = p.id
                    LEFT JOIN users u ON l.manager_id = u.bitrix_id
                    LEFT JOIN departments dept ON u.department_id = dept.id
                    LEFT JOIN companies c ON c.inn = l.inn
                    WHERE ${where.join(' AND ')}
                    ORDER BY days_stuck DESC LIMIT ?
                `).all(...params));
            }
        } catch (e) {
            console.error('Ошибка получения зависших сущностей:', e);
            res.status(500).json({ error: 'Ошибка загрузки зависших сделок/лидов' });
        }
    });

    app.get('/api/analytics/refusals', (req: any, res: any) => {
        try {
            const { startDate, endDate, base_id, manager_id, product_id, department_id, okved } = req.query;
            const where = ['l.refusal_reason_id IS NOT NULL'];
            const params: any[] = [];
            if (startDate) { where.push('date(l.created_at) >= ?'); params.push(startDate); }
            if (endDate) { where.push('date(l.created_at) <= ?'); params.push(endDate); }
            if (base_id) { where.push('l.base_id = ?'); params.push(base_id); }
            if (manager_id) { where.push('l.manager_id = ?'); params.push(manager_id); }
            if (product_id) { where.push('b.main_product_id = ?'); params.push(product_id); }
            if (department_id) { where.push('u.department_id = ?'); params.push(department_id); }
            if (okved) { where.push('c.okved = ?'); params.push(okved); }
            res.json(db.prepare(`
                SELECT r.id, r.name as reason_name, COUNT(l.id) as count
                FROM leads l
                JOIN refusal_reasons r ON l.refusal_reason_id = r.id
                LEFT JOIN bases b ON l.base_id = b.id
                LEFT JOIN users u ON l.manager_id = u.bitrix_id
                LEFT JOIN companies c ON c.inn = l.inn
                WHERE ${where.join(' AND ')}
                GROUP BY r.id ORDER BY count DESC
            `).all(...params));
        } catch (e) {
            console.error('Ошибка аналитики отказов:', e);
            res.status(500).json({ error: 'Ошибка получения аналитики отказов' });
        }
    });

    app.get('/api/analytics/refusals/silent', (req: any, res: any) => {
        try {
            const { startDate, endDate, department_id } = req.query;
            const where = ["l.refusal_reason_id IS NULL AND l.status_semantic = 'F'"];
            const params: any[] = [];
            if (startDate) { where.push('date(l.created_at) >= ?'); params.push(startDate); }
            if (endDate) { where.push('date(l.created_at) <= ?'); params.push(endDate); }
            if (department_id) { where.push('u.department_id = ?'); params.push(department_id); }
            res.json(db.prepare(`
                SELECT l.manager_id, COALESCE(u.login, 'ID ' || l.manager_id) as manager_name,
                    COUNT(l.id) as silent_count
                FROM leads l
                LEFT JOIN users u ON l.manager_id = u.bitrix_id
                WHERE ${where.join(' AND ')}
                GROUP BY l.manager_id ORDER BY silent_count DESC LIMIT 5
            `).all(...params));
        } catch (e) {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.get('/api/analytics/refusals/:reason_id/details', (req: any, res: any) => {
        try {
            const { startDate, endDate, base_id, manager_id } = req.query;
            const where = ['l.refusal_reason_id = ?'];
            const params: any[] = [req.params.reason_id];
            if (startDate) { where.push('date(l.created_at) >= ?'); params.push(startDate); }
            if (endDate) { where.push('date(l.created_at) <= ?'); params.push(endDate); }
            if (base_id) { where.push('l.base_id = ?'); params.push(base_id); }
            if (manager_id) { where.push('l.manager_id = ?'); params.push(manager_id); }
            res.json(db.prepare(`
                SELECT l.bitrix_lead_id, l.created_at, l.inn,
                    COALESCE(b.name, 'Без базы') as base_name,
                    COALESCE(p.name, 'Не назначен') as product_name,
                    c.okved as okved,
                    COALESCE(l.status_id, '—') as status_id,
                    COALESCE(u.login, 'ID ' || l.manager_id) as manager_name,
                    (SELECT GROUP_CONCAT(DISTINCT dp.product_name)
                     FROM deals d JOIN deal_products dp ON dp.bitrix_deal_id = d.bitrix_deal_id
                     WHERE d.lead_id = l.bitrix_lead_id) as products_list
                FROM leads l
                LEFT JOIN bases b ON l.base_id = b.id
                LEFT JOIN products p ON b.main_product_id = p.id
                LEFT JOIN users u ON l.manager_id = u.bitrix_id
                LEFT JOIN companies c ON c.inn = l.inn
                WHERE ${where.join(' AND ')}
                ORDER BY l.created_at DESC LIMIT 100
            `).all(...params));
        } catch (e) {
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.get('/api/analytics/products-and-calls', (req: any, res: any) => {
        try {
            const { startDate, endDate, manager_id, base_id, product_id, okved } = req.query;
            const where = ['l.is_quality = 1'];
            const params: any[] = [];
            if (startDate) { where.push('date(l.created_at) >= ?'); params.push(startDate); }
            if (endDate) { where.push('date(l.created_at) <= ?'); params.push(endDate); }
            if (manager_id) { where.push('l.manager_id = ?'); params.push(manager_id); }
            if (base_id) { where.push('l.base_id = ?'); params.push(base_id); }
            if (product_id) { where.push('b.main_product_id = ?'); params.push(product_id); }
            if (okved) { where.push('c.okved = ?'); params.push(okved); }

            const leadsByProduct = db.prepare(`
                SELECT COALESCE(p.name, 'Без продукта') as product_name, COUNT(l.id) as quality_leads
                FROM leads l
                LEFT JOIN bases b ON l.base_id = b.id
                LEFT JOIN products p ON b.main_product_id = p.id
                LEFT JOIN companies c ON c.inn = l.inn
                WHERE ${where.join(' AND ')}
                GROUP BY p.id ORDER BY quality_leads DESC
            `).all(...params);

            const callsWhere: string[] = [];
            const callsParams: any[] = [];
            if (startDate) { callsWhere.push('date(c.started_at) >= ?'); callsParams.push(startDate); }
            if (endDate) { callsWhere.push('date(c.started_at) <= ?'); callsParams.push(endDate); }
            if (manager_id) { callsWhere.push('c.manager_id = ?'); callsParams.push(manager_id); }
            const callsWhereClause = callsWhere.length ? 'WHERE ' + callsWhere.join(' AND ') : '';

            const callsStats = db.prepare(`
                SELECT COUNT(c.id) as total_calls,
                    SUM(CASE WHEN c.direction = 'outgoing' THEN 1 ELSE 0 END) as outgoing_calls,
                    SUM(CASE
                        WHEN (c.owner_type = 'lead' AND EXISTS (SELECT 1 FROM leads l WHERE l.bitrix_lead_id = c.owner_id))
                          OR (c.owner_type = 'deal' AND EXISTS (SELECT 1 FROM deals d WHERE d.bitrix_deal_id = c.owner_id))
                        THEN 1 ELSE 0 END) as assigned_calls,
                    SUM(CASE
                        WHEN (c.owner_type = 'lead' AND EXISTS (SELECT 1 FROM leads l WHERE l.bitrix_lead_id = c.owner_id))
                          OR (c.owner_type = 'deal' AND EXISTS (SELECT 1 FROM deals d WHERE d.bitrix_deal_id = c.owner_id))
                        THEN 0 ELSE 1 END) as unassigned_calls
                FROM calls c ${callsWhereClause}
            `).get(...callsParams);

            res.json({ leadsByProduct, callsStats });
        } catch (e) {
            console.error('Ошибка аналитики продуктов/звонков:', e);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });

    app.get('/api/analytics/products', (req: any, res: any) => {
        try {
            const { startDate, endDate, manager_id, base_id, okved, cross_only } = req.query;
            const where = ['d.amount > 0'];
            const params: any[] = [];
            if (startDate) { where.push('date(d.created_at) >= ?'); params.push(startDate); }
            if (endDate) { where.push('date(d.created_at) <= ?'); params.push(endDate); }
            if (manager_id) { where.push('d.manager_id = ?'); params.push(manager_id); }
            if (base_id) { where.push('l.base_id = ?'); params.push(base_id); }
            if (okved) { where.push('d.okved = ?'); params.push(okved); }
            if (cross_only === 'true') { where.push('dp.is_cross_sale = 1'); }

            const joinLeads = base_id ? 'LEFT JOIN leads l ON d.lead_id = l.bitrix_lead_id' : '';

            const productsRows = db.prepare(
                'SELECT id, bitrix_id, name, product_group FROM products'
            ).all() as Array<{ id: number; bitrix_id: number | null; name: string; product_group: string | null }>;

            const byBitrixId = new Map<number, typeof productsRows[number]>();
            const byNormName = new Map<string, typeof productsRows[number]>();
            for (const p of productsRows) {
                if (p.bitrix_id !== null && p.bitrix_id !== undefined && !byBitrixId.has(Number(p.bitrix_id))) {
                    byBitrixId.set(Number(p.bitrix_id), p);
                }
                const nn = normName(p.name);
                if (nn && !byNormName.has(nn)) {
                    byNormName.set(nn, p);
                }
            }

            const dpRows = db.prepare(`
                SELECT
                    dp.bitrix_product_id,
                    dp.product_name,
                    dp.product_group,
                    d.bitrix_deal_id,
                    d.stage_semantic,
                    dp.quantity,
                    dp.sum,
                    dp.is_cross_sale
                FROM deal_products dp
                JOIN deals d ON d.bitrix_deal_id = dp.bitrix_deal_id
                ${joinLeads}
                WHERE ${where.join(' AND ')}
            `).all(...params) as Array<{
                bitrix_product_id: number | null;
                product_name: string;
                product_group: string | null;
                bitrix_deal_id: number;
                stage_semantic: string | null;
                quantity: number | null;
                sum: number | null;
                is_cross_sale: number | null;
            }>;

            const normCache = new Map<string, string>();
            const agg = new Map<string, {
                product_name: string;
                product_group: string;
                deals: Set<number>;
                quantity: number;
                rows_amount: number;
                won_amount: number;
                cross_amount: number;
                cross_rows: number;
            }>();

            for (const r of dpRows) {
                let matched = (r.bitrix_product_id !== null && r.bitrix_product_id !== undefined)
                    ? byBitrixId.get(Number(r.bitrix_product_id))
                    : undefined;

                if (!matched) {
                    const rawName = r.product_name ?? '';
                    let nn = normCache.get(rawName);
                    if (nn === undefined) {
                        nn = normName(rawName);
                        normCache.set(rawName, nn);
                    }
                    if (nn) matched = byNormName.get(nn);
                }

                const key = matched ? `p:${matched.id}` : `n:${r.product_name ?? ''}`;
                let item = agg.get(key);
                if (!item) {
                    item = {
                        product_name: matched ? matched.name : r.product_name,
                        product_group: matched?.product_group || r.product_group || 'Без группы',
                        deals: new Set<number>(),
                        quantity: 0,
                        rows_amount: 0,
                        won_amount: 0,
                        cross_amount: 0,
                        cross_rows: 0
                    };
                    agg.set(key, item);
                }

                const qty = Number(r.quantity) || 0;
                const rowSum = Number(r.sum) || 0;
                item.deals.add(r.bitrix_deal_id);
                item.quantity += qty;
                item.rows_amount += rowSum;
                if (r.stage_semantic === 'S') item.won_amount += rowSum;
                if (r.is_cross_sale === 1) {
                    item.cross_amount += rowSum;
                    item.cross_rows += 1;
                }
            }

            const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
            const salesByProduct = Array.from(agg.values())
                .map(item => ({
                    product_name: item.product_name,
                    product_group: item.product_group,
                    deals_count: item.deals.size,
                    quantity: round2(item.quantity),
                    rows_amount: round2(item.rows_amount),
                    won_amount: round2(item.won_amount),
                    cross_amount: round2(item.cross_amount),
                    cross_rows: item.cross_rows
                }))
                .sort((a, b) => b.rows_amount - a.rows_amount)
                .slice(0, 100);

            res.json({ salesByProduct });
        } catch (e) {
            console.error('Ошибка аналитики по продуктам:', e);
            res.status(500).json({ error: 'Ошибка аналитики по продуктам' });
        }
    });

    app.get('/api/analytics/okved', (req: any, res: any) => {
        try {
            const { startDate, endDate, manager_id, base_id, department_id, product_id, onlyTm } = req.query;
            const where = ['1=1'];
            const params: any[] = [];
            if (startDate) { where.push('date(d.created_at) >= ?'); params.push(startDate); }
            if (endDate) { where.push('date(d.created_at) <= ?'); params.push(endDate); }
            if (manager_id) { where.push('d.manager_id = ?'); params.push(manager_id); }
            if (base_id) { where.push('l.base_id = ?'); params.push(base_id); }
            if (department_id) { where.push('u.department_id = ?'); params.push(department_id); }
            if (product_id) {
                const f = actualProductFilter(product_id);
                where.push(f.sql); params.push(...f.params);
            }
            if (onlyTm === 'true') {
                where.push(`(d.lead_id IS NOT NULL OR d.tm_mark = 1
                    OR (d.inn IS NOT NULL AND d.inn != '' AND d.inn IN (SELECT DISTINCT inn FROM leads WHERE inn IS NOT NULL AND inn != '')))`);
            }
            res.json(db.prepare(`
                SELECT
                    COALESCE(NULLIF(d.okved, ''), c.okved, 'Не указан') as okved_code,
                    ok.name as okved_name,
                    COUNT(d.id) as deals_count,
                    COUNT(DISTINCT d.lead_id) as leads_transferred,
                    SUM(CASE WHEN d.stage_semantic = 'S' THEN 1 ELSE 0 END) as won_deals,
                    SUM(CASE WHEN d.stage_semantic = 'F' THEN 1 ELSE 0 END) as lost_deals,
                    ROUND(SUM(CASE WHEN d.stage_semantic = 'S' THEN d.amount ELSE 0 END), 2) as won_amount,
                    ROUND(AVG(CASE WHEN d.stage_semantic = 'S' AND d.amount > 0 THEN d.amount END), 0) as avg_check,
                    ROUND(AVG(CASE WHEN d.stage_semantic = 'S' AND d.stage_changed_at IS NOT NULL AND d.created_at IS NOT NULL
                        THEN MAX(0, julianday(d.stage_changed_at) - julianday(d.created_at)) END), 1) as avg_days_to_pay
                FROM deals d
                LEFT JOIN leads l ON d.lead_id = l.bitrix_lead_id
                LEFT JOIN users u ON d.manager_id = u.bitrix_id
                LEFT JOIN companies c ON c.inn = d.inn
                LEFT JOIN okved ok ON ok.code = COALESCE(NULLIF(d.okved, ''), c.okved)
                WHERE ${where.join(' AND ')}
                GROUP BY COALESCE(NULLIF(d.okved, ''), c.okved, 'Не указан')
                ORDER BY won_amount DESC, deals_count DESC
                LIMIT 100
            `).all(...params));
        } catch (e) {
            console.error('Ошибка аналитики ОКВЭД:', e);
            res.status(500).json({ error: 'Ошибка аналитики ОКВЭД' });
        }
    });

    app.get('/api/analytics/drilldown', (req: any, res: any) => {
        try {
            const { startDate, endDate, manager_id, base_id, metric, okved, product_id } = req.query;
            if (metric === 'quality_leads' || metric === 'transfers') {
                const where = metric === 'transfers' ? ["l.status_semantic = 'S'"] : ['l.is_quality = 1'];
                const params: any[] = [];
                if (startDate) { where.push('date(l.created_at) >= ?'); params.push(startDate); }
                if (endDate) { where.push('date(l.created_at) <= ?'); params.push(endDate); }
                if (manager_id) { where.push('l.manager_id = ?'); params.push(manager_id); }
                if (base_id) { where.push('l.base_id = ?'); params.push(base_id); }
                if (okved) { where.push('c.okved = ?'); params.push(okved); }
                if (product_id) { where.push('b.main_product_id = ?'); params.push(product_id); }
                res.json(db.prepare(`
                    SELECT l.bitrix_lead_id as b24_id, l.created_at, 'lead' as type,
                        b.name as base_name, COALESCE(p.name, 'Не назначен') as product_name,
                        c.okved as okved, l.inn,
                        COALESCE(u.login, 'ID ' || l.manager_id) as manager_name,
                        (SELECT GROUP_CONCAT(DISTINCT dp.product_name)
                         FROM deals d JOIN deal_products dp ON dp.bitrix_deal_id = d.bitrix_deal_id
                         WHERE d.lead_id = l.bitrix_lead_id) as products_list,
                        0 as amount, 0 as is_cross_sale
                    FROM leads l
                    LEFT JOIN bases b ON l.base_id = b.id
                    LEFT JOIN products p ON b.main_product_id = p.id
                    LEFT JOIN users u ON l.manager_id = u.bitrix_id
                    LEFT JOIN companies c ON c.inn = l.inn
                    WHERE ${where.join(' AND ')}
                    ORDER BY l.created_at DESC LIMIT 200
                `).all(...params));
            } else if (metric === 'paid_deals' || metric === 'cross_deals' || metric === 'won_deals') {
                const where = metric === 'won_deals' ? ["d.stage_semantic = 'S'"] : ['d.amount > 0'];
                const params: any[] = [];
                if (metric === 'cross_deals') where.push('d.is_cross_sale = 1');
                if (startDate) { where.push('date(d.created_at) >= ?'); params.push(startDate); }
                if (endDate) { where.push('date(d.created_at) <= ?'); params.push(endDate); }
                if (manager_id) { where.push('d.manager_id = ?'); params.push(manager_id); }
                if (base_id) { where.push('l.base_id = ?'); params.push(base_id); }
                if (okved) { where.push('COALESCE(d.okved, c.okved) = ?'); params.push(okved); }
                if (product_id) {
                    const f = actualProductFilter(product_id);
                    where.push(f.sql); params.push(...f.params);
                }
                res.json(db.prepare(`
                    SELECT d.bitrix_deal_id as b24_id, d.created_at, 'deal' as type,
                        d.amount, d.lead_id, d.inn, d.company_title,
                        b.name as base_name, COALESCE(p.name, 'Не назначен') as product_name,
                        COALESCE(NULLIF(d.products_list, ''), 'Не загружены') as products_list,
                        d.product_field, d.is_cross_sale,
                        COALESCE(d.okved, c.okved) as okved,
                        COALESCE(d.stage_name, d.stage_id) as stage,
                        COALESCE(u.login, 'ID ' || d.manager_id) as manager_name
                    FROM deals d
                    LEFT JOIN leads l ON d.lead_id = l.bitrix_lead_id
                    LEFT JOIN bases b ON l.base_id = b.id
                    LEFT JOIN products p ON b.main_product_id = p.id
                    LEFT JOIN users u ON d.manager_id = u.bitrix_id
                    LEFT JOIN companies c ON c.inn = d.inn
                    WHERE ${where.join(' AND ')}
                    ORDER BY d.created_at DESC LIMIT 200
                `).all(...params));
            } else {
                res.json([]);
            }
        } catch (e) {
            console.error('Ошибка детализации:', e);
            res.status(500).json({ error: 'Ошибка детализации' });
        }
    });

    app.get('/api/deals/:id/products', (req: any, res: any) => {
        try {
            const id = Number(req.params.id);
            const deal = db.prepare(`
                SELECT d.bitrix_deal_id, d.company_title, d.inn, d.okved, d.amount,
                    d.products_list, d.product_field, d.is_cross_sale, d.stage_name, d.category_name,
                    b.name as base_name, p.name as main_product_name
                FROM deals d
                LEFT JOIN leads l ON d.lead_id = l.bitrix_lead_id
                LEFT JOIN bases b ON l.base_id = b.id
                LEFT JOIN products p ON b.main_product_id = p.id
                WHERE d.bitrix_deal_id = ?
            `).get(id);
            if (!deal) return res.status(404).json({ error: 'Сделка не найдена в локальной БД' });
            const rows = db.prepare(`
                SELECT bitrix_row_id, bitrix_product_id, product_name, product_group,
                    quantity, price, sum, currency, is_cross_sale, synced_at
                FROM deal_products WHERE bitrix_deal_id = ? ORDER BY id
            `).all(id);
            res.json({ deal, rows });
        } catch (e) {
            res.status(500).json({ error: 'Ошибка загрузки товаров сделки' });
        }
    });

    app.get('/api/data-issues', (req: any, res: any) => {
        try {
            const details: any = {
                noBase: db.prepare("SELECT bitrix_lead_id as id, created_at, manager_id FROM leads WHERE base_id IS NULL AND status_id NOT LIKE '%NEW%' LIMIT 50").all(),
                noManager: db.prepare("SELECT bitrix_lead_id as id, created_at FROM leads WHERE manager_id IS NULL LIMIT 50").all(),
                dealsNoInn: db.prepare("SELECT bitrix_deal_id as id, created_at, amount FROM deals WHERE (inn IS NULL OR inn = '') AND amount > 0 LIMIT 50").all(),
                dealsNoOkved: db.prepare("SELECT bitrix_deal_id as id, created_at, amount, inn FROM deals WHERE (okved IS NULL OR okved = '') AND amount > 0 LIMIT 50").all(),
                // Расхождение поля «Продукт» и фактических товаров (ТЗ: проверка противоречий)
                productMismatch: db.prepare(`
                    SELECT bitrix_deal_id as id, product_field, products_list, amount FROM deals
                    WHERE product_field IS NOT NULL AND product_field != ''
                      AND products_list IS NOT NULL AND products_list != ''
                      AND INSTR(norm_name(products_list), norm_name(product_field)) = 0
                    LIMIT 50
                `).all(),
                ambiguousInn: db.prepare(`
                    SELECT d.inn, COUNT(DISTINCT d.bitrix_deal_id) as deals_count,
                        (SELECT COUNT(*) FROM leads l WHERE l.inn = d.inn) as leads_count,
                        ROUND(SUM(d.amount), 2) as amount
                    FROM deals d
                    WHERE d.inn IS NOT NULL AND d.inn != '' AND d.lead_id IS NULL AND d.amount > 0
                    GROUP BY d.inn
                    HAVING leads_count > 1
                    LIMIT 50
                `).all(),
                callsNoOwner: db.prepare(`
                    SELECT bitrix_call_id as id, started_at, owner_type FROM calls
                    WHERE owner_type IS NULL OR owner_id IS NULL OR owner_type NOT IN ('lead', 'deal')
                    LIMIT 50
                `).all(),
                unknownQualification: db.prepare(`
                    SELECT id, login, bitrix_id FROM users
                    WHERE role = 'MANAGER' AND (qualification IS NULL OR qualification NOT IN ('обычный', 'ведущий'))
                    LIMIT 50
                `).all(),
                dealsNoProducts: db.prepare(`
                    SELECT bitrix_deal_id as id, amount, stage_semantic FROM deals
                    WHERE products_list IS NULL AND amount > 0 LIMIT 50
                `).all()
            };
            const total = Object.values(details).reduce((sum: number, arr: any) => sum + arr.length, 0);
            res.json({ total, details });
        } catch (e) {
            console.error('Ошибка проверки качества данных:', e);
            res.status(500).json({ error: 'Ошибка проверки качества данных' });
        }
    });
}