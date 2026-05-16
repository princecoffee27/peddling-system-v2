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

// Load expenses with pagination + optional filters
router.get("/", (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const safeLimit = [50, 100].includes(limit) ? limit : 50;
    const offset = (page - 1) * safeLimit;

    const { collector_id, date_from, date_to } = req.query;
    const where = [];
    const params = [];

    if (collector_id) {
        where.push("e.collector_id = ?");
        params.push(collector_id);
    }

    if (date_from) {
        where.push("e.expense_date >= ?");
        params.push(date_from);
    }

    if (date_to) {
        where.push("e.expense_date <= ?");
        params.push(date_to);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const isAdmin = req.session?.user?.role === "admin";

    const countSql = `
        SELECT COUNT(*) AS total
        FROM expenses e
        ${whereSql}
    `;

    const summarySql = `
        SELECT
            COALESCE(SUM(e.driver_daily_wage), 0) AS total_driver_daily_wage,
            COALESCE(SUM(e.staffs_food_allowance), 0) AS total_staffs_food_allowance,
            COALESCE(SUM(e.gasoline), 0) AS total_gasoline,
            COALESCE(SUM(e.miscellaneous), 0) AS total_miscellaneous,
            COALESCE(SUM(e.total_expense), 0) AS grand_total_expense
        FROM expenses e
        ${whereSql}
    `;

    const dataSql = `
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
        ${whereSql}
        ORDER BY e.expense_date DESC, e.id DESC
        LIMIT ? OFFSET ?
    `;

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.log("COUNT EXPENSES ERROR:", countErr);
            return res.status(500).json({
                message: countErr.sqlMessage || countErr.message
            });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = total > 0 ? Math.ceil(total / safeLimit) : 0;

        db.query(dataSql, [...params, safeLimit, offset], (err, result) => {
            if (err) {
                console.log("LOAD EXPENSES ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            const sendResponse = (summary = null) => {
                res.json({
                    rows: result,
                    summary,
                    pagination: {
                        page,
                        limit: safeLimit,
                        total,
                        totalPages
                    }
                });
            };

            if (!isAdmin) {
                return sendResponse(null);
            }

            db.query(summarySql, params, (summaryErr, summaryResult) => {
                if (summaryErr) {
                    console.log("EXPENSE SUMMARY ERROR:", summaryErr);
                    return res.status(500).json({
                        message: summaryErr.sqlMessage || summaryErr.message
                    });
                }

                sendResponse(summaryResult[0] || {
                    total_driver_daily_wage: 0,
                    total_staffs_food_allowance: 0,
                    total_gasoline: 0,
                    total_miscellaneous: 0,
                    grand_total_expense: 0
                });
            });
        });
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