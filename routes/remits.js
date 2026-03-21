const express = require("express");
const router = express.Router();
const db = require("../database/db");

// Load collectors
router.get("/collectors", (req, res) => {
    const sql = `
        SELECT id, name, commission_percent
        FROM collectors
        ORDER BY name ASC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log("LOAD REMIT COLLECTORS ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

// Search payments for remit page
router.get("/search", (req, res) => {
    const {
        customer_id_from,
        customer_id_to,
        payment_date_from,
        payment_date_to,
        collector_id
    } = req.query;

    let sql = `
        SELECT
            payments.id AS payment_id,
            customers.id AS customer_id,
            customers.name AS customer_name,
            collectors.id AS collector_id,
            collectors.name AS collector_name,
            collectors.commission_percent,
            payments.amount,
            DATE_FORMAT(payments.payment_date, '%Y-%m-%d') AS payment_date
        FROM payments
        JOIN sales ON payments.sale_id = sales.id
        JOIN customers ON sales.customer_id = customers.id
        LEFT JOIN collectors ON customers.collector_id = collectors.id
        WHERE payments.id NOT IN (
            SELECT payment_id FROM remit_items
        )
    `;

    const params = [];

    if (customer_id_from) {
        sql += ` AND customers.id >= ? `;
        params.push(customer_id_from);
    }

    if (customer_id_to) {
        sql += ` AND customers.id <= ? `;
        params.push(customer_id_to);
    }

    if (payment_date_from) {
        sql += ` AND payments.payment_date >= ? `;
        params.push(payment_date_from);
    }

    if (payment_date_to) {
        sql += ` AND payments.payment_date <= ? `;
        params.push(payment_date_to);
    }

    if (collector_id) {
        sql += ` AND customers.collector_id = ? `;
        params.push(collector_id);
    }

    sql += ` ORDER BY payments.payment_date ASC, customers.id ASC `;

    db.query(sql, params, (err, result) => {
        if (err) {
            console.log("SEARCH REMIT PAYMENTS ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

// Save remit
router.post("/", (req, res) => {
    const {
        collector_id,
        remit_date,
        payment_date_from,
        payment_date_to,
        customer_id_from,
        customer_id_to,
        selected_items,
        gas,
        food,
        miscellaneous,
        commission_percent,
        cash_on_hand,
        notes
    } = req.body;

    if (!collector_id || !remit_date || !selected_items || selected_items.length === 0) {
        return res.status(400).json({
            message: "Please select collector, remit date, and at least one payment"
        });
    }

    const gasValue = Number(gas) || 0;
    const foodValue = Number(food) || 0;
    const miscValue = Number(miscellaneous) || 0;
    const commissionPercentValue = Number(commission_percent) || 0;
    const cashOnHandValue = Number(cash_on_hand) || 0;

    const totalSelectedPayments = selected_items.reduce((sum, item) => {
        return sum + (Number(item.amount) || 0);
    }, 0);

    const totalExpenses = gasValue + foodValue + miscValue;
    const commissionAmount = (totalSelectedPayments - totalExpenses) * (commissionPercentValue / 100);
    const grossTotal = totalSelectedPayments - commissionAmount;
    const netTotal = cashOnHandValue - commissionAmount;
    const varianceAmount = grossTotal - netTotal;

    db.beginTransaction((err) => {
        if (err) {
            console.log("REMIT TRANSACTION ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        const insertRemitSql = `
            INSERT INTO remits (
                collector_id,
                remit_date,
                payment_date_from,
                payment_date_to,
                customer_id_from,
                customer_id_to,
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
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(
            insertRemitSql,
            [
                collector_id,
                remit_date,
                payment_date_from || null,
                payment_date_to || null,
                customer_id_from || null,
                customer_id_to || null,
                totalSelectedPayments,
                gasValue,
                foodValue,
                miscValue,
                commissionPercentValue,
                commissionAmount,
                grossTotal,
                cashOnHandValue,
                netTotal,
                varianceAmount,
                notes || null
            ],
            (err, remitResult) => {
                if (err) {
                    return db.rollback(() => {
                        console.log("INSERT REMIT ERROR:", err);
                        res.status(500).json({
                            message: err.sqlMessage || err.message
                        });
                    });
                }

                const remitId = remitResult.insertId;

                const remitItemsValues = selected_items.map(item => [
                    remitId,
                    item.payment_id,
                    item.customer_id,
                    item.customer_name,
                    item.collector_id,
                    item.amount,
                    item.payment_date
                ]);

                const insertRemitItemsSql = `
                    INSERT INTO remit_items (
                        remit_id,
                        payment_id,
                        customer_id,
                        customer_name,
                        collector_id,
                        payment_amount,
                        payment_date
                    )
                    VALUES ?
                `;

                db.query(insertRemitItemsSql, [remitItemsValues], (err) => {
                    if (err) {
                        return db.rollback(() => {
                            console.log("INSERT REMIT ITEMS ERROR:", err);
                            res.status(500).json({
                                message: err.sqlMessage || err.message
                            });
                        });
                    }

                    db.commit((err) => {
                        if (err) {
                            return db.rollback(() => {
                                console.log("REMIT COMMIT ERROR:", err);
                                res.status(500).json({
                                    message: err.sqlMessage || err.message
                                });
                            });
                        }

                        res.json({
                            message: "Remit saved successfully",
                            total_selected_payments: totalSelectedPayments,
                            commission_amount: commissionAmount,
                            gross_total: grossTotal,
                            net_total: netTotal,
                            variance_amount: varianceAmount
                        });
                    });
                });
            }
        );
    });
});

// Load remit history
router.get("/", (req, res) => {
    const sql = `
        SELECT
            remits.id,
            remits.collector_id,
            collectors.name AS collector_name,
            DATE_FORMAT(remits.remit_date, '%Y-%m-%d') AS remit_date,
            remits.total_selected_payments,
            remits.gas,
            remits.food,
            remits.miscellaneous,
            remits.commission_percent,
            remits.commission_amount,
            remits.gross_total,
            remits.cash_on_hand,
            remits.net_total,
            remits.variance_amount,
            remits.notes
        FROM remits
        JOIN collectors ON remits.collector_id = collectors.id
        ORDER BY remits.id DESC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log("LOAD REMITS ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

module.exports = router;