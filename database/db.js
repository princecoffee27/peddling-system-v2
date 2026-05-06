const mysql = require("mysql2");

const db = mysql.createConnection(process.env.MYSQL_URL);

db.connect((err) => {
    if (err) {
        console.error("DB CONNECTION ERROR:", err);
        return;
    }

    console.log("Connected to MySQL");
});

module.exports = db;