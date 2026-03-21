const express = require("express");
const router = express.Router();
const db = require("../database/db");

// =========================
// COLLECTOR MASTER ROUTES
// =========================

// Get all collectors
router.get("/", (req, res) => {
    const sql = `
        SELECT id, name, phone, address, commission_percent, is_active
        FROM collectors
        ORDER BY id ASC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log("LOAD COLLECTORS ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

// Add collector
router.post("/", (req, res) => {
    const { id, name, phone, address, commission_percent } = req.body;

    if (!id || !name || commission_percent === undefined || commission_percent === "") {
        return res.status(400).json({
            message: "Please complete collector ID, name, and commission percent"
        });
    }

    const sql = `
        INSERT INTO collectors (id, name, phone, address, commission_percent, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
    `;

    db.query(
        sql,
        [id, name, phone || null, address || null, commission_percent],
        (err) => {
            if (err) {
                if (err.code === "ER_DUP_ENTRY") {
                    return res.status(400).json({
                        message: "Collector ID already exists. Please use another ID."
                    });
                }

                console.log("ADD COLLECTOR ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            res.json({ message: "Collector added successfully" });
        }
    );
});

// Update collector
router.put("/:id", (req, res) => {
    const collectorId = req.params.id;
    const { name, phone, address, commission_percent } = req.body;

    if (!name || commission_percent === undefined || commission_percent === "") {
        return res.status(400).json({
            message: "Please complete name and commission percent"
        });
    }

    const sql = `
        UPDATE collectors
        SET name = ?, phone = ?, address = ?, commission_percent = ?
        WHERE id = ?
    `;

    db.query(
        sql,
        [name, phone || null, address || null, commission_percent, collectorId],
        (err, result) => {
            if (err) {
                console.log("UPDATE COLLECTOR ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: "Collector not found"
                });
            }

            res.json({
                message: "Collector updated successfully"
            });
        }
    );
});

// Toggle collector active / inactive
router.put("/:id/toggle", (req, res) => {
    const collectorId = req.params.id;

    const sql = `
        UPDATE collectors
        SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
        WHERE id = ?
    `;

    db.query(sql, [collectorId], (err, result) => {
        if (err) {
            console.log("TOGGLE COLLECTOR ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "Collector not found"
            });
        }

        res.json({
            message: "Collector status updated successfully"
        });
    });
});

// =========================
// CUSTOMER / SALE LIST PAGE
// =========================

// Load customer sales list (default all, optional filter by collector)
router.get("/customer-sales", (req, res) => {
    const { collector_id } = req.query;

    let sql = `
        SELECT
            sales.id AS sale_id,
            sales.item_id,
            customers.id AS customer_id,
            customers.name AS customer_name,
            customers.address AS customer_address,
            customers.phone AS customer_phone,
            customers.is_active AS customer_is_active,
            customers.collector_id,
            collectors.name AS collector_name,
            inventory.item_name,
            sales.quantity,
            inventory.capital_price,
            inventory.selling_price
        FROM sales
        INNER JOIN customers ON sales.customer_id = customers.id
        INNER JOIN inventory ON sales.item_id = inventory.id
        LEFT JOIN collectors ON customers.collector_id = collectors.id
        WHERE 1 = 1
    `;

    const params = [];

    if (collector_id) {
        sql += ` AND customers.collector_id = ? `;
        params.push(collector_id);
    }

    sql += ` ORDER BY customers.id ASC, sales.id DESC `;

    db.query(sql, params, (err, result) => {
        if (err) {
            console.log("LOAD CUSTOMER SALES ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

// Active items for edit dropdown
router.get("/items", (req, res) => {
    const sql = `
        SELECT id, item_name, capital_price, selling_price, quantity
        FROM inventory
        WHERE is_active = 1 OR is_active IS NULL
        ORDER BY item_name ASC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log("LOAD ITEMS ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

// Update customer + sale info
router.put("/customer-sale/:sale_id", (req, res) => {
    const saleId = req.params.sale_id;

    const {
        customer_name,
        customer_address,
        customer_phone,
        collector_id,
        item_id,
        quantity
    } = req.body;

    const newQty = Number(quantity);

    if (
        !customer_name ||
        !customer_address ||
        !customer_phone ||
        !collector_id ||
        !item_id ||
        !quantity
    ) {
        return res.status(400).json({
            message: "Please complete all editable fields"
        });
    }

    if (newQty <= 0) {
        return res.status(400).json({
            message: "Quantity must be greater than 0"
        });
    }

    const getSaleSql = `
        SELECT
            sales.id,
            sales.customer_id,
            sales.item_id AS old_item_id,
            sales.quantity AS old_quantity
        FROM sales
        WHERE sales.id = ?
        LIMIT 1
    `;

    db.query(getSaleSql, [saleId], (err, saleRows) => {
        if (err) {
            console.log("GET SALE ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        if (saleRows.length === 0) {
            return res.status(404).json({
                message: "Sale record not found"
            });
        }

        const sale = saleRows[0];
        const customerId = sale.customer_id;
        const oldItemId = sale.old_item_id;
        const oldQty = Number(sale.old_quantity);

        const getPaymentsSql = `
            SELECT COALESCE(SUM(amount), 0) AS total_paid
            FROM payments
            WHERE sale_id = ?
        `;

        db.query(getPaymentsSql, [saleId], (err, paymentRows) => {
            if (err) {
                console.log("GET PAYMENTS ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            const totalPaid = Number(paymentRows[0].total_paid || 0);

            const getNewItemSql = `
                SELECT id, selling_price, quantity
                FROM inventory
                WHERE id = ?
                LIMIT 1
            `;

            db.query(getNewItemSql, [item_id], (err, itemRows) => {
                if (err) {
                    console.log("GET NEW ITEM ERROR:", err);
                    return res.status(500).json({
                        message: err.sqlMessage || err.message
                    });
                }

                if (itemRows.length === 0) {
                    return res.status(404).json({
                        message: "Selected item not found"
                    });
                }

                const newItem = itemRows[0];
                const currentStock = Number(newItem.quantity);
                const availableStock = Number(item_id) === Number(oldItemId)
                    ? currentStock + oldQty
                    : currentStock;

                if (newQty > availableStock) {
                    return res.status(400).json({
                        message: "Not enough stock for the updated item quantity"
                    });
                }

                const newTotal = Number(newItem.selling_price) * newQty;
                const newBalance = newTotal - totalPaid;

                if (newBalance < 0) {
                    return res.status(400).json({
                        message: "Updated item/quantity makes total lower than payments already recorded"
                    });
                }

                db.beginTransaction((err) => {
                    if (err) {
                        console.log("TRANSACTION ERROR:", err);
                        return res.status(500).json({
                            message: err.sqlMessage || err.message
                        });
                    }

                    const updateCustomerSql = `
                        UPDATE customers
                        SET name = ?, address = ?, phone = ?, collector_id = ?
                        WHERE id = ?
                    `;

                    db.query(
                        updateCustomerSql,
                        [customer_name, customer_address, customer_phone, collector_id, customerId],
                        (err) => {
                            if (err) {
                                return db.rollback(() => {
                                    res.status(500).json({
                                        message: err.sqlMessage || err.message
                                    });
                                });
                            }

                            const restoreOldStockSql = `
                                UPDATE inventory
                                SET quantity = quantity + ?
                                WHERE id = ?
                            `;

                            db.query(restoreOldStockSql, [oldQty, oldItemId], (err) => {
                                if (err) {
                                    return db.rollback(() => {
                                        res.status(500).json({
                                            message: err.sqlMessage || err.message
                                        });
                                    });
                                }

                                const deductNewStockSql = `
                                    UPDATE inventory
                                    SET quantity = quantity - ?
                                    WHERE id = ?
                                `;

                                db.query(deductNewStockSql, [newQty, item_id], (err) => {
                                    if (err) {
                                        return db.rollback(() => {
                                            res.status(500).json({
                                                message: err.sqlMessage || err.message
                                            });
                                        });
                                    }

                                    const updateSaleSql = `
                                        UPDATE sales
                                        SET item_id = ?, quantity = ?, total = ?, balance = ?
                                        WHERE id = ?
                                    `;

                                    db.query(
                                        updateSaleSql,
                                        [item_id, newQty, newTotal, newBalance, saleId],
                                        (err) => {
                                            if (err) {
                                                return db.rollback(() => {
                                                    res.status(500).json({
                                                        message: err.sqlMessage || err.message
                                                    });
                                                });
                                            }

                                            db.commit((err) => {
                                                if (err) {
                                                    return db.rollback(() => {
                                                        res.status(500).json({
                                                            message: err.sqlMessage || err.message
                                                        });
                                                    });
                                                }

                                                res.json({
                                                    message: "Customer sale updated successfully"
                                                });
                                            });
                                        }
                                    );
                                });
                            });
                        }
                    );
                });
            });
        });
    });
});

// Delete whole mistaken customer record safely
router.delete("/customer-sale/:sale_id", (req, res) => {
    const saleId = req.params.sale_id;

    const getSaleSql = `
        SELECT id, customer_id, item_id, quantity
        FROM sales
        WHERE id = ?
        LIMIT 1
    `;

    db.query(getSaleSql, [saleId], (err, saleRows) => {
        if (err) {
            console.log("GET SALE FOR DELETE ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        if (saleRows.length === 0) {
            return res.status(404).json({
                message: "Sale record not found"
            });
        }

        const sale = saleRows[0];
        const customerId = sale.customer_id;
        const itemId = sale.item_id;
        const qty = Number(sale.quantity);

        db.beginTransaction((err) => {
            if (err) {
                console.log("DELETE TRANSACTION ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            const restoreStockSql = `
                UPDATE inventory
                SET quantity = quantity + ?
                WHERE id = ?
            `;

            db.query(restoreStockSql, [qty, itemId], (err) => {
                if (err) {
                    return db.rollback(() => {
                        res.status(500).json({
                            message: err.sqlMessage || err.message
                        });
                    });
                }

                const deletePaymentsSql = `
                    DELETE FROM payments
                    WHERE sale_id = ?
                `;

                db.query(deletePaymentsSql, [saleId], (err) => {
                    if (err) {
                        return db.rollback(() => {
                            res.status(500).json({
                                message: err.sqlMessage || err.message
                            });
                        });
                    }

                    const deleteSaleSql = `
                        DELETE FROM sales
                        WHERE id = ?
                    `;

                    db.query(deleteSaleSql, [saleId], (err) => {
                        if (err) {
                            return db.rollback(() => {
                                res.status(500).json({
                                    message: err.sqlMessage || err.message
                                });
                            });
                        }

                        const checkOtherSalesSql = `
                            SELECT COUNT(*) AS sale_count
                            FROM sales
                            WHERE customer_id = ?
                        `;

                        db.query(checkOtherSalesSql, [customerId], (err, countRows) => {
                            if (err) {
                                return db.rollback(() => {
                                    res.status(500).json({
                                        message: err.sqlMessage || err.message
                                    });
                                });
                            }

                            const saleCount = Number(countRows[0].sale_count || 0);

                            if (saleCount > 0) {
                                return db.commit((err) => {
                                    if (err) {
                                        return db.rollback(() => {
                                            res.status(500).json({
                                                message: err.sqlMessage || err.message
                                            });
                                        });
                                    }

                                    res.json({
                                        message: "Sale deleted. Customer kept because other sale records still exist."
                                    });
                                });
                            }

                            const deleteCustomerSql = `
                                DELETE FROM customers
                                WHERE id = ?
                            `;

                            db.query(deleteCustomerSql, [customerId], (err) => {
                                if (err) {
                                    return db.rollback(() => {
                                        res.status(500).json({
                                            message: err.sqlMessage || err.message
                                        });
                                    });
                                }

                                db.commit((err) => {
                                    if (err) {
                                        return db.rollback(() => {
                                            res.status(500).json({
                                                message: err.sqlMessage || err.message
                                            });
                                        });
                                    }

                                    res.json({
                                        message: "Customer, sale, and related payments deleted successfully"
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

// Toggle customer active / inactive
router.put("/customer/:customer_id/toggle", (req, res) => {
    const customerId = req.params.customer_id;

    const sql = `
        UPDATE customers
        SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
        WHERE id = ?
    `;

    db.query(sql, [customerId], (err, result) => {
        if (err) {
            console.log("TOGGLE CUSTOMER ERROR:", err);
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

// Payment history by sale
router.get("/payment-history/:sale_id", (req, res) => {
    const saleId = req.params.sale_id;

    const sql = `
        SELECT
            payments.id AS payment_id,
            customers.id AS customer_id,
            payments.amount,
            DATE_FORMAT(payments.payment_date, '%Y-%m-%d') AS payment_date,
            payments.payment_type
        FROM payments
        JOIN sales ON payments.sale_id = sales.id
        JOIN customers ON sales.customer_id = customers.id
        WHERE payments.sale_id = ?
        ORDER BY payments.payment_date DESC, payments.id DESC
    `;

    db.query(sql, [saleId], (err, result) => {
        if (err) {
            console.log("LOAD PAYMENT HISTORY ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

// Update payment from history
router.put("/payment-history/:payment_id", (req, res) => {
    const paymentId = req.params.payment_id;
    const { amount, payment_date, payment_type } = req.body;

    const newAmount = Number(amount);

    if (!amount || !payment_date || !payment_type) {
        return res.status(400).json({
            message: "Please complete payment amount, payment date, and type"
        });
    }

    if (newAmount <= 0) {
        return res.status(400).json({
            message: "Payment amount must be greater than 0"
        });
    }

    const getPaymentSql = `
        SELECT id, sale_id, amount
        FROM payments
        WHERE id = ?
    `;

    db.query(getPaymentSql, [paymentId], (err, paymentResult) => {
        if (err) {
            console.log("GET PAYMENT ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        if (paymentResult.length === 0) {
            return res.status(404).json({
                message: "Payment not found"
            });
        }

        const saleId = paymentResult[0].sale_id;
        const oldAmount = Number(paymentResult[0].amount);

        const getSaleSql = `SELECT id, balance FROM sales WHERE id = ?`;

        db.query(getSaleSql, [saleId], (err, saleResult) => {
            if (err) {
                console.log("GET SALE FOR PAYMENT UPDATE ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            if (saleResult.length === 0) {
                return res.status(404).json({
                    message: "Related sale not found"
                });
            }

            const currentBalance = Number(saleResult[0].balance);
            const allowedMaximum = currentBalance + oldAmount;

            if (newAmount > allowedMaximum) {
                return res.status(400).json({
                    message: "Updated payment amount is too high for the remaining balance"
                });
            }

            const newBalance = currentBalance + oldAmount - newAmount;

            db.beginTransaction((err) => {
                if (err) {
                    console.log("PAYMENT UPDATE TRANSACTION ERROR:", err);
                    return res.status(500).json({
                        message: err.sqlMessage || err.message
                    });
                }

                const updatePaymentSql = `
                    UPDATE payments
                    SET amount = ?, payment_date = ?, payment_type = ?
                    WHERE id = ?
                `;

                db.query(
                    updatePaymentSql,
                    [newAmount, payment_date, payment_type, paymentId],
                    (err) => {
                        if (err) {
                            return db.rollback(() => {
                                console.log("UPDATE PAYMENT ERROR:", err);
                                res.status(500).json({
                                    message: err.sqlMessage || err.message
                                });
                            });
                        }

                        const updateSaleSql = `
                            UPDATE sales
                            SET balance = ?
                            WHERE id = ?
                        `;

                        db.query(updateSaleSql, [newBalance, saleId], (err) => {
                            if (err) {
                                return db.rollback(() => {
                                    console.log("UPDATE SALE BALANCE ERROR:", err);
                                    res.status(500).json({
                                        message: err.sqlMessage || err.message
                                    });
                                });
                            }

                            db.commit((err) => {
                                if (err) {
                                    return db.rollback(() => {
                                        console.log("COMMIT PAYMENT UPDATE ERROR:", err);
                                        res.status(500).json({
                                            message: err.sqlMessage || err.message
                                        });
                                    });
                                }

                                res.json({
                                    message: "Payment updated successfully"
                                });
                            });
                        });
                    }
                );
            });
        });
    });
});

module.exports = router;