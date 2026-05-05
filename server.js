require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const session = require("express-session");

const app = express();

const customerRoutes = require("./routes/customers");
const inventoryRoutes = require("./routes/inventory");
const paymentRoutes = require("./routes/payments");
const salesRoutes = require("./routes/sales");
const collectorRoutes = require("./routes/collectors");
const newCustomerSaleRoutes = require("./routes/newCustomerSale");
const expenseRoutes = require("./routes/expenses");
const remitRoutes = require("./routes/remits");
const reportRoutes = require("./routes/reports");
const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const payablesRoutes = require("./routes/payables");
const userRoutes = require("./routes/users");

app.use(cors());
app.use(bodyParser.json({ limit: "25mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "25mb" }));

// SESSION
app.use(session({
    secret: process.env.SESSION_SECRET || "peddling_secret_key_2026",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 8
    }
}));

// AUTH ROUTES (LOGIN FIRST)
app.use("/auth", authRoutes);

// 🔐 LOGIN PROTECTION (VERY IMPORTANT)
app.use((req, res, next) => {
    const openPaths = [
        "/login.html",
        "/auth/login",
        "/auth/logout",
        "/auth/me"
    ];

    if (openPaths.includes(req.path)) {
        return next();
    }

    if (!req.session.user) {
        return res.redirect("/login.html");
    }

    next();
});

// ✅ MOVE STATIC HERE (AFTER LOGIN CHECK)
app.use(express.static("public"));

// API ROUTES
app.use("/customers", customerRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/payments", paymentRoutes);
app.use("/sales", salesRoutes);
app.use("/collectors", collectorRoutes);
app.use("/new-customer-sale", newCustomerSaleRoutes);
app.use("/expenses", expenseRoutes);
app.use("/remits", remitRoutes);
app.use("/reports", reportRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/payables", payablesRoutes);
app.use("/users", userRoutes);

// PROTECTED HOME
app.get("/", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login.html");
    }
    res.sendFile(__dirname + "/public/index.html");
});

// EXTRA PROTECTION (VERY IMPORTANT)
app.get("/index.html", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login.html");
    }
    res.sendFile(__dirname + "/public/index.html");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});