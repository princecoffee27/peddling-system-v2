const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();
const db = require("../database/db");

// Login
router.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            message: "Username and password are required"
        });
    }

    const sql = `
        SELECT id, username, password, role, is_active, privileges
        FROM users
        WHERE username = ?
        LIMIT 1
    `;

    db.query(sql, [username], (err, result) => {
        if (err) {
            console.log("LOGIN ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        if (result.length === 0) {
            return res.status(401).json({
                message: "Invalid username or password"
            });
        }

        const user = result[0];

        if (Number(user.is_active) !== 1) {
            return res.status(403).json({
                message: "This account is inactive"
            });
        }

        const isMatch = bcrypt.compareSync(password, user.password);

        if (!isMatch) {
            return res.status(401).json({
                message: "Invalid username or password"
            });
        }

        let privileges = {};
        try {
            privileges = typeof user.privileges === "string"
                ? JSON.parse(user.privileges || "{}")
                : (user.privileges || {});
        } catch {
            privileges = {};
        }

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            privileges
        };

        res.json({
            message: "Login successful",
            user: req.session.user
        });
    });
});

// Check current session
router.get("/me", (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({
            message: "Not logged in"
        });
    }

    res.json({
        user: req.session.user
    });
});

// Logout
router.post("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({
                message: "Failed to logout"
            });
        }

        res.clearCookie("connect.sid");
        res.json({
            message: "Logged out successfully"
        });
    });
});

module.exports = router;