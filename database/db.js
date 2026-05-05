const mysql = require("mysql2");

const db = mysql.createPool({
    uri: process.env.MYSQL_URL,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err, connection) => {
    if (err) {
        console.error("DB CONNECTION ERROR:", err);
    } else {
        console.log("Connected to MySQL pool");
        connection.release();
    }
});

module.exports = db;