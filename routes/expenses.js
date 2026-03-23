const express = require("express");
const router = express.Router();
const db = require("../database/db");

// Load collectors for dropdown
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

// Load all expenses
router.get("/", (req, res) => {
    const sql = `
        SELECT
            e.id,
            DATE_FORMAT(e.expense_date, '%Y-%m-%d') AS expense_date,
            e.driver_daily_wage,
            e.staffs_food_allowance,
            e.gasoline,
            e.miscellaneous,
            e.total_expense,
            e.collector_id,
            c.name AS collector_name,
            e.route,
            e.expense_type,
            e.notes
        FROM expenses e
        LEFT JOIN collectors c ON e.collector_id = c.id
        ORDER BY e.expense_date DESC, e.id DESC
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

// Save new expense
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
        INSERT INTO expenses
        (
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
        (err, result) => {
            if (err) {
                console.log("SAVE EXPENSE ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            res.json({
                message: "Expense saved successfully",
                id: result.insertId
            });
        }
    );
});

// Update expense
router.put("/:id", (req, res) => {
    const { id } = req.params;

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
        UPDATE expenses
        SET
            expense_date = ?,
            driver_daily_wage = ?,
            staffs_food_allowance = ?,
            gasoline = ?,
            miscellaneous = ?,
            total_expense = ?,
            collector_id = ?,
            route = ?,
            expense_type = ?,
            notes = ?
        WHERE id = ?
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
            notes || null,
            id
        ],
        (err, result) => {
            if (err) {
                console.log("UPDATE EXPENSE ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: "Expense not found"
                });
            }

            res.json({
                message: "Expense updated successfully"
            });
        }
    );
});

// Delete expense
router.delete("/:id", (req, res) => {
    const { id } = req.params;

    const sql = `DELETE FROM expenses WHERE id = ?`;

    db.query(sql, [id], (err, result) => {
        if (err) {
            console.log("DELETE EXPENSE ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "Expense not found"
            });
        }

        res.json({
            message: "Expense deleted successfully"
        });
    });
});

module.exports = router;