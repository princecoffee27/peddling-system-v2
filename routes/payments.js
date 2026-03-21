const express = require("express");
const router = express.Router();
const db = require("../database/db");

// Load active collectors for search dropdown
router.get("/collectors", (req, res) => {
    const sql = `
        SELECT id, name
        FROM collectors
        WHERE is_active = 1 OR is_active IS NULL
        ORDER BY name ASC
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

// Search customers/sales for collection
router.get("/search", (req, res) => {
    const { customer_id, collector_id } = req.query;

    let sql = `
        SELECT
            sales.id AS sale_id,
            customers.id AS customer_id,
            customers.name AS customer_name,
            customers.address AS customer_address,
            customers.phone AS customer_phone,
            customers.collector_id,
            collectors.name AS collector_name,
            sales.balance,
            (
                SELECT p.amount
                FROM payments p
                WHERE p.sale_id = sales.id
                ORDER BY p.payment_date DESC, p.id DESC
                LIMIT 1
            ) AS last_payment_amount,
            DATE_FORMAT((
                SELECT p.payment_date
                FROM payments p
                WHERE p.sale_id = sales.id
                ORDER BY p.payment_date DESC, p.id DESC
                LIMIT 1
            ), '%Y-%m-%d') AS last_payment_date
        FROM sales
        INNER JOIN customers ON sales.customer_id = customers.id
        LEFT JOIN collectors ON customers.collector_id = collectors.id
        WHERE sales.balance > 0
    `;

    const params = [];

    if (customer_id) {
        sql += " AND customers.id = ? ";
        params.push(customer_id);
    }

    if (collector_id) {
        sql += " AND customers.collector_id = ? ";
        params.push(collector_id);
    }

    sql += " ORDER BY customers.id ASC, sales.id ASC ";

    db.query(sql, params, (err, result) => {
        if (err) {
            console.log("SEARCH COLLECTION ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

// Save payment and reduce balance
router.post("/", (req, res) => {
    const { sale_id, amount, payment_date } = req.body;

    const paymentAmount = Number(amount);

    if (!sale_id || !amount || !payment_date) {
        return res.status(400).json({
            message: "Please complete sale, payment amount, and payment date"
        });
    }

    if (paymentAmount <= 0) {
        return res.status(400).json({
            message: "Payment amount must be greater than 0"
        });
    }

    const getSaleSql = "SELECT id, balance FROM sales WHERE id = ?";

    db.query(getSaleSql, [sale_id], (err, saleResult) => {
        if (err) {
            console.log("GET SALE ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        if (saleResult.length === 0) {
            return res.status(404).json({
                message: "Sale not found"
            });
        }

        const currentBalance = Number(saleResult[0].balance);

        if (paymentAmount > currentBalance) {
            return res.status(400).json({
                message: "Payment amount is greater than remaining balance"
            });
        }

        db.beginTransaction((err) => {
            if (err) {
                console.log("TRANSACTION ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            const insertPaymentSql = `
                INSERT INTO payments (sale_id, amount, payment_date, payment_type)
                VALUES (?, ?, ?, ?)
            `;

            db.query(
                insertPaymentSql,
                [sale_id, paymentAmount, payment_date, "regular"],
                (err) => {
                    if (err) {
                        return db.rollback(() => {
                            console.log("INSERT PAYMENT ERROR:", err);
                            res.status(500).json({
                                message: err.sqlMessage || err.message
                            });
                        });
                    }

                    const updateBalanceSql = `
                        UPDATE sales
                        SET balance = balance - ?
                        WHERE id = ?
                    `;

                    db.query(updateBalanceSql, [paymentAmount, sale_id], (err) => {
                        if (err) {
                            return db.rollback(() => {
                                console.log("UPDATE BALANCE ERROR:", err);
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
                                message: "Payment recorded successfully",
                                new_balance: currentBalance - paymentAmount
                            });
                        });
                    });
                }
            );
        });
    });
});

// Update customer info from collection page
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

// Update a payment from history
router.put("/history/:payment_id", (req, res) => {
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
                                    console.log("UPDATE SALE BALANCE FROM PAYMENT EDIT ERROR:", err);
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

// Load full payment history for one sale
router.get("/history/:sale_id", (req, res) => {
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

module.exports = router;