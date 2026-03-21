const mysql = require("mysql2");

const db = mysql.createConnection({
    host: process.env.MYSQLHOST || "localhost",
    user: process.env.MYSQLUSER || "root",
    password: process.env.MYSQLPASSWORD || "071570",
    database: process.env.MYSQLDATABASE || "peddling_db",
    port: process.env.MYSQLPORT ? Number(process.env.MYSQLPORT) : 3306
});

db.connect((err) => {
    if (err) {
        console.error("MySQL connection error:", err.message);
        return;
    }
    console.log("MySQL Connected");
});

module.exports = db;