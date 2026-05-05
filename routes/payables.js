const express = require("express");
const router = express.Router();
const db = require("../database/db");

function round2(value) {
    return Number((Number(value) || 0).toFixed(2));
}

function getPagination(query) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const requestedLimit = parseInt(query.limit, 10) || 25;
    const limit = Math.min(100, Math.max(1, requestedLimit));
    const offset = (page - 1) * limit;

    return { page, limit, offset };
}

function sendPagedQuery(res, options) {
    const { countSql, dataSql, params, page, limit, offset, logLabel } = options;

    db.query(countSql, params, (countErr, countRows) => {
        if (countErr) {
            console.log(`${logLabel} COUNT ERROR:`, countErr);
            return res.status(500).json({ message: countErr.sqlMessage || countErr.message });
        }

        const total = countRows[0]?.total || 0;
        const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

        db.query(dataSql, [...params, limit, offset], (dataErr, rows) => {
            if (dataErr) {
                console.log(`${logLabel} DATA ERROR:`, dataErr);
                return res.status(500).json({ message: dataErr.sqlMessage || dataErr.message });
            }

            res.json({
                rows,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages
                }
            });
        });
    });
}

// ======================================================
// A. COLLECTOR PAYABLE SUMMARY
// GET /payables/summary?collector_id=&page=1&limit=25
// ======================================================
router.get("/summary", (req, res) => {
    const { collector_id } = req.query;
    const { page, limit, offset } = getPagination(req.query);

    let whereSql = `WHERE (c.is_active = 1 OR c.is_active IS NULL)`;
    const params = [];

    if (collector_id) {
        whereSql += ` AND c.id = ? `;
        params.push(collector_id);
    }

    const countSql = `
        SELECT COUNT(*) AS total
        FROM collectors c
        ${whereSql}
    `;

    const dataSql = `
        SELECT
            c.id AS collector_id,
            c.name AS collector_name,
            c.commission_percent,
            IFNULL(n.total_open_negatives, 0) AS total_open_negatives,
            IFNULL(a.total_open_advances, 0) AS total_open_advances,
            (IFNULL(n.total_open_negatives, 0) + IFNULL(a.total_open_advances, 0)) AS total_payable
        FROM collectors c
        LEFT JOIN (
            SELECT collector_id, SUM(remaining_amount) AS total_open_negatives
            FROM collector_negatives
            WHERE status IN ('open', 'partial')
            GROUP BY collector_id
        ) n ON c.id = n.collector_id
        LEFT JOIN (
            SELECT collector_id, SUM(remaining_amount) AS total_open_advances
            FROM collector_cash_advances
            WHERE status IN ('open', 'partial')
            GROUP BY collector_id
        ) a ON c.id = a.collector_id
        ${whereSql}
        ORDER BY c.name ASC
        LIMIT ? OFFSET ?
    `;

    const overallSql = `
        SELECT
            IFNULL(SUM(IFNULL(n.total_open_negatives, 0)), 0) AS total_open_negatives,
            IFNULL(SUM(IFNULL(a.total_open_advances, 0)), 0) AS total_open_advances,
            IFNULL(SUM(IFNULL(n.total_open_negatives, 0) + IFNULL(a.total_open_advances, 0)), 0) AS total_payable
        FROM collectors c
        LEFT JOIN (
            SELECT collector_id, SUM(remaining_amount) AS total_open_negatives
            FROM collector_negatives
            WHERE status IN ('open', 'partial')
            GROUP BY collector_id
        ) n ON c.id = n.collector_id
        LEFT JOIN (
            SELECT collector_id, SUM(remaining_amount) AS total_open_advances
            FROM collector_cash_advances
            WHERE status IN ('open', 'partial')
            GROUP BY collector_id
        ) a ON c.id = a.collector_id
        ${whereSql}
    `;

    db.query(countSql, params, (countErr, countRows) => {
        if (countErr) {
            console.log("PAYABLE SUMMARY COUNT ERROR:", countErr);
            return res.status(500).json({ message: countErr.sqlMessage || countErr.message });
        }

        const total = countRows[0]?.total || 0;
        const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

        db.query(dataSql, [...params, limit, offset], (dataErr, rows) => {
            if (dataErr) {
                console.log("PAYABLE SUMMARY DATA ERROR:", dataErr);
                return res.status(500).json({ message: dataErr.sqlMessage || dataErr.message });
            }

            db.query(overallSql, params, (overallErr, overallRows) => {
                if (overallErr) {
                    console.log("PAYABLE SUMMARY OVERALL ERROR:", overallErr);
                    return res.status(500).json({ message: overallErr.sqlMessage || overallErr.message });
                }

                res.json({
                    rows,
                    overall: overallRows[0] || {
                        total_open_negatives: 0,
                        total_open_advances: 0,
                        total_payable: 0
                    },
                    pagination: { page, limit, total, totalPages }
                });
            });
        });
    });
});

// ======================================================
// B. OPEN NEGATIVE LIST
// GET /payables/negatives?collector_id=&page=1&limit=25
// ======================================================
router.get("/negatives", (req, res) => {
    const { collector_id } = req.query;
    const { page, limit, offset } = getPagination(req.query);

    let fromSql = `
        FROM collector_negatives n
        JOIN collectors c ON n.collector_id = c.id
        WHERE n.status IN ('open', 'partial')
    `;

    const params = [];

    if (collector_id) {
        fromSql += ` AND n.collector_id = ? `;
        params.push(collector_id);
    }

    const countSql = `SELECT COUNT(*) AS total ${fromSql}`;

    const dataSql = `
        SELECT
            n.id,
            n.collector_id,
            c.name AS collector_name,
            DATE_FORMAT(n.negative_date, '%Y-%m-%d') AS negative_date,
            n.amount,
            n.remaining_amount,
            n.source_type,
            n.source_remit_id,
            n.remarks,
            n.status,
            DATE_FORMAT(n.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
        ${fromSql}
        ORDER BY n.negative_date DESC, n.id DESC
        LIMIT ? OFFSET ?
    `;

    sendPagedQuery(res, {
        countSql,
        dataSql,
        params,
        page,
        limit,
        offset,
        logLabel: "LOAD OPEN NEGATIVES"
    });
});

// ======================================================
// C. OPEN CASH ADVANCE LIST
// GET /payables/cash-advances?collector_id=&page=1&limit=25
// ======================================================
router.get("/cash-advances", (req, res) => {
    const { collector_id } = req.query;
    const { page, limit, offset } = getPagination(req.query);

    let fromSql = `
        FROM collector_cash_advances a
        JOIN collectors c ON a.collector_id = c.id
        WHERE a.status IN ('open', 'partial')
    `;

    const params = [];

    if (collector_id) {
        fromSql += ` AND a.collector_id = ? `;
        params.push(collector_id);
    }

    const countSql = `SELECT COUNT(*) AS total ${fromSql}`;

    const dataSql = `
        SELECT
            a.id,
            a.collector_id,
            c.name AS collector_name,
            DATE_FORMAT(a.advance_date, '%Y-%m-%d') AS advance_date,
            a.amount,
            a.remaining_amount,
            a.remarks,
            a.status,
            DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
        ${fromSql}
        ORDER BY a.advance_date DESC, a.id DESC
        LIMIT ? OFFSET ?
    `;

    sendPagedQuery(res, {
        countSql,
        dataSql,
        params,
        page,
        limit,
        offset,
        logLabel: "LOAD OPEN CASH ADVANCES"
    });
});

// ======================================================
// D1. CREATE NEGATIVE ENTRY MANUALLY
// POST /payables/negatives
// ======================================================
router.post("/negatives", (req, res) => {
    const {
        collector_id,
        negative_date,
        amount,
        source_type,
        source_remit_id,
        remarks
    } = req.body;

    if (!collector_id || !negative_date || !amount) {
        return res.status(400).json({
            message: "collector_id, negative_date, and amount are required"
        });
    }

    const amountValue = round2(amount);

    const sql = `
        INSERT INTO collector_negatives (
            collector_id,
            negative_date,
            amount,
            remaining_amount,
            source_type,
            source_remit_id,
            remarks,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'open')
    `;

    db.query(
        sql,
        [
            collector_id,
            negative_date,
            amountValue,
            amountValue,
            source_type || "manual_adjustment",
            source_remit_id || null,
            remarks || null
        ],
        (err, result) => {
            if (err) {
                console.log("CREATE NEGATIVE ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            res.json({
                message: "Negative created successfully",
                id: result.insertId
            });
        }
    );
});

// ======================================================
// D2. CREATE CASH ADVANCE ENTRY MANUALLY
// POST /payables/cash-advances
// ======================================================
router.post("/cash-advances", (req, res) => {
    const {
        collector_id,
        advance_date,
        amount,
        remarks
    } = req.body;

    if (!collector_id || !advance_date || !amount) {
        return res.status(400).json({
            message: "collector_id, advance_date, and amount are required"
        });
    }

    const amountValue = round2(amount);

    const sql = `
        INSERT INTO collector_cash_advances (
            collector_id,
            advance_date,
            amount,
            remaining_amount,
            remarks,
            status
        )
        VALUES (?, ?, ?, ?, ?, 'open')
    `;

    db.query(
        sql,
        [
            collector_id,
            advance_date,
            amountValue,
            amountValue,
            remarks || null
        ],
        (err, result) => {
            if (err) {
                console.log("CREATE CASH ADVANCE ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            res.json({
                message: "Cash advance created successfully",
                id: result.insertId
            });
        }
    );
});

// ======================================================
// D3. APPLY NEGATIVE DEDUCTION FROM REMIT
// POST /payables/apply-negative-deduction
// ======================================================
router.post("/apply-negative-deduction", (req, res) => {
    const { remit_id } = req.body;

    if (!remit_id) {
        return res.status(400).json({
            message: "remit_id is required"
        });
    }

    const getRemitSql = `
        SELECT
            id,
            collector_id,
            DATE_FORMAT(remit_date, '%Y-%m-%d') AS remit_date,
            commission_amount,
            negative_deduction,
            final_commission_paid,
            cash_on_hand,
            variance_amount
        FROM remits
        WHERE id = ?
    `;

    db.query(getRemitSql, [remit_id], (getErr, remitRows) => {
        if (getErr) {
            console.log("GET REMIT FOR NEGATIVE DEDUCTION ERROR:", getErr);
            return res.status(500).json({
                message: getErr.sqlMessage || getErr.message
            });
        }

        if (remitRows.length === 0) {
            return res.status(404).json({
                message: "Remit not found"
            });
        }

        const remit = remitRows[0];
        const collectorId = remit.collector_id;
        const remitDate = remit.remit_date;
        const varianceAmount = round2(remit.variance_amount);
        const existingNegativeDeduction = round2(remit.negative_deduction);

        if (varianceAmount >= 0) {
            return res.status(400).json({
                message: "This remit has no negative shortage to deduct"
            });
        }

        if (existingNegativeDeduction > 0) {
            return res.status(400).json({
                message: "Negative deduction has already been applied to this remit"
            });
        }

        const shortage = round2(Math.abs(varianceAmount));
        const commissionAmount = round2(remit.commission_amount);
        const finalCommissionPaid = round2(Math.max(0, commissionAmount - shortage));
        const netTotal = round2(remit.cash_on_hand - finalCommissionPaid);

        db.beginTransaction((txErr) => {
            if (txErr) {
                console.log("NEGATIVE DEDUCTION TRANSACTION ERROR:", txErr);
                return res.status(500).json({
                    message: txErr.sqlMessage || txErr.message
                });
            }

            const insertNegativeSql = `
                INSERT INTO collector_negatives (
                    collector_id,
                    negative_date,
                    amount,
                    remaining_amount,
                    source_type,
                    source_remit_id,
                    remarks,
                    status
                )
                VALUES (?, ?, ?, ?, 'remit_shortage', ?, ?, 'settled')
            `;

            db.query(
                insertNegativeSql,
                [
                    collectorId,
                    remitDate,
                    shortage,
                    0,
                    remit_id,
                    `Auto-created from remit shortage deduction`
                ],
                (insertNegativeErr, negativeResult) => {
                    if (insertNegativeErr) {
                        return db.rollback(() => {
                            console.log("INSERT COLLECTOR NEGATIVE ERROR:", insertNegativeErr);
                            res.status(500).json({
                                message: insertNegativeErr.sqlMessage || insertNegativeErr.message
                            });
                        });
                    }

                    const negativeId = negativeResult.insertId;

                    const insertDeductionSql = `
                        INSERT INTO remit_deductions (
                            remit_id,
                            collector_id,
                            deduction_type,
                            reference_id,
                            deducted_amount
                        )
                        VALUES (?, ?, 'negative', ?, ?)
                    `;

                    db.query(
                        insertDeductionSql,
                        [remit_id, collectorId, negativeId, shortage],
                        (insertDeductionErr) => {
                            if (insertDeductionErr) {
                                return db.rollback(() => {
                                    console.log("INSERT REMIT DEDUCTION ERROR:", insertDeductionErr);
                                    res.status(500).json({
                                        message: insertDeductionErr.sqlMessage || insertDeductionErr.message
                                    });
                                });
                            }

                            const updateRemitSql = `
                                UPDATE remits
                                SET
                                    negative_deduction = ?,
                                    final_commission_paid = ?,
                                    net_total = ?
                                WHERE id = ?
                            `;

                            db.query(
                                updateRemitSql,
                                [shortage, finalCommissionPaid, netTotal, remit_id],
                                (updateRemitErr) => {
                                    if (updateRemitErr) {
                                        return db.rollback(() => {
                                            console.log("UPDATE REMIT NEGATIVE DEDUCTION ERROR:", updateRemitErr);
                                            res.status(500).json({
                                                message: updateRemitErr.sqlMessage || updateRemitErr.message
                                            });
                                        });
                                    }

                                    db.commit((commitErr) => {
                                        if (commitErr) {
                                            return db.rollback(() => {
                                                console.log("NEGATIVE DEDUCTION COMMIT ERROR:", commitErr);
                                                res.status(500).json({
                                                    message: commitErr.sqlMessage || commitErr.message
                                                });
                                            });
                                        }

                                        res.json({
                                            message: "Negative deduction applied successfully",
                                            negative_id: negativeId,
                                            deducted_amount: shortage
                                        });
                                    });
                                }
                            );
                        }
                    );
                }
            );
        });
    });
});

// ======================================================
// E1. LIST COLLECTOR PAYMENTS
// GET /payables/payments?collector_id=&page=1&limit=25
// ======================================================
router.get("/payments", (req, res) => {
    const { collector_id } = req.query;
    const { page, limit, offset } = getPagination(req.query);

    let fromSql = `
        FROM collector_payments p
        JOIN collectors c ON p.collector_id = c.id
        WHERE 1=1
    `;

    const params = [];

    if (collector_id) {
        fromSql += ` AND p.collector_id = ? `;
        params.push(collector_id);
    }

    const countSql = `SELECT COUNT(*) AS total ${fromSql}`;

    const dataSql = `
        SELECT
            p.id,
            p.collector_id,
            c.name AS collector_name,
            DATE_FORMAT(p.payment_date, '%Y-%m-%d') AS payment_date,
            p.amount,
            p.payment_target,
            p.remarks,
            DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
        ${fromSql}
        ORDER BY p.id DESC
        LIMIT ? OFFSET ?
    `;

    sendPagedQuery(res, {
        countSql,
        dataSql,
        params,
        page,
        limit,
        offset,
        logLabel: "LOAD COLLECTOR PAYMENTS"
    });
});

// ======================================================
// E2. RECORD PAYMENT / SETTLEMENT
// POST /payables/payments
// body:
// {
//   "collector_id": 1,
//   "payment_date": "2026-04-07",
//   "amount": 500,
//   "payment_target": "negative" | "cash_advance",
//   "remarks": "partial payment"
// }
// ======================================================
router.post("/payments", (req, res) => {
    const {
        collector_id,
        payment_date,
        amount,
        payment_target,
        remarks
    } = req.body;

    if (!collector_id || !payment_date || !amount || !payment_target) {
        return res.status(400).json({
            message: "collector_id, payment_date, amount, and payment_target are required"
        });
    }

    if (!["negative", "cash_advance"].includes(payment_target)) {
        return res.status(400).json({
            message: "payment_target must be negative or cash_advance"
        });
    }

    const paymentAmount = round2(amount);

    if (paymentAmount <= 0) {
        return res.status(400).json({
            message: "Payment amount must be greater than zero"
        });
    }

    const sourceTable = payment_target === "negative"
        ? "collector_negatives"
        : "collector_cash_advances";

    const dateField = payment_target === "negative"
        ? "negative_date"
        : "advance_date";

    const loadOpenSql = `
        SELECT
            id,
            remaining_amount
        FROM ${sourceTable}
        WHERE collector_id = ?
          AND status IN ('open', 'partial')
        ORDER BY ${dateField} ASC, id ASC
    `;

    db.beginTransaction((txErr) => {
        if (txErr) {
            console.log("COLLECTOR PAYMENT TRANSACTION ERROR:", txErr);
            return res.status(500).json({
                message: txErr.sqlMessage || txErr.message
            });
        }

        db.query(loadOpenSql, [collector_id], (loadErr, rows) => {
            if (loadErr) {
                return db.rollback(() => {
                    console.log("LOAD OPEN BALANCES ERROR:", loadErr);
                    res.status(500).json({
                        message: loadErr.sqlMessage || loadErr.message
                    });
                });
            }

            if (rows.length === 0) {
                return db.rollback(() => {
                    res.status(400).json({
                        message: `This collector has no open ${payment_target === "negative" ? "negatives" : "cash advances"} to settle`
                    });
                });
            }

            const totalOpen = round2(rows.reduce((sum, row) => sum + Number(row.remaining_amount || 0), 0));

            if (paymentAmount > totalOpen) {
                return db.rollback(() => {
                    res.status(400).json({
                        message: `Payment amount exceeds open balance. Open balance is ₱${totalOpen.toFixed(2)}`
                    });
                });
            }

            const insertPaymentSql = `
                INSERT INTO collector_payments (
                    collector_id,
                    payment_date,
                    amount,
                    payment_target,
                    remarks
                )
                VALUES (?, ?, ?, ?, ?)
            `;

            db.query(
                insertPaymentSql,
                [collector_id, payment_date, paymentAmount, payment_target, remarks || null],
                (insertPaymentErr, paymentResult) => {
                    if (insertPaymentErr) {
                        return db.rollback(() => {
                            console.log("INSERT COLLECTOR PAYMENT ERROR:", insertPaymentErr);
                            res.status(500).json({
                                message: insertPaymentErr.sqlMessage || insertPaymentErr.message
                            });
                        });
                    }

                    const paymentId = paymentResult.insertId;
                    let remainingToApply = paymentAmount;

                    const applyNext = (index) => {
                        if (remainingToApply <= 0 || index >= rows.length) {
                            return db.commit((commitErr) => {
                                if (commitErr) {
                                    return db.rollback(() => {
                                        console.log("COLLECTOR PAYMENT COMMIT ERROR:", commitErr);
                                        res.status(500).json({
                                            message: commitErr.sqlMessage || commitErr.message
                                        });
                                    });
                                }

                                res.json({
                                    message: "Collector payment recorded successfully",
                                    payment_id: paymentId,
                                    applied_amount: paymentAmount
                                });
                            });
                        }

                        const row = rows[index];
                        const currentRemaining = round2(row.remaining_amount);
                        const appliedAmount = round2(Math.min(remainingToApply, currentRemaining));
                        const newRemaining = round2(currentRemaining - appliedAmount);
                        const newStatus = newRemaining <= 0 ? "settled" : "partial";

                        const updateSql = `
                            UPDATE ${sourceTable}
                            SET
                                remaining_amount = ?,
                                status = ?
                            WHERE id = ?
                        `;

                        db.query(updateSql, [newRemaining, newStatus, row.id], (updateErr) => {
                            if (updateErr) {
                                return db.rollback(() => {
                                    console.log("UPDATE OPEN BALANCE ERROR:", updateErr);
                                    res.status(500).json({
                                        message: updateErr.sqlMessage || updateErr.message
                                    });
                                });
                            }

                            const insertApplicationSql = `
                                INSERT INTO collector_payment_applications (
                                    payment_id,
                                    collector_id,
                                    target_type,
                                    target_id,
                                    applied_amount
                                )
                                VALUES (?, ?, ?, ?, ?)
                            `;

                            db.query(
                                insertApplicationSql,
                                [paymentId, collector_id, payment_target, row.id, appliedAmount],
                                (applicationErr) => {
                                    if (applicationErr) {
                                        return db.rollback(() => {
                                            console.log("INSERT PAYMENT APPLICATION ERROR:", applicationErr);
                                            res.status(500).json({
                                                message: applicationErr.sqlMessage || applicationErr.message
                                            });
                                        });
                                    }

                                    remainingToApply = round2(remainingToApply - appliedAmount);
                                    applyNext(index + 1);
                                }
                            );
                        });
                    };

                    applyNext(0);
                }
            );
        });
    });
});

// ======================================================
// F. LIST REMIT DEDUCTIONS
// GET /payables/deductions?collector_id=&page=1&limit=25
// ======================================================
router.get("/deductions", (req, res) => {
    const { collector_id } = req.query;
    const { page, limit, offset } = getPagination(req.query);

    let fromSql = `
        FROM remit_deductions d
        JOIN collectors c ON d.collector_id = c.id
        WHERE 1=1
    `;

    const params = [];

    if (collector_id) {
        fromSql += ` AND d.collector_id = ? `;
        params.push(collector_id);
    }

    const countSql = `SELECT COUNT(*) AS total ${fromSql}`;

    const dataSql = `
        SELECT
            d.id,
            d.remit_id,
            d.collector_id,
            c.name AS collector_name,
            d.deduction_type,
            d.reference_id,
            d.deducted_amount,
            DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
        ${fromSql}
        ORDER BY d.id DESC
        LIMIT ? OFFSET ?
    `;

    sendPagedQuery(res, {
        countSql,
        dataSql,
        params,
        page,
        limit,
        offset,
        logLabel: "LOAD REMIT DEDUCTIONS"
    });
});

module.exports = router;