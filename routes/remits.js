const express = require("express");
const router = express.Router();
const db = require("../database/db");

function round2(value) {
    return Number((Number(value) || 0).toFixed(2));
}

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
        negative_deduction,
        cash_advance_deduction,
        final_commission_paid,
        notes
    } = req.body;

    if (!collector_id || !remit_date || !selected_items || selected_items.length === 0) {
        return res.status(400).json({
            message: "Please select collector, remit date, and at least one payment"
        });
    }

    const gasValue = round2(gas);
    const foodValue = round2(food);
    const miscValue = round2(miscellaneous);
    const commissionPercentValue = round2(commission_percent);
    const cashOnHandValue = round2(cash_on_hand);
    const negativeDeductionValue = round2(negative_deduction);
    const cashAdvanceDeductionValue = round2(cash_advance_deduction);

    const totalSelectedPayments = round2(
        selected_items.reduce((sum, item) => {
            return sum + (Number(item.amount) || 0);
        }, 0)
    );

    const totalExpenses = round2(gasValue + foodValue + miscValue);
    const grossTotal = round2(totalSelectedPayments - totalExpenses);
    const commissionAmount = round2(grossTotal * (commissionPercentValue / 100));
    const computedFinalCommissionPaid = round2(
        Math.max(0, commissionAmount - negativeDeductionValue - cashAdvanceDeductionValue)
    );

    const finalCommissionPaid = round2(
        final_commission_paid === undefined || final_commission_paid === null || final_commission_paid === ""
            ? computedFinalCommissionPaid
            : final_commission_paid
    );

    const netTotal = round2(cashOnHandValue - finalCommissionPaid);
    const varianceAmount = round2(cashOnHandValue - grossTotal);

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
                negative_deduction,
                cash_advance_deduction,
                final_commission_paid,
                gross_total,
                cash_on_hand,
                net_total,
                variance_amount,
                notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                negativeDeductionValue,
                cashAdvanceDeductionValue,
                finalCommissionPaid,
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
                    round2(item.amount),
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

                    const verifySql = `
                        SELECT IFNULL(SUM(payment_amount), 0) AS detail_total
                        FROM remit_items
                        WHERE remit_id = ?
                    `;

                    db.query(verifySql, [remitId], (verifyErr, verifyRows) => {
                        if (verifyErr) {
                            return db.rollback(() => {
                                console.log("VERIFY REMIT ITEMS ERROR:", verifyErr);
                                res.status(500).json({
                                    message: verifyErr.sqlMessage || verifyErr.message
                                });
                            });
                        }

                        const detailTotal = round2(verifyRows[0]?.detail_total || 0);

                        if (detailTotal !== totalSelectedPayments) {
                            return db.rollback(() => {
                                console.log("REMIT TOTAL MISMATCH ON SAVE", {
                                    remitId,
                                    totalSelectedPayments,
                                    detailTotal
                                });
                                res.status(500).json({
                                    message: `Remit not saved because detail total (${detailTotal.toFixed(2)}) does not match summary total (${totalSelectedPayments.toFixed(2)}).`
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
                                negative_deduction: negativeDeductionValue,
                                final_commission_paid: finalCommissionPaid,
                                gross_total: grossTotal,
                                net_total: netTotal,
                                variance_amount: varianceAmount
                            });
                        });
                    });
                });
            }
        );
    });
});

// Load remit history with pagination, collector filter, and filtered totals
router.get("/", (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const requestedLimit = parseInt(req.query.limit, 10) || 25;
    const safeLimit = [25, 50, 100].includes(requestedLimit) ? requestedLimit : 25;
    const offset = (page - 1) * safeLimit;
    const collectorId = req.query.collector_id;

    let whereSql = "";
    const params = [];

    if (collectorId) {
        whereSql = " WHERE remits.collector_id = ? ";
        params.push(collectorId);
    }

    const countSql = `
        SELECT COUNT(*) AS total
        FROM remits
        ${whereSql}
    `;

    const totalsSql = `
        SELECT
            IFNULL(SUM(remits.total_selected_payments), 0) AS total_selected_payments,
            IFNULL(SUM(remits.gas), 0) AS gas,
            IFNULL(SUM(remits.food), 0) AS food,
            IFNULL(SUM(remits.miscellaneous), 0) AS miscellaneous,
            IFNULL(SUM(remits.gas + remits.food + remits.miscellaneous), 0) AS total_expenses,
            IFNULL(SUM(remits.commission_amount), 0) AS commission_amount,
            IFNULL(SUM(remits.negative_deduction), 0) AS negative_deduction,
            IFNULL(SUM(remits.cash_advance_deduction), 0) AS cash_advance_deduction,
            IFNULL(SUM(remits.final_commission_paid), 0) AS final_commission_paid,
            IFNULL(SUM(remits.gross_total), 0) AS gross_total,
            IFNULL(SUM(remits.cash_on_hand), 0) AS cash_on_hand,
            IFNULL(SUM(remits.net_total), 0) AS net_total,
            IFNULL(SUM(remits.variance_amount), 0) AS variance_amount
        FROM remits
        ${whereSql}
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
            remits.negative_deduction,
            remits.cash_advance_deduction,
            remits.final_commission_paid,
            remits.gross_total,
            remits.cash_on_hand,
            remits.net_total,
            remits.variance_amount,
            remits.notes,
            EXISTS (
                SELECT 1
                FROM collector_negatives cn
                WHERE cn.source_type = 'remit_shortage'
                AND cn.source_remit_id = remits.id
                AND cn.remarks LIKE '%[DEDUCT_WAIVED]%'
            ) AS negative_deduction_waived
        FROM remits
        JOIN collectors ON remits.collector_id = collectors.id
        ${whereSql}
        ORDER BY remits.id DESC
        LIMIT ? OFFSET ?
    `;

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.log("COUNT REMITS ERROR:", countErr);
            return res.status(500).json({
                message: countErr.sqlMessage || countErr.message
            });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = total > 0 ? Math.ceil(total / safeLimit) : 0;

        db.query(totalsSql, params, (totalsErr, totalsResult) => {
            if (totalsErr) {
                console.log("TOTAL REMITS ERROR:", totalsErr);
                return res.status(500).json({
                    message: totalsErr.sqlMessage || totalsErr.message
                });
            }

            db.query(dataSql, [...params, safeLimit, offset], (err, result) => {
                if (err) {
                    console.log("LOAD REMITS ERROR:", err);
                    return res.status(500).json({
                        message: err.sqlMessage || err.message
                    });
                }

                res.json({
                    rows: result,
                    totals: totalsResult[0] || {},
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

// Reopen remit for editing with mismatch check
router.post("/:remitId/reopen-edit", (req, res) => {
    const remitId = req.params.remitId;

    const getRemitSql = `
        SELECT
            id,
            collector_id,
            DATE_FORMAT(remit_date, '%Y-%m-%d') AS remit_date,
            DATE_FORMAT(payment_date_from, '%Y-%m-%d') AS payment_date_from,
            DATE_FORMAT(payment_date_to, '%Y-%m-%d') AS payment_date_to,
            customer_id_from,
            customer_id_to,
            total_selected_payments,
            gas,
            food,
            miscellaneous,
            commission_percent,
            negative_deduction,
            cash_advance_deduction,
            final_commission_paid,
            cash_on_hand,
            notes
        FROM remits
        WHERE id = ?
    `;

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

    db.query(getRemitSql, [remitId], (getRemitErr, remitRows) => {
        if (getRemitErr) {
            console.log("GET REMIT FOR REOPEN ERROR:", getRemitErr);
            return res.status(500).json({
                message: getRemitErr.sqlMessage || getRemitErr.message
            });
        }

        if (remitRows.length === 0) {
            return res.status(404).json({
                message: "Remit not found"
            });
        }

        const remit = remitRows[0];

        db.query(getItemsSql, [remitId], (getItemsErr, itemRows) => {
            if (getItemsErr) {
                console.log("GET REMIT ITEMS FOR REOPEN ERROR:", getItemsErr);
                return res.status(500).json({
                    message: getItemsErr.sqlMessage || getItemsErr.message
                });
            }

            const savedTotal = round2(remit.total_selected_payments);
            const detailTotal = round2(
                itemRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
            );

            if (savedTotal !== detailTotal) {
                return res.status(409).json({
                    message: "Mismatch detected. Edit cancelled for safety.",
                    mismatch: true,
                    saved_total: savedTotal,
                    detail_total: detailTotal,
                    difference: round2(savedTotal - detailTotal)
                });
            }

            db.beginTransaction((txErr) => {
                if (txErr) {
                    console.log("REOPEN REMIT TRANSACTION ERROR:", txErr);
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

// ================= DEDUCT NEGATIVE =================
router.post("/:remitId/deduct-negative", (req, res) => {
    const remitId = req.params.remitId;

    const sql = `
        SELECT commission_amount, variance_amount, cash_on_hand
        FROM remits
        WHERE id = ?
    `;

    db.query(sql, [remitId], (err, rows) => {
        if (err) return res.status(500).json({ message: err.message });
        if (rows.length === 0) return res.status(404).json({ message: "Remit not found" });

        const r = rows[0];

        if (Number(r.variance_amount) >= 0) {
            return res.status(400).json({ message: "No negative to deduct" });
        }

        const deduction = Math.abs(Number(r.variance_amount));
        const finalCommission = Math.max(0, Number(r.commission_amount) - deduction);
        const netTotal = Number(r.cash_on_hand) - finalCommission;

        const updateSql = `
            UPDATE remits
            SET
                negative_deduction = ?,
                final_commission_paid = ?,
                net_total = ?
            WHERE id = ?
        `;

        db.query(updateSql, [deduction, finalCommission, netTotal, remitId], (err) => {
            if (err) return res.status(500).json({ message: err.message });

            res.json({ message: "Deduction applied successfully" });
        });
    });
});

// ================= WAIVE NEGATIVE DEDUCTION BUTTON =================
router.post("/:remitId/waive-negative-deduction", (req, res) => {
    const remitId = req.params.remitId;

    const getRemitSql = `
        SELECT id, collector_id, remit_date, variance_amount
        FROM remits
        WHERE id = ?
    `;

    db.query(getRemitSql, [remitId], (err, rows) => {
        if (err) return res.status(500).json({ message: err.sqlMessage || err.message });

        if (rows.length === 0) {
            return res.status(404).json({ message: "Remit not found" });
        }

        const remit = rows[0];

        if (Number(remit.variance_amount) >= 0) {
            return res.status(400).json({ message: "No negative to waive" });
        }

        const updateSql = `
            UPDATE collector_negatives
            SET remarks = CONCAT(IFNULL(remarks, ''), ' [DEDUCT_WAIVED]')
            WHERE source_type = 'remit_shortage'
            AND source_remit_id = ?
        `;

        db.query(updateSql, [remitId], (updateErr, updateResult) => {
            if (updateErr) {
                return res.status(500).json({ message: updateErr.sqlMessage || updateErr.message });
            }

            if (updateResult.affectedRows > 0) {
                return res.json({
                    message: "Deduct button waived. Negative will remain in Collector Payables for manual recording."
                });
            }

            const insertSql = `
                INSERT INTO collector_negatives (
                    collector_id,
                    negative_date,
                    amount,
                    remaining_amount,
                    source_type,
                    source_remit_id,
                    status,
                    remarks
                )
                VALUES (?, ?, ?, ?, 'remit_shortage', ?, 'open', ?)
            `;

            const amount = Math.abs(Number(remit.variance_amount));

            db.query(
                insertSql,
                [
                    remit.collector_id,
                    remit.remit_date,
                    amount,
                    amount,
                    remitId,
                    `Auto negative from remit #${remitId} [DEDUCT_WAIVED]`
                ],
                (insertErr) => {
                    if (insertErr) {
                        return res.status(500).json({ message: insertErr.sqlMessage || insertErr.message });
                    }

                    res.json({
                        message: "Deduct button waived. Negative will remain in Collector Payables for manual recording."
                    });
                }
            );
        });
    });
});

module.exports = router;