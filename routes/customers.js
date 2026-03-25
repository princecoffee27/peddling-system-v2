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
        ORDER BY c.id ASC
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

// Customer master list with filters + pagination
router.get("/master-list", (req, res) => {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const requestedLimit = parseInt(req.query.limit) || 50;
    const safeLimit = [25, 50, 100].includes(requestedLimit) ? requestedLimit : 50;
    const offset = (page - 1) * safeLimit;

    const collectorId = req.query.collector_id || "";
    const customerId = req.query.customer_id || "";
    const customerName = req.query.customer_name || "";

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
            col.name AS collector_name,
            CASE
                WHEN c.is_active = 0 THEN 'Inactive'
                ELSE 'Active'
            END AS status_text
        FROM sales s
        INNER JOIN customers c ON s.customer_id = c.id
        LEFT JOIN inventory i ON s.item_id = i.id
        LEFT JOIN collectors col ON c.collector_id = col.id
        ${whereSql}
        ORDER BY c.id ASC
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
                    console.log("GET SALES FOR DELETE ERROR:", salesErr);
                    res.status(500).json({
                        message: salesErr.sqlMessage || salesErr.message
                    });
                });
            }

            const saleIds = salesRows.map(row => row.id);

            const finishDeleteCustomer = () => {
                const deleteCustomerSql = `DELETE FROM customers WHERE id = ?`;

                db.query(deleteCustomerSql, [customerId], (deleteCustomerErr, deleteCustomerResult) => {
                    if (deleteCustomerErr) {
                        return db.rollback(() => {
                            console.log("DELETE CUSTOMER ERROR:", deleteCustomerErr);
                            res.status(500).json({
                                message: deleteCustomerErr.sqlMessage || deleteCustomerErr.message
                            });
                        });
                    }

                    if (deleteCustomerResult.affectedRows === 0) {
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
                            message: "Customer deleted and related records reverted successfully"
                        });
                    });
                });
            };

            if (saleIds.length === 0) {
                return finishDeleteCustomer();
            }

            // 1) restore inventory quantities
            const restoreInventoryTasks = salesRows.map((sale) => {
                return new Promise((resolve, reject) => {
                    const restoreSql = `
                        UPDATE inventory
                        SET quantity = quantity + ?
                        WHERE id = ?
                    `;
                    db.query(restoreSql, [sale.quantity, sale.item_id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            });

            Promise.all(restoreInventoryTasks)
                .then(() => {
                    const getPaymentsSql = `
                        SELECT id
                        FROM payments
                        WHERE sale_id IN (?)
                    `;

                    db.query(getPaymentsSql, [saleIds], (paymentsErr, paymentsRows) => {
                        if (paymentsErr) {
                            return db.rollback(() => {
                                console.log("GET PAYMENTS FOR DELETE ERROR:", paymentsErr);
                                res.status(500).json({
                                    message: paymentsErr.sqlMessage || paymentsErr.message
                                });
                            });
                        }

                        const paymentIds = paymentsRows.map(row => row.id);

                        const continueAfterRemits = () => {
                            const deletePayments = (callback) => {
                                if (paymentIds.length === 0) return callback();

                                const deletePaymentsSql = `
                                    DELETE FROM payments
                                    WHERE id IN (?)
                                `;

                                db.query(deletePaymentsSql, [paymentIds], (err) => {
                                    if (err) {
                                        return db.rollback(() => {
                                            console.log("DELETE PAYMENTS ERROR:", err);
                                            res.status(500).json({
                                                message: err.sqlMessage || err.message
                                            });
                                        });
                                    }
                                    callback();
                                });
                            };

                            deletePayments(() => {
                                const deleteSalesSql = `
                                    DELETE FROM sales
                                    WHERE id IN (?)
                                `;

                                db.query(deleteSalesSql, [saleIds], (deleteSalesErr) => {
                                    if (deleteSalesErr) {
                                        return db.rollback(() => {
                                            console.log("DELETE SALES ERROR:", deleteSalesErr);
                                            res.status(500).json({
                                                message: deleteSalesErr.sqlMessage || deleteSalesErr.message
                                            });
                                        });
                                    }

                                    finishDeleteCustomer();
                                });
                            });
                        };

                        if (paymentIds.length === 0) {
                            return continueAfterRemits();
                        }

                        const getAffectedRemitsSql = `
                            SELECT DISTINCT remit_id
                            FROM remit_items
                            WHERE payment_id IN (?)
                        `;

                        db.query(getAffectedRemitsSql, [paymentIds], (affectedErr, affectedRows) => {
                            if (affectedErr) {
                                return db.rollback(() => {
                                    console.log("GET AFFECTED REMITS ERROR:", affectedErr);
                                    res.status(500).json({
                                        message: affectedErr.sqlMessage || affectedErr.message
                                    });
                                });
                            }

                            const affectedRemitIds = affectedRows.map(row => row.remit_id);

                            const deleteRemitItemsSql = `
                                DELETE FROM remit_items
                                WHERE payment_id IN (?)
                            `;

                            db.query(deleteRemitItemsSql, [paymentIds], (deleteRemitItemsErr) => {
                                if (deleteRemitItemsErr) {
                                    return db.rollback(() => {
                                        console.log("DELETE REMIT ITEMS ERROR:", deleteRemitItemsErr);
                                        res.status(500).json({
                                            message: deleteRemitItemsErr.sqlMessage || deleteRemitItemsErr.message
                                        });
                                    });
                                }

                                if (affectedRemitIds.length === 0) {
                                    return continueAfterRemits();
                                }

                                const recalcOneRemit = (remitId) => {
                                    return new Promise((resolve, reject) => {
                                        const getRemitSql = `
                                            SELECT
                                                id,
                                                gas,
                                                food,
                                                miscellaneous,
                                                commission_percent,
                                                cash_on_hand
                                            FROM remits
                                            WHERE id = ?
                                        `;

                                        db.query(getRemitSql, [remitId], (getRemitErr, remitRows) => {
                                            if (getRemitErr) return reject(getRemitErr);
                                            if (remitRows.length === 0) return resolve();

                                            const remit = remitRows[0];

                                            const sumItemsSql = `
                                                SELECT COUNT(*) AS item_count, COALESCE(SUM(payment_amount), 0) AS total_selected_payments
                                                FROM remit_items
                                                WHERE remit_id = ?
                                            `;

                                            db.query(sumItemsSql, [remitId], (sumErr, sumRows) => {
                                                if (sumErr) return reject(sumErr);

                                                const itemCount = Number(sumRows[0].item_count || 0);
                                                const totalSelectedPayments = Number(sumRows[0].total_selected_payments || 0);

                                                if (itemCount === 0) {
                                                    const deleteEmptyRemitSql = `
                                                        DELETE FROM remits
                                                        WHERE id = ?
                                                    `;
                                                    db.query(deleteEmptyRemitSql, [remitId], (deleteErr) => {
                                                        if (deleteErr) return reject(deleteErr);
                                                        resolve();
                                                    });
                                                    return;
                                                }

                                                const gas = Number(remit.gas || 0);
                                                const food = Number(remit.food || 0);
                                                const miscellaneous = Number(remit.miscellaneous || 0);
                                                const commissionPercent = Number(remit.commission_percent || 0);
                                                const cashOnHand = Number(remit.cash_on_hand || 0);

                                                const totalExpenses = gas + food + miscellaneous;
                                                const commissionAmount = (totalSelectedPayments - totalExpenses) * (commissionPercent / 100);
                                                const grossTotal = totalSelectedPayments - commissionAmount;
                                                const netTotal = cashOnHand - commissionAmount;
                                                const varianceAmount = grossTotal - netTotal;

                                                const updateRemitSql = `
                                                    UPDATE remits
                                                    SET
                                                        total_selected_payments = ?,
                                                        commission_amount = ?,
                                                        gross_total = ?,
                                                        net_total = ?,
                                                        variance_amount = ?
                                                    WHERE id = ?
                                                `;

                                                db.query(
                                                    updateRemitSql,
                                                    [
                                                        totalSelectedPayments,
                                                        commissionAmount,
                                                        grossTotal,
                                                        netTotal,
                                                        varianceAmount,
                                                        remitId
                                                    ],
                                                    (updateErr) => {
                                                        if (updateErr) return reject(updateErr);
                                                        resolve();
                                                    }
                                                );
                                            });
                                        });
                                    });
                                };

                                Promise.all(affectedRemitIds.map(recalcOneRemit))
                                    .then(() => continueAfterRemits())
                                    .catch((promiseErr) => {
                                        db.rollback(() => {
                                            console.log("RECALC REMITS ERROR:", promiseErr);
                                            res.status(500).json({
                                                message: promiseErr.sqlMessage || promiseErr.message || promiseErr.toString()
                                            });
                                        });
                                    });
                            });
                        });
                    });
                })
                .catch((restoreErr) => {
                    db.rollback(() => {
                        console.log("RESTORE INVENTORY ERROR:", restoreErr);
                        res.status(500).json({
                            message: restoreErr.sqlMessage || restoreErr.message || restoreErr.toString()
                        });
                    });
                });
        });
    });
});

module.exports = router;