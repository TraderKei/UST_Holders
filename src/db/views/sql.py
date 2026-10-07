VIEW_SQL = r"""
CREATE VIEW vw_current_holding AS
SELECT f.* FROM treasury_holding_fact f
JOIN dataset_vintage v ON v.vintage_id=f.vintage_id
WHERE v.is_active AND v.validation_status='PASS';

CREATE VIEW vw_holding_metrics AS
SELECT c.*,
 c.total_holdings_usd_mn-p1.total_holdings_usd_mn AS change_1m_usd_mn,
 c.total_holdings_usd_mn-p3.total_holdings_usd_mn AS change_3m_usd_mn,
 c.total_holdings_usd_mn-p6.total_holdings_usd_mn AS change_6m_usd_mn,
 c.total_holdings_usd_mn-p12.total_holdings_usd_mn AS change_12m_usd_mn,
 (c.total_holdings_usd_mn-p1.total_holdings_usd_mn)/NULLIF(p1.total_holdings_usd_mn,0)*100 AS change_1m_pct,
 (c.total_holdings_usd_mn-p3.total_holdings_usd_mn)/NULLIF(p3.total_holdings_usd_mn,0)*100 AS change_3m_pct,
 (c.total_holdings_usd_mn-p6.total_holdings_usd_mn)/NULLIF(p6.total_holdings_usd_mn,0)*100 AS change_6m_pct,
 (c.total_holdings_usd_mn-p12.total_holdings_usd_mn)/NULLIF(p12.total_holdings_usd_mn,0)*100 AS change_12m_pct,
 c.total_holdings_usd_mn/NULLIF(gt.total_holdings_usd_mn,0)*100 AS share_of_grand_total_pct,
 c.long_term_holdings_usd_mn/NULLIF(c.total_holdings_usd_mn,0)*100 AS long_term_share_pct,
 c.short_term_holdings_usd_mn/NULLIF(c.total_holdings_usd_mn,0)*100 AS short_term_share_pct,
 c.total_holdings_usd_mn-p1.total_holdings_usd_mn-c.net_transaction_usd_mn-c.long_term_valuation_change_usd_mn AS other_adjustment_usd_mn
FROM vw_current_holding c
JOIN reporting_period cp ON cp.period_id=c.period_id
LEFT JOIN reporting_period rp1 ON rp1.reference_month=(cp.reference_month-INTERVAL '1 month')::date
LEFT JOIN reporting_period rp3 ON rp3.reference_month=(cp.reference_month-INTERVAL '3 month')::date
LEFT JOIN reporting_period rp6 ON rp6.reference_month=(cp.reference_month-INTERVAL '6 month')::date
LEFT JOIN reporting_period rp12 ON rp12.reference_month=(cp.reference_month-INTERVAL '12 month')::date
LEFT JOIN vw_current_holding p1 ON p1.entity_id=c.entity_id AND p1.period_id=rp1.period_id
LEFT JOIN vw_current_holding p3 ON p3.entity_id=c.entity_id AND p3.period_id=rp3.period_id
LEFT JOIN vw_current_holding p6 ON p6.entity_id=c.entity_id AND p6.period_id=rp6.period_id
LEFT JOIN vw_current_holding p12 ON p12.entity_id=c.entity_id AND p12.period_id=rp12.period_id
LEFT JOIN holding_entity ge ON ge.tic_country_code='99996' AND ge.valid_to IS NULL
LEFT JOIN vw_current_holding gt ON gt.entity_id=ge.entity_id AND gt.period_id=c.period_id;

CREATE MATERIALIZED VIEW mv_country_month_rank AS
SELECT f.vintage_id,f.entity_id,f.period_id,
 RANK() OVER(PARTITION BY f.vintage_id,f.period_id ORDER BY f.total_holdings_usd_mn DESC) AS country_rank
FROM vw_current_holding f JOIN holding_entity e ON e.entity_id=f.entity_id
JOIN entity_type t ON t.entity_type_code=e.entity_type_code
WHERE e.entity_type_code='country' AND t.rank_eligible AND f.total_holdings_usd_mn IS NOT NULL;
CREATE UNIQUE INDEX ux_mv_country_month_rank ON mv_country_month_rank(vintage_id,entity_id,period_id);
"""
DROP_VIEW_SQL = "DROP MATERIALIZED VIEW IF EXISTS mv_country_month_rank; DROP VIEW IF EXISTS vw_holding_metrics; DROP VIEW IF EXISTS vw_current_holding;"
