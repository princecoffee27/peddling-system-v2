const express = require("express");
const router = express.Router();
const db = require("../database/db");

// Load active collectors for report dropdown
router.get("/collectors", (req, res) => {
    const sql = `
        SELECT id, name, commission_percent
        FROM collectors
        WHERE is_active = 1 OR is_active IS NULL
        ORDER BY name ASC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log("LOAD REPORT COLLECTORS ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

// Main collector report
router.get("/", (req, res) => {
    const { collector_id, date_from, date_to } = req.query;

    if (!collector_id || !date_from || !date_to) {
        return res.status(400).json({
            message: "Please select collector, date from, and date to"
        });
    }

    const collectorSql = `
        SELECT id, name, commission_percent
        FROM collectors
        WHERE id = ?
        LIMIT 1
    `;

    db.query(collectorSql, [collector_id], (err, collectorResult) => {
        if (err) {
            console.log("LOAD SINGLE COLLECTOR ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        if (collectorResult.length === 0) {
            return res.status(404).json({
                message: "Collector not found"
            });
        }

        const collector = collectorResult[0];

        const paymentsSql = `
            SELECT
                payments.id AS payment_id,
                customers.id AS customer_id,
                customers.name AS customer_name,
                payments.amount,
                DATE_FORMAT(payments.payment_date, '%Y-%m-%d') AS payment_date,
                payments.payment_type
            FROM payments
            JOIN sales ON payments.sale_id = sales.id
            JOIN customers ON sales.customer_id = customers.id
            WHERE customers.collector_id = ?
              AND DATE(payments.payment_date) BETWEEN ? AND ?
            ORDER BY payments.payment_date ASC, payments.id ASC
        `;

        db.query(paymentsSql, [collector_id, date_from, date_to], (err, paymentsResult) => {
            if (err) {
                console.log("LOAD PAYMENTS REPORT ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            const balancesSql = `
                SELECT
                    sales.id AS sale_id,
                    customers.id AS customer_id,
                    customers.name AS customer_name,
                    inventory.item_name,
                    sales.quantity,
                    sales.balance,
                    collectors.name AS collector_name
                FROM sales
                JOIN customers ON sales.customer_id = customers.id
                JOIN inventory ON sales.item_id = inventory.id
                LEFT JOIN collectors ON customers.collector_id = collectors.id
                WHERE customers.collector_id = ?
                ORDER BY customers.id ASC, sales.id DESC
            `;

            db.query(balancesSql, [collector_id], (err, balancesResult) => {
                if (err) {
                    console.log("LOAD BALANCES REPORT ERROR:", err);
                    return res.status(500).json({
                        message: err.sqlMessage || err.message
                    });
                }

                const capitalSql = `
                    SELECT
                        sales.id AS sale_id,
                        customers.id AS customer_id,
                        customers.name AS customer_name,
                        inventory.item_name,
                        sales.quantity,
                        inventory.capital_price,
                        (inventory.capital_price * sales.quantity) AS capital_total
                    FROM sales
                    JOIN customers ON sales.customer_id = customers.id
                    JOIN inventory ON sales.item_id = inventory.id
                    WHERE customers.collector_id = ?
                    ORDER BY customers.id ASC, sales.id DESC
                `;

                db.query(capitalSql, [collector_id], (err, capitalResult) => {
                    if (err) {
                        console.log("LOAD CAPITAL REPORT ERROR:", err);
                        return res.status(500).json({
                            message: err.sqlMessage || err.message
                        });
                    }

                    const expensesSql = `
                        SELECT
                            id,
                            DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date,
                            driver_daily_wage,
                            staffs_food_allowance,
                            gasoline,
                            miscellaneous,
                            total_expense,
                            route,
                            expense_type,
                            notes
                        FROM expenses
                        WHERE collector_id = ?
                          AND expense_date BETWEEN ? AND ?
                        ORDER BY expense_date ASC, id ASC
                    `;

                    db.query(expensesSql, [collector_id, date_from, date_to], (err, expensesResult) => {
                        if (err) {
                            console.log("LOAD EXPENSES REPORT ERROR:", err);
                            return res.status(500).json({
                                message: err.sqlMessage || err.message
                            });
                        }

                        const remitsSql = `
                            SELECT
                                id,
                                DATE_FORMAT(remit_date, '%Y-%m-%d') AS remit_date,
                                total_selected_payments,
                                gas,
                                food,
                                miscellaneous,
                                commission_percent,
                                commission_amount,
                                gross_total,
                                cash_on_hand,
                                net_total,
                                variance_amount,
                                notes
                            FROM remits
                            WHERE collector_id = ?
                              AND remit_date BETWEEN ? AND ?
                            ORDER BY remit_date ASC, id ASC
                        `;

                        db.query(remitsSql, [collector_id, date_from, date_to], (err, remitsResult) => {
                            if (err) {
                                console.log("LOAD REMITS REPORT ERROR:", err);
                                return res.status(500).json({
                                    message: err.sqlMessage || err.message
                                });
                            }

                            const totalPaymentsCollected = paymentsResult.reduce((sum, row) => {
                                return sum + (Number(row.amount) || 0);
                            }, 0);

                            const totalRemainingBalance = balancesResult.reduce((sum, row) => {
                                return sum + (Number(row.balance) || 0);
                            }, 0);

                            const totalItemCapital = capitalResult.reduce((sum, row) => {
                                return sum + (Number(row.capital_total) || 0);
                            }, 0);

                            const totalExpenses = expensesResult.reduce((sum, row) => {
                                return sum + (Number(row.total_expense) || 0);
                            }, 0);

                            const totalCashOnHand = remitsResult.reduce((sum, row) => {
                                return sum + (Number(row.cash_on_hand) || 0);
                            }, 0);

                            const totalVariance = remitsResult.reduce((sum, row) => {
                                return sum + (Number(row.variance_amount) || 0);
                            }, 0);

                            const businessResultAmount = totalPaymentsCollected - totalItemCapital - totalExpenses;

                            let businessResultLabel = "Break-even";
                            if (businessResultAmount > 0) businessResultLabel = "Positive";
                            if (businessResultAmount < 0) businessResultLabel = "Negative";

                            let collectorResultLabel = "Good";
                            if (totalVariance < 0) collectorResultLabel = "Bad / Short";
                            if (totalVariance > 0) collectorResultLabel = "Good (Excess)";

                            res.json({
                                filters: {
                                    collector_id,
                                    collector_name: collector.name,
                                    commission_percent: collector.commission_percent,
                                    date_from,
                                    date_to
                                },
                                summary: {
                                    total_payments_collected: totalPaymentsCollected,
                                    total_remaining_balance: totalRemainingBalance,
                                    total_item_capital: totalItemCapital,
                                    total_expenses: totalExpenses,
                                    total_cash_on_hand: totalCashOnHand,
                                    business_result_amount: businessResultAmount,
                                    business_result_label: businessResultLabel,
                                    collector_result_amount: totalVariance,
                                    collector_result_label: collectorResultLabel
                                },
                                details: {
                                    payments: paymentsResult,
                                    balances: balancesResult,
                                    capital: capitalResult,
                                    expenses: expensesResult,
                                    remits: remitsResult
                                }
                            });
                        });
                    });
                });
            });
        });
    });
});

module.exports = router;