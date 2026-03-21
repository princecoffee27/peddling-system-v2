const express = require("express");
const router = express.Router();
const db = require("../database/db");

// Load active collectors for dropdown
router.get("/collectors", (req, res) => {
    const sql = `
        SELECT id, name
        FROM collectors
        WHERE is_active = 1 OR is_active IS NULL
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

// Load active inventory items for dropdown
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

// Load saved customer + sale records for table view
router.get("/records", (req, res) => {
    const sql = `
        SELECT
            sales.id AS sale_id,
            customers.id AS customer_id,
            customers.name AS customer_name,
            customers.address AS customer_address,
            customers.phone AS customer_phone,
            customers.collector_id,
            inventory.item_name AS item_bought,
            sales.quantity,
            sales.downpayment,
            DATE_FORMAT((
                SELECT p.payment_date
                FROM payments p
                WHERE p.sale_id = sales.id AND p.payment_type = 'downpayment'
                ORDER BY p.id ASC
                LIMIT 1
            ), '%Y-%m-%d') AS downpayment_date,
            collectors.name AS collector_name,
            sales.balance
        FROM sales
        INNER JOIN customers ON sales.customer_id = customers.id
        INNER JOIN inventory ON sales.item_id = inventory.id
        LEFT JOIN collectors ON customers.collector_id = collectors.id
        ORDER BY sales.id DESC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log("LOAD RECORDS ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

// Update customer info from this page
router.put("/customer/:customer_id", (req, res) => {
    const customerId = req.params.customer_id;
    const { customer_name, customer_address, customer_phone, collector_id } = req.body;

    if (!customer_name || !customer_address || !customer_phone || !collector_id) {
        return res.status(400).json({
            message: "Please complete customer name, address, phone, and collector"
        });
    }

    const sql = `
        UPDATE customers
        SET name = ?, address = ?, phone = ?, collector_id = ?
        WHERE id = ?
    `;

    db.query(
        sql,
        [customer_name, customer_address, customer_phone, collector_id, customerId],
        (err, result) => {
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
        }
    );
});

// Save new customer + first sale + first downpayment record
router.post("/", (req, res) => {
    const {
        customer_id,
        customer_name,
        customer_address,
        customer_phone,
        collector_id,
        item_id,
        item_quantity,
        downpayment,
        downpayment_date
    } = req.body;

    const qty = Number(item_quantity);
    const dp = Number(downpayment);

    if (
        !customer_id ||
        !customer_name ||
        !customer_address ||
        !customer_phone ||
        !collector_id ||
        !item_id ||
        !item_quantity ||
        !downpayment_date
    ) {
        return res.status(400).json({
            message: "Please fill in all required fields"
        });
    }

    if (qty <= 0) {
        return res.status(400).json({
            message: "Item quantity must be greater than 0"
        });
    }

    if (dp < 0) {
        return res.status(400).json({
            message: "Down payment cannot be negative"
        });
    }

    db.beginTransaction((err) => {
        if (err) {
            console.log("TRANSACTION ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        const insertCustomerSql = `
            INSERT INTO customers (id, name, address, phone, collector_id)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(
            insertCustomerSql,
            [customer_id, customer_name, customer_address, customer_phone, collector_id],
            (err) => {
                if (err) {
                    if (err.code === "ER_DUP_ENTRY") {
                        return db.rollback(() => {
                            res.status(400).json({
                                message: "Customer ID already exists. Please use a different ID."
                            });
                        });
                    }

                    return db.rollback(() => {
                        console.log("INSERT CUSTOMER ERROR:", err);
                        res.status(500).json({
                            message: err.sqlMessage || err.message
                        });
                    });
                }

                const getItemSql = `
                    SELECT id, item_name, capital_price, selling_price, quantity
                    FROM inventory
                    WHERE id = ?
                `;

                db.query(getItemSql, [item_id], (err, itemResult) => {
                    if (err) {
                        return db.rollback(() => {
                            console.log("GET ITEM ERROR:", err);
                            res.status(500).json({
                                message: err.sqlMessage || err.message
                            });
                        });
                    }

                    if (itemResult.length === 0) {
                        return db.rollback(() => {
                            res.status(404).json({
                                message: "Selected item not found"
                            });
                        });
                    }

                    const itemPrice = Number(itemResult[0].selling_price);
                    const stockQty = Number(itemResult[0].quantity);

                    if (qty > stockQty) {
                        return db.rollback(() => {
                            res.status(400).json({
                                message: "Not enough stock available"
                            });
                        });
                    }

                    const total = itemPrice * qty;
                    const balance = total - dp;

                    if (balance < 0) {
                        return db.rollback(() => {
                            res.status(400).json({
                                message: "Down payment cannot be greater than total amount"
                            });
                        });
                    }

                    const insertSaleSql = `
                        INSERT INTO sales (customer_id, item_id, quantity, total, downpayment, balance)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `;

                    db.query(
                        insertSaleSql,
                        [customer_id, item_id, qty, total, dp, balance],
                        (err, saleResult) => {
                            if (err) {
                                return db.rollback(() => {
                                    console.log("INSERT SALE ERROR:", err);
                                    res.status(500).json({
                                        message: err.sqlMessage || err.message
                                    });
                                });
                            }

                            const saleId = saleResult.insertId;

                            const updateStockSql = `
                                UPDATE inventory
                                SET quantity = quantity - ?
                                WHERE id = ?
                            `;

                            db.query(updateStockSql, [qty, item_id], (err) => {
                                if (err) {
                                    return db.rollback(() => {
                                        console.log("UPDATE STOCK ERROR:", err);
                                        res.status(500).json({
                                            message: err.sqlMessage || err.message
                                        });
                                    });
                                }

                                if (dp > 0) {
                                    const insertPaymentSql = `
                                        INSERT INTO payments (sale_id, amount, payment_date, payment_type)
                                        VALUES (?, ?, ?, ?)
                                    `;

                                    db.query(
                                        insertPaymentSql,
                                        [saleId, dp, downpayment_date, "downpayment"],
                                        (err) => {
                                            if (err) {
                                                return db.rollback(() => {
                                                    console.log("INSERT DOWNPAYMENT ERROR:", err);
                                                    res.status(500).json({
                                                        message: err.sqlMessage || err.message
                                                    });
                                                });
                                            }

                                            db.commit((err) => {
                                                if (err) {
                                                    return db.rollback(() => {
                                                        console.log("COMMIT ERROR:", err);
                                                        res.status(500).json({
                                                            message: err.sqlMessage || err.message
                                                        });
                                                    });
                                                }

                                                res.json({
                                                    message: "Customer with first sale saved successfully",
                                                    total,
                                                    balance
                                                });
                                            });
                                        }
                                    );
                                } else {
                                    db.commit((err) => {
                                        if (err) {
                                            return db.rollback(() => {
                                                console.log("COMMIT ERROR:", err);
                                                res.status(500).json({
                                                    message: err.sqlMessage || err.message
                                                });
                                            });
                                        }

                                        res.json({
                                            message: "Customer with first sale saved successfully",
                                            total,
                                            balance
                                        });
                                    });
                                }
                            });
                        }
                    );
                });
            }
        );
    });
});

module.exports = router;