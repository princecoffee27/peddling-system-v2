const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();
const db = require("../database/db");

function requireLogin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ message: "Not logged in" });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ message: "Not logged in" });
    }

    if (req.session.user.role !== "admin") {
        return res.status(403).json({ message: "Admin access only" });
    }

    next();
}

// Get all users - admin only
router.get("/", requireAdmin, (req, res) => {
    const sql = `
        SELECT id, username, role, is_active, privileges, created_at
        FROM users
        ORDER BY id DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.log("GET USERS ERROR:", err);
            return res.status(500).json({ message: err.sqlMessage || err.message });
        }

        const users = results.map(user => ({
            ...user,
            privileges: typeof user.privileges === "string"
                ? JSON.parse(user.privileges || "{}")
                : (user.privileges || {})
        }));

        res.json(users);
    });
});

// Create new user - admin only
router.post("/", requireAdmin, (req, res) => {
    const { username, password, role, privileges } = req.body;

    if (!username || !password || !role) {
        return res.status(400).json({
            message: "Username, password, and role are required"
        });
    }

    if (!["admin", "staff"].includes(role)) {
        return res.status(400).json({
            message: "Invalid role"
        });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    const defaultPrivileges = privileges || {
        view_dashboard_money: role === "admin",
        view_reports: role === "admin",
        manage_users: role === "admin"
    };

    const sql = `
        INSERT INTO users (username, password, role, is_active, privileges)
        VALUES (?, ?, ?, 1, ?)
    `;

    db.query(
        sql,
        [username, hashedPassword, role, JSON.stringify(defaultPrivileges)],
        (err, result) => {
            if (err) {
                console.log("CREATE USER ERROR:", err);

                if (err.code === "ER_DUP_ENTRY") {
                    return res.status(400).json({
                        message: "Username already exists"
                    });
                }

                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            res.json({
                message: "User created successfully",
                id: result.insertId
            });
        }
    );
});

// Update role / active status / privileges - admin only
router.put("/:id", requireAdmin, (req, res) => {
    const { id } = req.params;
    const { role, is_active, privileges } = req.body;

    if (!["admin", "staff"].includes(role)) {
        return res.status(400).json({
            message: "Invalid role"
        });
    }

    const finalPrivileges = privileges || {
        view_dashboard_money: role === "admin",
        view_reports: role === "admin",
        manage_users: role === "admin"
    };

    const sql = `
        UPDATE users
        SET role = ?, is_active = ?, privileges = ?
        WHERE id = ?
    `;

    db.query(
        sql,
        [role, Number(is_active), JSON.stringify(finalPrivileges), id],
        (err) => {
            if (err) {
                console.log("UPDATE USER ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            res.json({
                message: "User updated successfully"
            });
        }
    );
});

// Reset password - admin only
router.put("/:id/password", requireAdmin, (req, res) => {
    const { id } = req.params;
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({
            message: "New password is required"
        });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    const sql = `
        UPDATE users
        SET password = ?
        WHERE id = ?
    `;

    db.query(sql, [hashedPassword, id], (err) => {
        if (err) {
            console.log("RESET PASSWORD ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json({
            message: "Password reset successfully"
        });
    });
});

// User changes own password
router.put("/me/password/change", requireLogin, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({
            message: "Current password and new password are required"
        });
    }

    const sql = `
        SELECT password
        FROM users
        WHERE id = ?
        LIMIT 1
    `;

    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.log("CHANGE PASSWORD SELECT ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        const isMatch = bcrypt.compareSync(currentPassword, results[0].password);

        if (!isMatch) {
            return res.status(401).json({
                message: "Current password is incorrect"
            });
        }

        const hashedPassword = bcrypt.hashSync(newPassword, 10);

        db.query(
            "UPDATE users SET password = ? WHERE id = ?",
            [hashedPassword, userId],
            (updateErr) => {
                if (updateErr) {
                    console.log("CHANGE PASSWORD UPDATE ERROR:", updateErr);
                    return res.status(500).json({
                        message: updateErr.sqlMessage || updateErr.message
                    });
                }

                res.json({
                    message: "Password changed successfully"
                });
            }
        );
    });
});

module.exports = router;