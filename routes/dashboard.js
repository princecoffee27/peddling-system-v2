const express = require("express");
const router = express.Router();
const db = require("../database/db");

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

module.exports = router;