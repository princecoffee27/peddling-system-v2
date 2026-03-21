const express = require("express");
const router = express.Router();
const db = require("../database/db");

// Get all customers
router.get("/customers", (req, res) => {
    db.query("SELECT * FROM customers ORDER BY id ASC", (err, result) => {
        if (err) {
            console.log("CUSTOMERS ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }
        res.json(result);
    });
});

// Get all inventory items
router.get("/inventory", (req, res) => {
    db.query(
        "SELECT id, item_name, capital_price, selling_price, quantity FROM inventory ORDER BY item_name ASC",
        (err, result) => {
            if (err) {
                console.log("INVENTORY ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }
            res.json(result);
        }
    );
});

// Get all sales
router.get("/", (req, res) => {
    const sql = `
        SELECT 
            sales.id,
            sales.customer_id,
            customers.name AS customer_name,
            sales.item_id,
            inventory.item_name,
            sales.quantity,
            sales.total,
            sales.downpayment,
            sales.balance
        FROM sales
        JOIN customers ON sales.customer_id = customers.id
        JOIN inventory ON sales.item_id = inventory.id
        ORDER BY sales.id DESC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log("LOAD SALES ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }
        res.json(result);
    });
});

// Add new sale
router.post("/", (req, res) => {
    const { customer_id, item_id, quantity, downpayment } = req.body;

    const getItemSql = "SELECT selling_price, quantity FROM inventory WHERE id = ?";

    db.query(getItemSql, [item_id], (err, itemResult) => {
        if (err) {
            console.log("GET ITEM ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        if (itemResult.length === 0) {
            return res.status(404).json({ message: "Item not found" });
        }

        const itemPrice = Number(itemResult[0].selling_price);
        const stockQty = Number(itemResult[0].quantity);
        const qty = Number(quantity);
        const dp = Number(downpayment);

        if (qty <= 0) {
            return res.status(400).json({ message: "Quantity must be greater than 0" });
        }

        if (qty > stockQty) {
            return res.status(400).json({ message: "Not enough stock available" });
        }

        const total = itemPrice * qty;
        const balance = total - dp;

        if (balance < 0) {
            return res.status(400).json({
                message: "Downpayment cannot be greater than total amount"
            });
        }

        const insertSaleSql = `
            INSERT INTO sales (customer_id, item_id, quantity, total, downpayment, balance)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.query(
            insertSaleSql,
            [customer_id, item_id, qty, total, dp, balance],
            (err) => {
                if (err) {
                    console.log("INSERT SALE ERROR:", err);
                    return res.status(500).json({
                        message: err.sqlMessage || err.message
                    });
                }

                const updateStockSql = `
                    UPDATE inventory
                    SET quantity = quantity - ?
                    WHERE id = ?
                `;

                db.query(updateStockSql, [qty, item_id], (err) => {
                    if (err) {
                        console.log("UPDATE STOCK ERROR:", err);
                        return res.status(500).json({
                            message: err.sqlMessage || err.message
                        });
                    }

                    res.json({
                        message: "Sale saved successfully",
                        total,
                        balance
                    });
                });
            }
        );
    });
});

module.exports = router;