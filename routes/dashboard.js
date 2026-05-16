const express = require("express");
const router = express.Router();
const db = require("../database/db");

function normalizePrivileges(privileges) {
    if (!privileges) return {};

    if (typeof privileges === "string") {
        try {
            return JSON.parse(privileges || "{}");
        } catch {
            return {};
        }
    }

    return privileges;
}

function isAdminUser(req) {
    const user = req.session?.user;
    if (!user) return false;

    const role = String(user.role || "").toLowerCase();
    const privileges = normalizePrivileges(user.privileges);

    return role === "admin" || privileges.manage_users === true;
}

function requireAdmin(req, res, next) {
    if (!req.session?.user) {
        return res.status(401).json({ message: "Not logged in" });
    }

    if (!isAdminUser(req)) {
        return res.status(403).json({ message: "Admin access only" });
    }

    next();
}

function ensureNotificationReadTable(callback) {
    const sql = `
        CREATE TABLE IF NOT EXISTS dashboard_notification_reads (
            user_id INT NOT NULL PRIMARY KEY,
            last_remit_id INT NOT NULL DEFAULT 0,
            last_expense_id INT NOT NULL DEFAULT 0,
            last_customer_id INT NOT NULL DEFAULT 0,
            last_payment_id INT NOT NULL DEFAULT 0,
            last_inventory_id INT NOT NULL DEFAULT 0,
            last_collector_id INT NOT NULL DEFAULT 0,
            last_cash_advance_id INT NOT NULL DEFAULT 0,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `;

    db.query(sql, callback);
}

function getReadState(userId, callback) {
    ensureNotificationReadTable((createErr) => {
        if (createErr) return callback(createErr);

        db.query(
            "SELECT * FROM dashboard_notification_reads WHERE user_id = ? LIMIT 1",
            [userId],
            (err, rows) => {
                if (err) return callback(err);

                const state = rows[0] || {
                    last_remit_id: 0,
                    last_expense_id: 0,
                    last_customer_id: 0,
                    last_payment_id: 0,
                    last_inventory_id: 0,
                    last_collector_id: 0,
                    last_cash_advance_id: 0
                };

                callback(null, state);
            }
        );
    });
}

router.get("/summary", (req, res) => {
    const sql = `
        SELECT
            (SELECT COUNT(*) FROM customers WHERE is_active = 1 OR is_active IS NULL) AS totalCustomers,
            (SELECT COUNT(*) FROM sales) AS totalSales,
            (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE LOWER(TRIM(payment_type)) = 'regular') AS totalCollected,
            (SELECT COALESCE(SUM(balance), 0) FROM sales) AS remainingBalance,
            (
                SELECT COALESCE(SUM(s.quantity * i.capital_price), 0)
                FROM sales s
                INNER JOIN inventory i ON s.item_id = i.id
            ) AS totalSoldCapital,
            (SELECT COALESCE(SUM(total_expense), 0) FROM expenses) AS totalExpenses
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.error("DASHBOARD SUMMARY ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result[0]);
    });
});

router.get("/recent-activity", (req, res) => {
    const sql = `
        SELECT
            c.name AS customer_name,
            p.amount,
            DATE_FORMAT(p.payment_date, '%Y-%m-%d') AS payment_date,
            p.payment_type
        FROM payments p
        JOIN sales s ON p.sale_id = s.id
        JOIN customers c ON s.customer_id = c.id
        ORDER BY p.payment_date DESC, p.id DESC
        LIMIT 10
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.error("DASHBOARD RECENT ACTIVITY ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

router.get("/notifications", requireAdmin, (req, res) => {
    const userId = req.session.user.id;

    getReadState(userId, (stateErr, state) => {
        if (stateErr) {
            console.error("DASHBOARD NOTIFICATION READ STATE ERROR:", stateErr);
            return res.status(500).json({ message: stateErr.sqlMessage || stateErr.message });
        }

        const sql = `
            SELECT
                (SELECT COUNT(*) FROM remits WHERE id > ?) AS remits_count,
                (SELECT COALESCE(SUM(total_selected_payments), 0) FROM remits WHERE id > ?) AS remits_total_selected_payments,
                (SELECT COALESCE(SUM(gross_total), 0) FROM remits WHERE id > ?) AS remits_gross_total,
                (SELECT COALESCE(SUM(net_total), 0) FROM remits WHERE id > ?) AS remits_net_total,
                (SELECT COALESCE(MAX(id), 0) FROM remits) AS max_remit_id,

                (SELECT COUNT(*) FROM expenses WHERE id > ?) AS expenses_count,
                (SELECT COALESCE(SUM(total_expense), 0) FROM expenses WHERE id > ?) AS expenses_total_expense,
                (SELECT COALESCE(MAX(id), 0) FROM expenses) AS max_expense_id,

                (SELECT COUNT(*) FROM customers WHERE id > ?) AS customers_count,
                (SELECT COALESCE(MAX(id), 0) FROM customers) AS max_customer_id,

                (SELECT COUNT(*) FROM payments WHERE id > ?) AS payments_count,
                (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE id > ?) AS payments_total_amount,
                (SELECT COALESCE(MAX(id), 0) FROM payments) AS max_payment_id,

                (SELECT COUNT(*) FROM inventory WHERE id > ?) AS inventory_count,
                (SELECT COALESCE(SUM(quantity), 0) FROM inventory WHERE id > ?) AS inventory_total_quantity,
                (SELECT COALESCE(SUM(quantity * capital_price), 0) FROM inventory WHERE id > ?) AS inventory_total_capital_value,
                (SELECT COALESCE(SUM(quantity * selling_price), 0) FROM inventory WHERE id > ?) AS inventory_total_selling_value,
                (SELECT COALESCE(MAX(id), 0) FROM inventory) AS max_inventory_id,

                (SELECT COUNT(*) FROM collectors WHERE id > ?) AS collectors_count,
                (SELECT COALESCE(MAX(id), 0) FROM collectors) AS max_collector_id,

                (SELECT COUNT(*) FROM collector_cash_advances WHERE id > ?) AS cash_advances_count,
                (SELECT COALESCE(SUM(amount), 0) FROM collector_cash_advances WHERE id > ?) AS cash_advances_total_amount,
                (SELECT COALESCE(SUM(remaining_amount), 0) FROM collector_cash_advances WHERE id > ?) AS cash_advances_total_remaining,
                (SELECT COALESCE(MAX(id), 0) FROM collector_cash_advances) AS max_cash_advance_id
        `;

        const params = [
            state.last_remit_id, state.last_remit_id, state.last_remit_id, state.last_remit_id,
            state.last_expense_id, state.last_expense_id,
            state.last_customer_id,
            state.last_payment_id, state.last_payment_id,
            state.last_inventory_id, state.last_inventory_id, state.last_inventory_id, state.last_inventory_id,
            state.last_collector_id,
            state.last_cash_advance_id, state.last_cash_advance_id, state.last_cash_advance_id
        ];

        db.query(sql, params, (err, rows) => {
            if (err) {
                console.error("DASHBOARD NOTIFICATION ERROR:", err);
                return res.status(500).json({ message: err.sqlMessage || err.message });
            }

            const row = rows[0] || {};

            const data = {
                remits: {
                    count: Number(row.remits_count || 0),
                    totalSelectedPayments: Number(row.remits_total_selected_payments || 0),
                    grossTotal: Number(row.remits_gross_total || 0),
                    netTotal: Number(row.remits_net_total || 0)
                },
                expenses: {
                    count: Number(row.expenses_count || 0),
                    totalExpense: Number(row.expenses_total_expense || 0)
                },
                customers: {
                    count: Number(row.customers_count || 0)
                },
                payments: {
                    count: Number(row.payments_count || 0),
                    totalAmount: Number(row.payments_total_amount || 0),
                    byCollector: []
                },
                inventory: {
                    count: Number(row.inventory_count || 0),
                    totalQuantity: Number(row.inventory_total_quantity || 0),
                    totalCapitalValue: Number(row.inventory_total_capital_value || 0),
                    totalSellingValue: Number(row.inventory_total_selling_value || 0)
                },
                collectors: {
                    count: Number(row.collectors_count || 0)
                },
                cashAdvances: {
                    count: Number(row.cash_advances_count || 0),
                    totalAmount: Number(row.cash_advances_total_amount || 0),
                    totalRemaining: Number(row.cash_advances_total_remaining || 0)
                }
            };

            const maxIds = {
                last_remit_id: Number(row.max_remit_id || 0),
                last_expense_id: Number(row.max_expense_id || 0),
                last_customer_id: Number(row.max_customer_id || 0),
                last_payment_id: Number(row.max_payment_id || 0),
                last_inventory_id: Number(row.max_inventory_id || 0),
                last_collector_id: Number(row.max_collector_id || 0),
                last_cash_advance_id: Number(row.max_cash_advance_id || 0)
            };

            const totalNew = Object.values(data).reduce((sum, item) => sum + Number(item.count || 0), 0);

            const paymentsByCollectorSql = `
                SELECT
                    COALESCE(col.name, 'No collector assigned') AS collector_name,
                    COUNT(p.id) AS payment_count,
                    COALESCE(SUM(p.amount), 0) AS total_amount
                FROM payments p
                LEFT JOIN sales s ON p.sale_id = s.id
                LEFT JOIN customers c ON s.customer_id = c.id
                LEFT JOIN collectors col ON c.collector_id = col.id
                WHERE p.id > ?
                GROUP BY COALESCE(col.name, 'No collector assigned')
                ORDER BY total_amount DESC, payment_count DESC, collector_name ASC
            `;

            db.query(paymentsByCollectorSql, [state.last_payment_id], (collectorErr, collectorRows) => {
                if (collectorErr) {
                    console.error('DASHBOARD PAYMENT COLLECTOR BREAKDOWN ERROR:', collectorErr);
                    return res.status(500).json({ message: collectorErr.sqlMessage || collectorErr.message });
                }

                data.payments.byCollector = (collectorRows || []).map(item => ({
                    collectorName: item.collector_name,
                    count: Number(item.payment_count || 0),
                    totalAmount: Number(item.total_amount || 0)
                }));

                res.json({
                    data,
                    maxIds,
                    totalNew,
                    firstUse: !state.updated_at
                });
            });
        });
    });
});

router.post("/notifications/read-all", requireAdmin, (req, res) => {
    const userId = req.session.user.id;

    ensureNotificationReadTable((createErr) => {
        if (createErr) {
            console.error("CREATE DASHBOARD NOTIFICATION READ TABLE ERROR:", createErr);
            return res.status(500).json({ message: createErr.sqlMessage || createErr.message });
        }

        const sql = `
            INSERT INTO dashboard_notification_reads (
                user_id,
                last_remit_id,
                last_expense_id,
                last_customer_id,
                last_payment_id,
                last_inventory_id,
                last_collector_id,
                last_cash_advance_id
            )
            SELECT
                ?,
                (SELECT COALESCE(MAX(id), 0) FROM remits),
                (SELECT COALESCE(MAX(id), 0) FROM expenses),
                (SELECT COALESCE(MAX(id), 0) FROM customers),
                (SELECT COALESCE(MAX(id), 0) FROM payments),
                (SELECT COALESCE(MAX(id), 0) FROM inventory),
                (SELECT COALESCE(MAX(id), 0) FROM collectors),
                (SELECT COALESCE(MAX(id), 0) FROM collector_cash_advances)
            ON DUPLICATE KEY UPDATE
                last_remit_id = VALUES(last_remit_id),
                last_expense_id = VALUES(last_expense_id),
                last_customer_id = VALUES(last_customer_id),
                last_payment_id = VALUES(last_payment_id),
                last_inventory_id = VALUES(last_inventory_id),
                last_collector_id = VALUES(last_collector_id),
                last_cash_advance_id = VALUES(last_cash_advance_id),
                updated_at = CURRENT_TIMESTAMP
        `;

        db.query(sql, [userId], (err) => {
            if (err) {
                console.error("DASHBOARD READ ALL ERROR:", err);
                return res.status(500).json({ message: err.sqlMessage || err.message });
            }

            res.json({ message: "Dashboard notifications marked as read" });
        });
    });
});

module.exports = router;
