const express = require("express");
const router = express.Router();
const db = require("../database/db");

// Get all customers with collector name
router.get("/", (req, res) => {
    const sql = `
        SELECT 
            customers.id,
            customers.name,
            customers.address,
            customers.phone,
            customers.collector_id,
            collectors.name AS collector_name
        FROM customers
        LEFT JOIN collectors ON customers.collector_id = collectors.id
        ORDER BY customers.id ASC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            res.status(500).json(err);
        } else {
            res.json(result);
        }
    });
});

// Get all collectors for dropdown
router.get("/collectors", (req, res) => {
    db.query("SELECT * FROM collectors ORDER BY name ASC", (err, result) => {
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
        (err, result) => {
            if (err) {
                res.status(500).json({
                    message: "Failed to add customer",
                    error: err
                });
            } else {
                res.json({ message: "Customer added successfully" });
            }
        }
    );
});

module.exports = router;