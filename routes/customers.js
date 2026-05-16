const express = require("express");
const router = express.Router();
const db = require("../database/db");

// Get all customers with collector name
router.get("/", (req, res) => {
    const sql = `
        SELECT 
            c.id,
            c.id AS customer_id,
            c.name,
            c.address,
            c.phone,
            c.collector_id,
            col.name AS collector_name,
            c.is_active
        FROM customers c
        LEFT JOIN collectors col ON c.collector_id = col.id
        ORDER BY c.id DESC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log("LOAD CUSTOMERS ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }
        res.json(result);
    });
});

// Get collectors for dropdown
router.get("/collectors", (req, res) => {
    const sql = `
        SELECT *
        FROM collectors
        WHERE is_active = 1 OR is_active IS NULL
        ORDER BY name ASC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log("LOAD CUSTOMER COLLECTORS ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }
        res.json(result);
    });
});

// Add customer
router.post("/", (req, res) => {
    const { id, name, address, phone, collector_id } = req.body;

    db.query(
        "INSERT INTO customers (id, name, address, phone, collector_id) VALUES (?, ?, ?, ?, ?)",
        [id, name, address, phone, collector_id || null],
        (err) => {
            if (err) {
                console.log("ADD CUSTOMER ERROR:", err);
                return res.status(500).json({
                    message: "Failed to add customer",
                    error: err.sqlMessage || err.message
                });
            }

            res.json({ message: "Customer added successfully" });
        }
    );
});

// Customer master list with filters + pagination + sorting
router.get("/master-list", (req, res) => {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const requestedLimit = parseInt(req.query.limit) || 50;
    const safeLimit = [25, 50, 100].includes(requestedLimit) ? requestedLimit : 50;
    const offset = (page - 1) * safeLimit;

    const collectorId = req.query.collector_id || "";
    const customerId = req.query.customer_id || "";
    const customerName = req.query.customer_name || "";
    const sortOption = (req.query.sort_option || "").trim();

    let whereSql = " WHERE 1=1 ";
    const whereParams = [];

    if (collectorId) {
        whereSql += " AND c.collector_id = ? ";
        whereParams.push(collectorId);
    }

    if (customerId) {
        whereSql += " AND CAST(c.id AS CHAR) LIKE ? ";
        whereParams.push(`%${customerId}%`);
    }

    if (customerName) {
        whereSql += " AND c.name LIKE ? ";
        whereParams.push(`%${customerName}%`);
    }

    let orderBySql = " ORDER BY c.id DESC, s.id DESC ";

    switch (sortOption) {
        case "dp_desc":
            orderBySql = `
                ORDER BY
                    pay_summary.downpayment_date IS NULL ASC,
                    pay_summary.downpayment_date DESC,
                    c.id DESC,
                    s.id DESC
            `;
            break;
        case "dp_asc":
            orderBySql = `
                ORDER BY
                    pay_summary.downpayment_date IS NULL ASC,
                    pay_summary.downpayment_date ASC,
                    c.id DESC,
                    s.id DESC
            `;
            break;
        case "lastpay_desc":
            orderBySql = `
                ORDER BY
                    pay_summary.last_regular_payment_date IS NULL ASC,
                    pay_summary.last_regular_payment_date DESC,
                    c.id DESC,
                    s.id DESC
            `;
            break;
        case "lastpay_asc":
            orderBySql = `
                ORDER BY
                    pay_summary.last_regular_payment_date IS NULL ASC,
                    pay_summary.last_regular_payment_date ASC,
                    c.id DESC,
                    s.id DESC
            `;
            break;
        case "balance_desc":
            orderBySql = `
                ORDER BY
                    COALESCE(s.balance, 0) DESC,
                    c.id DESC,
                    s.id DESC
            `;
            break;
        case "balance_asc":
            orderBySql = `
                ORDER BY
                    COALESCE(s.balance, 0) ASC,
                    c.id DESC,
                    s.id DESC
            `;
            break;
        default:
            break;
    }

    const countSql = `
        SELECT COUNT(*) AS total
        FROM sales s
        INNER JOIN customers c ON s.customer_id = c.id
        LEFT JOIN inventory i ON s.item_id = i.id
        LEFT JOIN collectors col ON c.collector_id = col.id
        ${whereSql}
    `;

    const dataSql = `
        SELECT
            s.id AS sale_id,
            c.id AS customer_id,
            c.name AS customer_name,
            c.address,
            c.phone,
            c.collector_id,
            c.is_active,
            i.item_name AS item_bought,
            i.id AS item_id,
            s.quantity,
            i.capital_price,
            i.selling_price,
            COALESCE(s.balance, 0) AS remaining_balance,
            DATE_FORMAT(pay_summary.downpayment_date, '%Y-%m-%d') AS downpayment_date,
            DATE_FORMAT(pay_summary.last_regular_payment_date, '%Y-%m-%d') AS last_regular_payment_date,
            col.name AS collector_name,
            CASE
                WHEN c.is_active = 0 THEN 'Inactive'
                ELSE 'Active'
            END AS status_text
        FROM sales s
        INNER JOIN customers c ON s.customer_id = c.id
        LEFT JOIN inventory i ON s.item_id = i.id
        LEFT JOIN collectors col ON c.collector_id = col.id
        LEFT JOIN (
            SELECT
                sale_id,
                MIN(CASE WHEN LOWER(TRIM(payment_type)) = 'downpayment' THEN payment_date END) AS downpayment_date,
                MAX(CASE WHEN LOWER(TRIM(payment_type)) = 'regular' THEN payment_date END) AS last_regular_payment_date
            FROM payments
            GROUP BY sale_id
        ) AS pay_summary ON pay_summary.sale_id = s.id
        ${whereSql}
        ${orderBySql}
        LIMIT ? OFFSET ?
    `;

    db.query(countSql, whereParams, (countErr, countResult) => {
        if (countErr) {
            console.log("MASTER LIST COUNT ERROR:", countErr);
            return res.status(500).json({
                message: countErr.sqlMessage || countErr.message
            });
        }

        const totalRows = countResult[0]?.total || 0;
        const totalPages = totalRows > 0 ? Math.ceil(totalRows / safeLimit) : 1;

        db.query(dataSql, [...whereParams, safeLimit, offset], (dataErr, dataRows) => {
            if (dataErr) {
                console.log("MASTER LIST DATA ERROR:", dataErr);
                return res.status(500).json({
                    message: dataErr.sqlMessage || dataErr.message
                });
            }

            res.json({
                page,
                limit: safeLimit,
                totalRows,
                totalPages,
                sortOption,
                rows: dataRows
            });
        });
    });
});

// Payment history per sale
router.get("/payment-history/:saleId", (req, res) => {
    const saleId = req.params.saleId;

    const sql = `
        SELECT
            id,
            DATE_FORMAT(payment_date, '%Y-%m-%d') AS payment_date,
            amount,
            payment_type
        FROM payments
        WHERE sale_id = ?
        ORDER BY payment_date DESC, id DESC
    `;

    db.query(sql, [saleId], (err, result) => {
        if (err) {
            console.log("PAYMENT HISTORY ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

// Update customer
router.put("/:customerId", (req, res) => {
    const customerId = req.params.customerId;
    const { name, address, phone, collector_id } = req.body;

    if (!name || !address || collector_id === undefined || collector_id === null || collector_id === "") {
        return res.status(400).json({
            message: "Please complete name, address, and collector"
        });
    }

    const sql = `
        UPDATE customers
        SET name = ?, address = ?, phone = ?, collector_id = ?
        WHERE id = ?
    `;

    db.query(sql, [name, address, phone || null, collector_id, customerId], (err, result) => {
        if (err) {
            console.log("UPDATE CUSTOMER ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "Customer not found"
            });
        }

        res.json({
            message: "Customer updated successfully"
        });
    });
});

// Toggle customer active / inactive
router.put("/:customerId/toggle-status", (req, res) => {
    const customerId = req.params.customerId;

    const sql = `
        UPDATE customers
        SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
        WHERE id = ?
    `;

    db.query(sql, [customerId], (err, result) => {
        if (err) {
            console.log("TOGGLE CUSTOMER STATUS ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "Customer not found"
            });
        }

        res.json({
            message: "Customer status updated successfully"
        });
    });
});

// Delete customer and revert related records safely
router.delete("/:customerId", (req, res) => {
    const customerId = req.params.customerId;

    db.beginTransaction((txErr) => {
        if (txErr) {
            console.log("DELETE CUSTOMER TRANSACTION ERROR:", txErr);
            return res.status(500).json({
                message: txErr.sqlMessage || txErr.message
            });
        }

        const getSalesSql = `
            SELECT id, item_id, quantity
            FROM sales
            WHERE customer_id = ?
        `;

        db.query(getSalesSql, [customerId], (salesErr, salesRows) => {
            if (salesErr) {
                return db.rollback(() => {
                    console.log("GET CUSTOMER SALES ERROR:", salesErr);
                    res.status(500).json({
                        message: salesErr.sqlMessage || salesErr.message
                    });
                });
            }

            const saleIds = salesRows.map(row => row.id);

            const restoreInventory = (callback) => {
                if (!salesRows.length) return callback();

                let pending = salesRows.length;
                let failed = false;

                salesRows.forEach(row => {
                    const updateInventorySql = `
                        UPDATE inventory
                        SET quantity = quantity + ?
                        WHERE id = ?
                    `;

                    db.query(updateInventorySql, [row.quantity, row.item_id], (invErr) => {
                        if (failed) return;

                        if (invErr) {
                            failed = true;
                            return db.rollback(() => {
                                console.log("RESTORE INVENTORY ERROR:", invErr);
                                res.status(500).json({
                                    message: invErr.sqlMessage || invErr.message
                                });
                            });
                        }

                        pending -= 1;
                        if (pending === 0) callback();
                    });
                });
            };

            const deleteRemitItems = (callback) => {
                if (!saleIds.length) return callback();

                const remitItemsSql = `
                    DELETE FROM remit_items
                    WHERE payment_id IN (
                        SELECT id FROM payments WHERE sale_id IN (?)
                    )
                `;

                db.query(remitItemsSql, [saleIds], (remitItemsErr) => {
                    if (remitItemsErr) {
                        return db.rollback(() => {
                            console.log("DELETE REMIT ITEMS ERROR:", remitItemsErr);
                            res.status(500).json({
                                message: remitItemsErr.sqlMessage || remitItemsErr.message
                            });
                        });
                    }
                    callback();
                });
            };

            const recalculateRemits = (callback) => {
                const getRemitsSql = `
                    SELECT DISTINCT r.id, c.commission_percent
                    FROM remits r
                    LEFT JOIN collectors c ON r.collector_id = c.id
                `;

                db.query(getRemitsSql, (remitsErr, remitsRows) => {
                    if (remitsErr) {
                        return db.rollback(() => {
                            console.log("GET REMITS ERROR:", remitsErr);
                            res.status(500).json({
                                message: remitsErr.sqlMessage || remitsErr.message
                            });
                        });
                    }

                    if (!remitsRows.length) return callback();

                    let pending = remitsRows.length;
                    let failed = false;

                    remitsRows.forEach(remit => {
                        const getPaymentsSumSql = `
                            SELECT COALESCE(SUM(p.amount), 0) AS total_selected_payments
                            FROM remit_items ri
                            INNER JOIN payments p ON ri.payment_id = p.id
                            WHERE ri.remit_id = ?
                        `;

                        db.query(getPaymentsSumSql, [remit.id], (sumErr, sumRows) => {
                            if (failed) return;

                            if (sumErr) {
                                failed = true;
                                return db.rollback(() => {
                                    console.log("REMIT SUM ERROR:", sumErr);
                                    res.status(500).json({
                                        message: sumErr.sqlMessage || sumErr.message
                                    });
                                });
                            }

                            const totalSelectedPayments = Number(sumRows[0]?.total_selected_payments || 0);
                            const gas = 0;
                            const food = 0;
                            const miscellaneous = 0;
                            const grossTotal = totalSelectedPayments - (gas + food + miscellaneous);
                            const commissionPercent = Number(remit.commission_percent || 0);
                            const commissionAmount = grossTotal * (commissionPercent / 100);
                            const cashOnHand = totalSelectedPayments;
                            const netTotal = cashOnHand - commissionAmount;
                            const varianceAmount = cashOnHand - grossTotal;

                            const updateRemitSql = `
                                UPDATE remits
                                SET total_selected_payments = ?,
                                    gross_total = ?,
                                    commission_percent = ?,
                                    commission_amount = ?,
                                    cash_on_hand = ?,
                                    net_total = ?,
                                    variance_amount = ?
                                WHERE id = ?
                            `;

                            db.query(
                                updateRemitSql,
                                [
                                    totalSelectedPayments,
                                    grossTotal,
                                    commissionPercent,
                                    commissionAmount,
                                    cashOnHand,
                                    netTotal,
                                    varianceAmount,
                                    remit.id
                                ],
                                (updateErr) => {
                                    if (failed) return;

                                    if (updateErr) {
                                        failed = true;
                                        return db.rollback(() => {
                                            console.log("UPDATE REMIT ERROR:", updateErr);
                                            res.status(500).json({
                                                message: updateErr.sqlMessage || updateErr.message
                                            });
                                        });
                                    }

                                    pending -= 1;
                                    if (pending === 0) callback();
                                }
                            );
                        });
                    });
                });
            };

            const deletePayments = (callback) => {
                const deletePaymentsSql = `
                    DELETE FROM payments
                    WHERE sale_id IN (
                        SELECT id FROM sales WHERE customer_id = ?
                    )
                `;

                db.query(deletePaymentsSql, [customerId], (paymentsErr) => {
                    if (paymentsErr) {
                        return db.rollback(() => {
                            console.log("DELETE PAYMENTS ERROR:", paymentsErr);
                            res.status(500).json({
                                message: paymentsErr.sqlMessage || paymentsErr.message
                            });
                        });
                    }
                    callback();
                });
            };

            const deleteSales = (callback) => {
                const deleteSalesSql = `DELETE FROM sales WHERE customer_id = ?`;

                db.query(deleteSalesSql, [customerId], (salesDeleteErr) => {
                    if (salesDeleteErr) {
                        return db.rollback(() => {
                            console.log("DELETE SALES ERROR:", salesDeleteErr);
                            res.status(500).json({
                                message: salesDeleteErr.sqlMessage || salesDeleteErr.message
                            });
                        });
                    }
                    callback();
                });
            };

            const deleteCustomerSql = `DELETE FROM customers WHERE id = ?`;

            restoreInventory(() => {
                deleteRemitItems(() => {
                    recalculateRemits(() => {
                        deletePayments(() => {
                            deleteSales(() => {
                                db.query(deleteCustomerSql, [customerId], (customerErr, customerResult) => {
                                    if (customerErr) {
                                        return db.rollback(() => {
                                            console.log("DELETE CUSTOMER ERROR:", customerErr);
                                            res.status(500).json({
                                                message: customerErr.sqlMessage || customerErr.message
                                            });
                                        });
                                    }

                                    if (customerResult.affectedRows === 0) {
                                        return db.rollback(() => {
                                            res.status(404).json({
                                                message: "Customer not found"
                                            });
                                        });
                                    }

                                    db.commit((commitErr) => {
                                        if (commitErr) {
                                            return db.rollback(() => {
                                                console.log("DELETE CUSTOMER COMMIT ERROR:", commitErr);
                                                res.status(500).json({
                                                    message: commitErr.sqlMessage || commitErr.message
                                                });
                                            });
                                        }

                                        res.json({
                                            message: "Customer and related records deleted successfully. Inventory restored and remits recalculated."
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

module.exports = router;