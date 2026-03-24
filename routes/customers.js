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

// Get all collectors for dropdown
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

// Fast customer master list with filters + pagination
router.get("/master-list", (req, res) => {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 50, 1);
    const offset = (page - 1) * limit;

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
            i.item_name AS item_bought,
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
        const totalPages = Math.max(Math.ceil(totalRows / limit), 1);

        db.query(dataSql, [...whereParams, limit, offset], (dataErr, dataRows) => {
            if (dataErr) {
                console.log("MASTER LIST DATA ERROR:", dataErr);
                return res.status(500).json({
                    message: dataErr.sqlMessage || dataErr.message
                });
            }

            res.json({
                page,
                limit,
                totalRows,
                totalPages,
                rows: dataRows
            });
        });
    });
});

// Lazy-load payment history only when History button is clicked
router.get("/payment-history/:saleId", (req, res) => {
    const saleId = req.params.saleId;

    const sql = `
        SELECT
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

module.exports = router;