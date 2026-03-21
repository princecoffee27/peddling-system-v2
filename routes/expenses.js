const express = require("express");
const router = express.Router();
const db = require("../database/db");

// Load collectors for dropdown
router.get("/collectors", (req, res) => {
    const sql = "SELECT id, name FROM collectors ORDER BY name ASC";

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

// Load all expenses
router.get("/", (req, res) => {
    const sql = `
        SELECT
            expenses.id,
            DATE_FORMAT(expenses.expense_date, '%Y-%m-%d') AS expense_date,
            expenses.driver_daily_wage,
            expenses.staffs_food_allowance,
            expenses.gasoline,
            expenses.miscellaneous,
            expenses.total_expense,
            expenses.collector_id,
            expenses.route,
            expenses.expense_type,
            expenses.notes,
            collectors.name AS collector_name
        FROM expenses
        JOIN collectors ON expenses.collector_id = collectors.id
        ORDER BY expenses.expense_date DESC, expenses.id DESC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log("LOAD EXPENSES ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

// Save expense
router.post("/", (req, res) => {
    const {
        expense_date,
        driver_daily_wage,
        staffs_food_allowance,
        gasoline,
        miscellaneous,
        collector_id,
        route,
        expense_type,
        notes
    } = req.body;

    const driver = Number(driver_daily_wage) || 0;
    const food = Number(staffs_food_allowance) || 0;
    const gas = Number(gasoline) || 0;
    const misc = Number(miscellaneous) || 0;
    const total_expense = driver + food + gas + misc;

    if (!expense_date || !collector_id) {
        return res.status(400).json({
            message: "Please complete date and collector"
        });
    }

    if (driver < 0 || food < 0 || gas < 0 || misc < 0) {
        return res.status(400).json({
            message: "Expense values cannot be negative"
        });
    }

    const sql = `
        INSERT INTO expenses (
            expense_date,
            driver_daily_wage,
            staffs_food_allowance,
            gasoline,
            miscellaneous,
            total_expense,
            collector_id,
            route,
            expense_type,
            notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(
        sql,
        [
            expense_date,
            driver,
            food,
            gas,
            misc,
            total_expense,
            collector_id,
            route || null,
            expense_type || "daily",
            notes || null
        ],
        (err) => {
            if (err) {
                console.log("SAVE EXPENSE ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            res.json({
                message: "Expense saved successfully"
            });
        }
    );
});

module.exports = router;