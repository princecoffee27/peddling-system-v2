const express = require("express");
const router = express.Router();
const db = require("../database/db");

// Get inventory with pagination + search
router.get("/", (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const safeLimit = [50, 100].includes(limit) ? limit : 50;
    const offset = (page - 1) * safeLimit;

    const search = (req.query.search || "").trim();

    let whereSql = "";
    let params = [];

    if (search !== "") {
        whereSql = "WHERE item_name LIKE ?";
        params.push(`%${search}%`);
    }

    const countSql = `
        SELECT COUNT(*) AS total
        FROM inventory
        ${whereSql}
    `;

    const dataSql = `
        SELECT id, item_name, capital_price, selling_price, quantity, is_active
        FROM inventory
        ${whereSql}
        ORDER BY id ASC
        LIMIT ? OFFSET ?
    `;

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.log("COUNT INVENTORY ERROR:", countErr);
            return res.status(500).json({
                message: countErr.sqlMessage || countErr.message
            });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = total > 0 ? Math.ceil(total / safeLimit) : 0;

        db.query(
            dataSql,
            [...params, safeLimit, offset],
            (err, result) => {
                if (err) {
                    console.log("LOAD INVENTORY ERROR:", err);
                    return res.status(500).json({
                        message: err.sqlMessage || err.message
                    });
                }

                res.json({
                    rows: result,
                    pagination: {
                        page,
                        limit: safeLimit,
                        total,
                        totalPages
                    }
                });
            }
        );
    });
});

// Add inventory item
router.post("/", (req, res) => {
    const { item_name, capital_price, selling_price, quantity } = req.body;

    if (!item_name || capital_price === "" || selling_price === "" || quantity === "") {
        return res.status(400).json({
            message: "Please complete all fields"
        });
    }

    const sql = `
        INSERT INTO inventory (item_name, capital_price, selling_price, quantity, is_active)
        VALUES (?, ?, ?, ?, 1)
    `;

    db.query(
        sql,
        [item_name, capital_price, selling_price, quantity],
        (err) => {
            if (err) {
                console.log("ADD INVENTORY ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            res.json({ message: "Item added successfully" });
        }
    );
});

// Update inventory item
router.put("/:id", (req, res) => {
    const itemId = req.params.id;
    const { item_name, capital_price, selling_price, quantity } = req.body;

    if (!item_name || capital_price === "" || selling_price === "" || quantity === "") {
        return res.status(400).json({
            message: "Please complete all fields"
        });
    }

    const sql = `
        UPDATE inventory
        SET item_name = ?, capital_price = ?, selling_price = ?, quantity = ?
        WHERE id = ?
    `;

    db.query(
        sql,
        [item_name, capital_price, selling_price, quantity, itemId],
        (err, result) => {
            if (err) {
                console.log("UPDATE INVENTORY ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: "Item not found"
                });
            }

            res.json({
                message: "Item updated successfully"
            });
        }
    );
});

// Toggle active / inactive
router.put("/:id/toggle", (req, res) => {
    const itemId = req.params.id;

    const sql = `
        UPDATE inventory
        SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
        WHERE id = ?
    `;

    db.query(sql, [itemId], (err, result) => {
        if (err) {
            console.log("TOGGLE INVENTORY ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "Item not found"
            });
        }

        res.json({
            message: "Item status updated successfully"
        });
    });
});

module.exports = router;