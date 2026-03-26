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

// Search payments for remit page with pagination
router.get("/search", (req, res) => {
    const {
        customer_id_from,
        customer_id_to,
        payment_date_from,
        payment_date_to,
        collector_id,
        page = 1,
        limit = 25
    } = req.query;

    const currentPage = parseInt(page, 10) || 1;
    const requestedLimit = parseInt(limit, 10) || 25;
    const safeLimit = [25, 50].includes(requestedLimit) ? requestedLimit : 25;
    const offset = (currentPage - 1) * safeLimit;

    let fromSql = `
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
        fromSql += ` AND customers.id >= ? `;
        params.push(customer_id_from);
    }

    if (customer_id_to) {
        fromSql += ` AND customers.id <= ? `;
        params.push(customer_id_to);
    }

    if (payment_date_from) {
        fromSql += ` AND payments.payment_date >= ? `;
        params.push(payment_date_from);
    }

    if (payment_date_to) {
        fromSql += ` AND payments.payment_date <= ? `;
        params.push(payment_date_to);
    }

    if (collector_id) {
        fromSql += ` AND customers.collector_id = ? `;
        params.push(collector_id);
    }

    const countSql = `
        SELECT COUNT(*) AS total
        ${fromSql}
    `;

    const dataSql = `
        SELECT
            payments.id AS payment_id,
            customers.id AS customer_id,
            customers.name AS customer_name,
            collectors.id AS collector_id,
            collectors.name AS collector_name,
            collectors.commission_percent,
            payments.amount,
            DATE_FORMAT(payments.payment_date, '%Y-%m-%d') AS payment_date
        ${fromSql}
        ORDER BY payments.payment_date ASC, customers.id ASC, payments.id ASC
        LIMIT ? OFFSET ?
    `;

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.log("COUNT REMIT PAYMENTS ERROR:", countErr);
            return res.status(500).json({
                message: countErr.sqlMessage || countErr.message
            });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = total > 0 ? Math.ceil(total / safeLimit) : 0;

        db.query(dataSql, [...params, safeLimit, offset], (err, result) => {
            if (err) {
                console.log("SEARCH REMIT PAYMENTS ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            res.json({
                rows: result,
                pagination: {
                    page: currentPage,
                    limit: safeLimit,
                    total,
                    totalPages
                }
            });
        });
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

    // NEW FORMULA
    const grossTotal = totalSelectedPayments - (gasValue + foodValue + miscValue);
    const commissionAmount = grossTotal * (commissionPercentValue / 100);
    const netTotal = cashOnHandValue - commissionAmount;
    const varianceAmount = cashOnHandValue - grossTotal;

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

// Load remit history with pagination
router.get("/", (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const requestedLimit = parseInt(req.query.limit, 10) || 25;
    const safeLimit = [25, 50, 100].includes(requestedLimit) ? requestedLimit : 25;
    const offset = (page - 1) * safeLimit;

    const countSql = `
        SELECT COUNT(*) AS total
        FROM remits
    `;

    const dataSql = `
        SELECT
            remits.id,
            remits.collector_id,
            collectors.name AS collector_name,
            DATE_FORMAT(remits.remit_date, '%Y-%m-%d') AS remit_date,
            DATE_FORMAT(remits.payment_date_from, '%Y-%m-%d') AS payment_date_from,
            DATE_FORMAT(remits.payment_date_to, '%Y-%m-%d') AS payment_date_to,
            remits.customer_id_from,
            remits.customer_id_to,
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
        LIMIT ? OFFSET ?
    `;

    db.query(countSql, (countErr, countResult) => {
        if (countErr) {
            console.log("COUNT REMITS ERROR:", countErr);
            return res.status(500).json({
                message: countErr.sqlMessage || countErr.message
            });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = total > 0 ? Math.ceil(total / safeLimit) : 0;

        db.query(dataSql, [safeLimit, offset], (err, result) => {
            if (err) {
                console.log("LOAD REMITS ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            res.json({
                rows: result,
                pagination: {
                    page,
                    limit: safeLimit,
                    total,
                    totalPages
                }
            });
        });
    });
});

// Safe delete remit
router.delete("/:remitId", (req, res) => {
    const remitId = req.params.remitId;

    db.beginTransaction((txErr) => {
        if (txErr) {
            console.log("DELETE REMIT TRANSACTION ERROR:", txErr);
            return res.status(500).json({
                message: txErr.sqlMessage || txErr.message
            });
        }

        const deleteItemsSql = `
            DELETE FROM remit_items
            WHERE remit_id = ?
        `;

        db.query(deleteItemsSql, [remitId], (deleteItemsErr) => {
            if (deleteItemsErr) {
                return db.rollback(() => {
                    console.log("DELETE REMIT ITEMS ERROR:", deleteItemsErr);
                    res.status(500).json({
                        message: deleteItemsErr.sqlMessage || deleteItemsErr.message
                    });
                });
            }

            const deleteRemitSql = `
                DELETE FROM remits
                WHERE id = ?
            `;

            db.query(deleteRemitSql, [remitId], (deleteRemitErr, deleteRemitResult) => {
                if (deleteRemitErr) {
                    return db.rollback(() => {
                        console.log("DELETE REMIT ERROR:", deleteRemitErr);
                        res.status(500).json({
                            message: deleteRemitErr.sqlMessage || deleteRemitErr.message
                        });
                    });
                }

                if (deleteRemitResult.affectedRows === 0) {
                    return db.rollback(() => {
                        res.status(404).json({
                            message: "Remit not found"
                        });
                    });
                }

                db.commit((commitErr) => {
                    if (commitErr) {
                        return db.rollback(() => {
                            console.log("DELETE REMIT COMMIT ERROR:", commitErr);
                            res.status(500).json({
                                message: commitErr.sqlMessage || commitErr.message
                            });
                        });
                    }

                    res.json({
                        message: "Remit deleted successfully. Payments are available again for remit."
                    });
                });
            });
        });
    });
});

// Reopen remit for editing
router.post("/:remitId/reopen-edit", (req, res) => {
    const remitId = req.params.remitId;

    db.beginTransaction((txErr) => {
        if (txErr) {
            console.log("REOPEN REMIT TRANSACTION ERROR:", txErr);
            return res.status(500).json({
                message: txErr.sqlMessage || txErr.message
            });
        }

        const getRemitSql = `
            SELECT
                id,
                collector_id,
                DATE_FORMAT(remit_date, '%Y-%m-%d') AS remit_date,
                DATE_FORMAT(payment_date_from, '%Y-%m-%d') AS payment_date_from,
                DATE_FORMAT(payment_date_to, '%Y-%m-%d') AS payment_date_to,
                customer_id_from,
                customer_id_to,
                gas,
                food,
                miscellaneous,
                commission_percent,
                cash_on_hand,
                notes
            FROM remits
            WHERE id = ?
        `;

        db.query(getRemitSql, [remitId], (getRemitErr, remitRows) => {
            if (getRemitErr) {
                return db.rollback(() => {
                    console.log("GET REMIT FOR REOPEN ERROR:", getRemitErr);
                    res.status(500).json({
                        message: getRemitErr.sqlMessage || getRemitErr.message
                    });
                });
            }

            if (remitRows.length === 0) {
                return db.rollback(() => {
                    res.status(404).json({
                        message: "Remit not found"
                    });
                });
            }

            const remit = remitRows[0];

            const getItemsSql = `
                SELECT
                    ri.payment_id,
                    ri.customer_id,
                    ri.customer_name,
                    ri.collector_id,
                    c.name AS collector_name,
                    ri.payment_amount AS amount,
                    DATE_FORMAT(ri.payment_date, '%Y-%m-%d') AS payment_date
                FROM remit_items ri
                LEFT JOIN collectors c ON ri.collector_id = c.id
                WHERE ri.remit_id = ?
                ORDER BY ri.id ASC
            `;

            db.query(getItemsSql, [remitId], (getItemsErr, itemRows) => {
                if (getItemsErr) {
                    return db.rollback(() => {
                        console.log("GET REMIT ITEMS FOR REOPEN ERROR:", getItemsErr);
                        res.status(500).json({
                            message: getItemsErr.sqlMessage || getItemsErr.message
                        });
                    });
                }

                const deleteItemsSql = `
                    DELETE FROM remit_items
                    WHERE remit_id = ?
                `;

                db.query(deleteItemsSql, [remitId], (deleteItemsErr) => {
                    if (deleteItemsErr) {
                        return db.rollback(() => {
                            console.log("DELETE REMIT ITEMS FOR REOPEN ERROR:", deleteItemsErr);
                            res.status(500).json({
                                message: deleteItemsErr.sqlMessage || deleteItemsErr.message
                            });
                        });
                    }

                    const deleteRemitSql = `
                        DELETE FROM remits
                        WHERE id = ?
                    `;

                    db.query(deleteRemitSql, [remitId], (deleteRemitErr) => {
                        if (deleteRemitErr) {
                            return db.rollback(() => {
                                console.log("DELETE REMIT FOR REOPEN ERROR:", deleteRemitErr);
                                res.status(500).json({
                                    message: deleteRemitErr.sqlMessage || deleteRemitErr.message
                                });
                            });
                        }

                        db.commit((commitErr) => {
                            if (commitErr) {
                                return db.rollback(() => {
                                    console.log("REOPEN REMIT COMMIT ERROR:", commitErr);
                                    res.status(500).json({
                                        message: commitErr.sqlMessage || commitErr.message
                                    });
                                });
                            }

                            res.json({
                                message: "Remit reopened for editing",
                                remit,
                                items: itemRows
                            });
                        });
                    });
                });
            });
        });
    });
});

module.exports = router;