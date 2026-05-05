const express = require("express");
const router = express.Router();
const db = require("../database/db");
const ExcelJS = require("exceljs");

function normalizeIdList(raw) {
    if (!raw) return [];

    let values = [];

    if (Array.isArray(raw)) {
        values = raw;
    } else if (typeof raw === "string") {
        const trimmed = raw.trim();

        if (!trimmed) return [];

        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                values = parsed;
            } else {
                values = trimmed.split(",");
            }
        } catch (error) {
            values = trimmed.split(",");
        }
    } else {
        values = [raw];
    }

    return [...new Set(
        values
            .map(value => Number(value))
            .filter(value => Number.isInteger(value) && value > 0)
    )];
}

function makeInClause(values) {
    return values.map(() => "?").join(", ");
}

function getPagination(query) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const requestedLimit = parseInt(query.limit, 10) || 25;
    const limit = [25, 50, 100].includes(requestedLimit) ? requestedLimit : 25;
    const offset = (page - 1) * limit;

    return { page, limit, offset };
}

function round2(value) {
    return Number((Number(value) || 0).toFixed(2));
}

function queryAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function getReportContext(req) {
    const { collector_id, date_from, date_to } = req.query;
    const selectedCustomerIds = normalizeIdList(req.query.selected_customer_ids);

    if (!collector_id || !date_from || !date_to) {
        const err = new Error("Please select collector, date from, and date to");
        err.status = 400;
        throw err;
    }

    if (selectedCustomerIds.length === 0) {
        const err = new Error("Please add at least one customer to the selected batch");
        err.status = 400;
        throw err;
    }

    const collectorRows = await queryAsync(
        `
            SELECT id, name, commission_percent
            FROM collectors
            WHERE id = ?
            LIMIT 1
        `,
        [collector_id]
    );

    if (collectorRows.length === 0) {
        const err = new Error("Collector not found");
        err.status = 404;
        throw err;
    }

    const inClause = makeInClause(selectedCustomerIds);

    const selectedCustomersResult = await queryAsync(
        `
            SELECT id, name, address, phone
            FROM customers
            WHERE collector_id = ?
              AND id IN (${inClause})
            ORDER BY id ASC
        `,
        [collector_id, ...selectedCustomerIds]
    );

    if (selectedCustomersResult.length === 0) {
        const err = new Error("No valid selected customers found for this collector");
        err.status = 400;
        throw err;
    }

    const validCustomerIds = selectedCustomersResult.map(row => Number(row.id));
    const validInClause = makeInClause(validCustomerIds);

    return {
        collector_id,
        date_from,
        date_to,
        collector: collectorRows[0],
        selectedCustomersResult,
        validCustomerIds,
        validInClause
    };
}

function getDetailSql(section, context, paged = true) {
    const {
        collector_id,
        date_from,
        date_to,
        validCustomerIds,
        validInClause
    } = context;

    const baseParams = [collector_id, ...validCustomerIds];

    if (section === "payments") {
        const fromSql = `
            FROM payments
            JOIN sales ON payments.sale_id = sales.id
            JOIN customers ON sales.customer_id = customers.id
            WHERE customers.collector_id = ?
              AND customers.id IN (${validInClause})
              AND LOWER(TRIM(payments.payment_type)) = 'regular'
              AND DATE(payments.payment_date) BETWEEN ? AND ?
        `;
        return {
            countSql: `SELECT COUNT(*) AS total ${fromSql}`,
            countParams: [collector_id, ...validCustomerIds, date_from, date_to],
            dataSql: `
                SELECT
                    payments.id AS payment_id,
                    customers.id AS customer_id,
                    customers.name AS customer_name,
                    payments.amount,
                    DATE_FORMAT(payments.payment_date, '%Y-%m-%d') AS payment_date,
                    payments.payment_type
                ${fromSql}
                ORDER BY payments.payment_date ASC, payments.id ASC
                ${paged ? "LIMIT ? OFFSET ?" : ""}
            `,
            dataParams: [collector_id, ...validCustomerIds, date_from, date_to]
        };
    }

    if (section === "balances") {
        const fromSql = `
            FROM sales
            JOIN customers ON sales.customer_id = customers.id
            JOIN collectors ON customers.collector_id = collectors.id
            JOIN inventory ON sales.item_id = inventory.id
            WHERE customers.collector_id = ?
              AND customers.id IN (${validInClause})
              AND sales.balance > 0
        `;
        return {
            countSql: `SELECT COUNT(*) AS total ${fromSql}`,
            countParams: baseParams,
            dataSql: `
                SELECT
                    sales.id AS sale_id,
                    customers.id AS customer_id,
                    customers.name AS customer_name,
                    inventory.item_name,
                    sales.quantity,
                    collectors.name AS collector_name,
                    sales.balance AS balance
                ${fromSql}
                ORDER BY customers.id ASC, sales.id ASC
                ${paged ? "LIMIT ? OFFSET ?" : ""}
            `,
            dataParams: baseParams
        };
    }

    if (section === "capital") {
        const fromSql = `
            FROM sales
            JOIN customers ON sales.customer_id = customers.id
            JOIN inventory ON sales.item_id = inventory.id
            WHERE customers.collector_id = ?
              AND customers.id IN (${validInClause})
        `;
        return {
            countSql: `SELECT COUNT(*) AS total ${fromSql}`,
            countParams: baseParams,
            dataSql: `
                SELECT
                    sales.id AS sale_id,
                    customers.id AS customer_id,
                    customers.name AS customer_name,
                    inventory.item_name,
                    sales.quantity,
                    inventory.capital_price,
                    (sales.quantity * inventory.capital_price) AS capital_total
                ${fromSql}
                ORDER BY customers.id ASC, sales.id ASC
                ${paged ? "LIMIT ? OFFSET ?" : ""}
            `,
            dataParams: baseParams
        };
    }

    if (section === "expenses") {
        const fromSql = `
            FROM expenses
            WHERE collector_id = ?
              AND DATE(expense_date) BETWEEN ? AND ?
        `;
        return {
            countSql: `SELECT COUNT(*) AS total ${fromSql}`,
            countParams: [collector_id, date_from, date_to],
            dataSql: `
                SELECT
                    id,
                    DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date,
                    driver_daily_wage,
                    staffs_food_allowance,
                    gasoline,
                    miscellaneous,
                    total_expense,
                    route,
                    expense_type,
                    notes
                ${fromSql}
                ORDER BY expense_date ASC, id ASC
                ${paged ? "LIMIT ? OFFSET ?" : ""}
            `,
            dataParams: [collector_id, date_from, date_to]
        };
    }

    if (section === "remits") {
        const fromSql = `
            FROM remits
            WHERE collector_id = ?
              AND DATE(remit_date) BETWEEN ? AND ?
        `;
        return {
            countSql: `SELECT COUNT(*) AS total ${fromSql}`,
            countParams: [collector_id, date_from, date_to],
            dataSql: `
                SELECT
                    id,
                    DATE_FORMAT(remit_date, '%Y-%m-%d') AS remit_date,
                    total_selected_payments,
                    gas AS gasoline,
                    food AS staffs_food_allowance,
                    miscellaneous,
                    commission_percent,
                    commission_amount,
                    gross_total,
                    cash_on_hand,
                    net_total,
                    variance_amount
                ${fromSql}
                ORDER BY remit_date ASC, id ASC
                ${paged ? "LIMIT ? OFFSET ?" : ""}
            `,
            dataParams: [collector_id, date_from, date_to]
        };
    }

    if (section === "item_ranking") {
        const fromSql = `
            FROM sales
            JOIN customers ON sales.customer_id = customers.id
            JOIN inventory ON sales.item_id = inventory.id
            WHERE customers.collector_id = ?
              AND customers.id IN (${validInClause})
            GROUP BY inventory.id, inventory.item_name
        `;
        return {
            countSql: `
                SELECT COUNT(*) AS total
                FROM (
                    SELECT inventory.id
                    ${fromSql}
                ) x
            `,
            countParams: baseParams,
            dataSql: `
                SELECT
                    inventory.id AS item_id,
                    inventory.item_name,
                    COALESCE(SUM(sales.quantity), 0) AS total_quantity_ordered,
                    COUNT(sales.id) AS total_sales_count,
                    COALESCE(SUM(sales.total), 0) AS total_selling_value,
                    COALESCE(SUM(sales.quantity * inventory.capital_price), 0) AS total_capital_value
                ${fromSql}
                ORDER BY
                    total_quantity_ordered DESC,
                    total_sales_count DESC,
                    total_selling_value DESC,
                    inventory.item_name ASC
                ${paged ? "LIMIT ? OFFSET ?" : ""}
            `,
            dataParams: baseParams
        };
    }

    const err = new Error("Invalid report detail section");
    err.status = 400;
    throw err;
}

async function getPagedDetail(section, context, page = 1, limit = 25) {
    const { offset } = { offset: (page - 1) * limit };
    const sqlParts = getDetailSql(section, context, true);

    const countRows = await queryAsync(sqlParts.countSql, sqlParts.countParams);
    const total = countRows[0]?.total || 0;
    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
    const rows = await queryAsync(sqlParts.dataSql, [...sqlParts.dataParams, limit, offset]);

    return {
        rows,
        pagination: {
            page,
            limit,
            total,
            totalPages
        }
    };
}

async function getAllDetailRows(section, context) {
    const sqlParts = getDetailSql(section, context, false);
    return queryAsync(sqlParts.dataSql, sqlParts.dataParams);
}

router.get("/collectors", (req, res) => {
    const sql = `
        SELECT id, name, commission_percent
        FROM collectors
        WHERE is_active = 1 OR is_active IS NULL
        ORDER BY name ASC
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.log("LOAD REPORT COLLECTORS ERROR:", err);
            return res.status(500).json({
                message: err.sqlMessage || err.message
            });
        }

        res.json(result);
    });
});

router.get("/search-customers", (req, res) => {
    const {
        collector_id,
        customer_id_from,
        customer_id_to,
        customer_name,
        date_from,
        date_to
    } = req.query;

    const { page, limit, offset } = getPagination(req.query);

    if (!collector_id) {
        return res.status(400).json({
            message: "Please select collector first"
        });
    }

    if (!date_from || !date_to) {
        return res.status(400).json({
            message: "Please select date from and date to"
        });
    }

    let fromSql = `
        FROM customers c
        LEFT JOIN collectors col ON c.collector_id = col.id
        LEFT JOIN sales s ON c.id = s.customer_id
        WHERE c.collector_id = ?
          AND (c.is_active = 1 OR c.is_active IS NULL)
          AND EXISTS (
              SELECT 1
              FROM sales sx
              JOIN payments px ON px.sale_id = sx.id
              WHERE sx.customer_id = c.id
                AND LOWER(TRIM(px.payment_type)) = 'regular'
                AND DATE(px.payment_date) BETWEEN ? AND ?
          )
    `;

    const params = [collector_id, date_from, date_to];

    if (customer_id_from) {
        fromSql += ` AND c.id >= ?`;
        params.push(Number(customer_id_from));
    }

    if (customer_id_to) {
        fromSql += ` AND c.id <= ?`;
        params.push(Number(customer_id_to));
    }

    if (customer_name && customer_name.trim()) {
        fromSql += ` AND c.name LIKE ?`;
        params.push(`%${customer_name.trim()}%`);
    }

    const countSql = `
        SELECT COUNT(*) AS total
        FROM (
            SELECT c.id
            ${fromSql}
            GROUP BY c.id
        ) x
    `;

    const dataSql = `
        SELECT
            c.id,
            c.name,
            c.address,
            c.phone,
            col.name AS collector_name,
            COUNT(DISTINCT s.id) AS total_sales,
            COALESCE(SUM(s.quantity), 0) AS total_items_sold,
            COALESCE(SUM(s.balance), 0) AS total_remaining_balance,
            (
                SELECT GROUP_CONCAT(
                    DISTINCT DATE_FORMAT(p2.payment_date, '%Y-%m-%d')
                    ORDER BY DATE(p2.payment_date) ASC
                    SEPARATOR ', '
                )
                FROM sales s2
                JOIN payments p2 ON p2.sale_id = s2.id
                WHERE s2.customer_id = c.id
                  AND LOWER(TRIM(p2.payment_type)) = 'regular'
                  AND DATE(p2.payment_date) BETWEEN ? AND ?
            ) AS regular_payment_dates
        ${fromSql}
        GROUP BY c.id, c.name, c.address, c.phone, col.name
        ORDER BY c.id ASC
        LIMIT ? OFFSET ?
    `;

    db.query(countSql, params, (countErr, countRows) => {
        if (countErr) {
            console.log("COUNT REPORT CUSTOMERS ERROR:", countErr);
            return res.status(500).json({
                message: countErr.sqlMessage || countErr.message
            });
        }

        const total = countRows[0]?.total || 0;
        const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

        db.query(dataSql, [date_from, date_to, ...params, limit, offset], (err, result) => {
            if (err) {
                console.log("SEARCH REPORT CUSTOMERS ERROR:", err);
                return res.status(500).json({
                    message: err.sqlMessage || err.message
                });
            }

            res.json({
                rows: result,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages
                }
            });
        });
    });
});

// Generate summary only + first page of each detail table.
// This avoids sending thousands of rows at once on Railway.
router.get("/", async (req, res) => {
    try {
        const context = await getReportContext(req);
        const { collector_id, date_from, date_to, collector, selectedCustomersResult, validCustomerIds, validInClause } = context;

        const paymentsTotalRows = await queryAsync(
            `
                SELECT IFNULL(SUM(payments.amount), 0) AS total_payments_collected
                FROM payments
                JOIN sales ON payments.sale_id = sales.id
                JOIN customers ON sales.customer_id = customers.id
                WHERE customers.collector_id = ?
                  AND customers.id IN (${validInClause})
                  AND LOWER(TRIM(payments.payment_type)) = 'regular'
                  AND DATE(payments.payment_date) BETWEEN ? AND ?
            `,
            [collector_id, ...validCustomerIds, date_from, date_to]
        );

        const balanceTotalRows = await queryAsync(
            `
                SELECT IFNULL(SUM(sales.balance), 0) AS total_remaining_balance
                FROM sales
                JOIN customers ON sales.customer_id = customers.id
                WHERE customers.collector_id = ?
                  AND customers.id IN (${validInClause})
                  AND sales.balance > 0
            `,
            [collector_id, ...validCustomerIds]
        );

        const capitalTotalRows = await queryAsync(
            `
                SELECT
                    IFNULL(SUM(sales.quantity * inventory.capital_price), 0) AS total_item_capital,
                    IFNULL(SUM(sales.quantity), 0) AS total_items_sold
                FROM sales
                JOIN customers ON sales.customer_id = customers.id
                JOIN inventory ON sales.item_id = inventory.id
                WHERE customers.collector_id = ?
                  AND customers.id IN (${validInClause})
            `,
            [collector_id, ...validCustomerIds]
        );

        const expenseTotalRows = await queryAsync(
            `
                SELECT IFNULL(SUM(total_expense), 0) AS total_expenses
                FROM expenses
                WHERE collector_id = ?
                  AND DATE(expense_date) BETWEEN ? AND ?
            `,
            [collector_id, date_from, date_to]
        );

        const remitTotalRows = await queryAsync(
            `
                SELECT
                    IFNULL(SUM(cash_on_hand), 0) AS total_cash_on_hand,
                    IFNULL(SUM(variance_amount), 0) AS total_variance
                FROM remits
                WHERE collector_id = ?
                  AND DATE(remit_date) BETWEEN ? AND ?
            `,
            [collector_id, date_from, date_to]
        );

        const topItemRows = await queryAsync(
            `
                SELECT
                    inventory.id AS item_id,
                    inventory.item_name,
                    COALESCE(SUM(sales.quantity), 0) AS total_quantity_ordered,
                    COUNT(sales.id) AS total_sales_count,
                    COALESCE(SUM(sales.total), 0) AS total_selling_value,
                    COALESCE(SUM(sales.quantity * inventory.capital_price), 0) AS total_capital_value
                FROM sales
                JOIN customers ON sales.customer_id = customers.id
                JOIN inventory ON sales.item_id = inventory.id
                WHERE customers.collector_id = ?
                  AND customers.id IN (${validInClause})
                GROUP BY inventory.id, inventory.item_name
                ORDER BY total_quantity_ordered DESC, total_sales_count DESC, total_selling_value DESC, inventory.item_name ASC
                LIMIT 1
            `,
            [collector_id, ...validCustomerIds]
        );

        const lowItemRows = await queryAsync(
            `
                SELECT
                    inventory.id AS item_id,
                    inventory.item_name,
                    COALESCE(SUM(sales.quantity), 0) AS total_quantity_ordered,
                    COUNT(sales.id) AS total_sales_count,
                    COALESCE(SUM(sales.total), 0) AS total_selling_value,
                    COALESCE(SUM(sales.quantity * inventory.capital_price), 0) AS total_capital_value
                FROM sales
                JOIN customers ON sales.customer_id = customers.id
                JOIN inventory ON sales.item_id = inventory.id
                WHERE customers.collector_id = ?
                  AND customers.id IN (${validInClause})
                GROUP BY inventory.id, inventory.item_name
                ORDER BY total_quantity_ordered ASC, total_sales_count ASC, total_selling_value ASC, inventory.item_name ASC
                LIMIT 1
            `,
            [collector_id, ...validCustomerIds]
        );

        const totalPaymentsCollected = round2(paymentsTotalRows[0]?.total_payments_collected || 0);
        const totalRemainingBalance = round2(balanceTotalRows[0]?.total_remaining_balance || 0);
        const totalItemCapital = round2(capitalTotalRows[0]?.total_item_capital || 0);
        const totalItemsSold = round2(capitalTotalRows[0]?.total_items_sold || 0);
        const totalExpenses = round2(expenseTotalRows[0]?.total_expenses || 0);
        const totalCashOnHand = round2(remitTotalRows[0]?.total_cash_on_hand || 0);
        const totalVariance = round2(remitTotalRows[0]?.total_variance || 0);
        const totalCustomers = validCustomerIds.length;
        const businessResultAmount = round2(totalPaymentsCollected - totalItemCapital - totalExpenses);

        let businessResultLabel = "Break-even";
        if (businessResultAmount > 0) businessResultLabel = "Positive";
        if (businessResultAmount < 0) businessResultLabel = "Negative";

        let collectorResultLabel = "Good";
        if (totalVariance < 0) collectorResultLabel = "Bad / Short";
        if (totalVariance > 0) collectorResultLabel = "Good (Excess)";

        const firstPageLimit = 25;
        const [payments, balances, itemRanking, capital, expenses, remits] = await Promise.all([
            getPagedDetail("payments", context, 1, firstPageLimit),
            getPagedDetail("balances", context, 1, firstPageLimit),
            getPagedDetail("item_ranking", context, 1, firstPageLimit),
            getPagedDetail("capital", context, 1, firstPageLimit),
            getPagedDetail("expenses", context, 1, firstPageLimit),
            getPagedDetail("remits", context, 1, firstPageLimit)
        ]);

        res.json({
            filters: {
                collector_id,
                collector_name: collector.name,
                commission_percent: collector.commission_percent,
                date_from,
                date_to,
                selected_customer_ids: validCustomerIds
            },
            selected_customers: selectedCustomersResult,
            summary: {
                total_payments_collected: totalPaymentsCollected,
                total_remaining_balance: totalRemainingBalance,
                total_item_capital: totalItemCapital,
                total_expenses: totalExpenses,
                total_cash_on_hand: totalCashOnHand,
                business_result_amount: businessResultAmount,
                business_result_label: businessResultLabel,
                collector_result_amount: totalVariance,
                collector_result_label: collectorResultLabel,
                total_customers: totalCustomers,
                total_items_sold: totalItemsSold,
                most_salable_item: topItemRows[0] || null,
                least_salable_item: lowItemRows[0] || null
            },
            details: {
                payments: payments.rows,
                balances: balances.rows,
                item_ranking: itemRanking.rows,
                capital: capital.rows,
                expenses: expenses.rows,
                remits: remits.rows
            },
            detail_pagination: {
                payments: payments.pagination,
                balances: balances.pagination,
                item_ranking: itemRanking.pagination,
                capital: capital.pagination,
                expenses: expenses.pagination,
                remits: remits.pagination
            }
        });
    } catch (error) {
        console.log("GENERATE REPORT ERROR:", error);
        res.status(error.status || 500).json({
            message: error.sqlMessage || error.message || "Failed to generate report"
        });
    }
});

// Paginated detail loader after report is generated.
router.get("/details/:section", async (req, res) => {
    try {
        const section = req.params.section;
        const { page, limit } = getPagination(req.query);
        const context = await getReportContext(req);
        const result = await getPagedDetail(section, context, page, limit);
        res.json(result);
    } catch (error) {
        console.log("LOAD REPORT DETAIL ERROR:", error);
        res.status(error.status || 500).json({
            message: error.sqlMessage || error.message || "Failed to load report detail"
        });
    }
});

router.post("/export-excel", async (req, res) => {
    try {
        const {
            collector_name,
            date_from,
            date_to,
            summary,
            ranking,
            interpretation,
            payments,
            selected_customers,
            filters
        } = req.body;

        let fullPayments = Array.isArray(payments) ? payments : [];
        let fullRanking = Array.isArray(ranking) ? ranking : [];

        // If filters are provided, export all matching rows instead of only the visible page.
        if (filters?.collector_id && filters?.date_from && filters?.date_to && filters?.selected_customer_ids) {
            const fakeReq = {
                query: {
                    collector_id: filters.collector_id,
                    date_from: filters.date_from,
                    date_to: filters.date_to,
                    selected_customer_ids: JSON.stringify(filters.selected_customer_ids)
                }
            };
            const context = await getReportContext(fakeReq);
            fullPayments = await getAllDetailRows("payments", context);
            fullRanking = await getAllDetailRows("item_ranking", context);
        }

        const workbook = new ExcelJS.Workbook();

        // =========================
        // SHEET 1: SUMMARY
        // =========================
        const summarySheet = workbook.addWorksheet("Report Summary");

        summarySheet.columns = [
            { header: "Field", key: "field", width: 30 },
            { header: "Value", key: "value", width: 25 }
        ];

        summarySheet.addRow({ field: "Collector", value: collector_name || "" });
        summarySheet.addRow({ field: "Date From", value: date_from || "" });
        summarySheet.addRow({ field: "Date To", value: date_to || "" });
        summarySheet.addRow({});

        summarySheet.addRow({ field: "Total Payments Collected", value: Number(summary?.total_payments_collected || 0) });
        summarySheet.addRow({ field: "Total Remaining Balance", value: Number(summary?.total_remaining_balance || 0) });
        summarySheet.addRow({ field: "Total Item Capital", value: Number(summary?.total_item_capital || 0) });
        summarySheet.addRow({ field: "Total Expenses", value: Number(summary?.total_expenses || 0) });
        summarySheet.addRow({ field: "Cash On Hand Given", value: Number(summary?.total_cash_on_hand || 0) });
        summarySheet.addRow({ field: "Business Result", value: Number(summary?.business_result_amount || 0) });
        summarySheet.addRow({ field: "Collector Result", value: Number(summary?.collector_result_amount || 0) });
        summarySheet.addRow({ field: "Commission %", value: Number(summary?.commission_percent || 0) });
        summarySheet.addRow({ field: "Total Customers", value: Number(summary?.total_customers || 0) });
        summarySheet.addRow({ field: "Total Items Sold", value: Number(summary?.total_items_sold || 0) });

        summarySheet.getRow(1).font = { bold: true };

        summarySheet.getCell("B5").numFmt = '"₱"#,##0.00';
        summarySheet.getCell("B6").numFmt = '"₱"#,##0.00';
        summarySheet.getCell("B7").numFmt = '"₱"#,##0.00';
        summarySheet.getCell("B8").numFmt = '"₱"#,##0.00';
        summarySheet.getCell("B9").numFmt = '"₱"#,##0.00';
        summarySheet.getCell("B10").numFmt = '"₱"#,##0.00';
        summarySheet.getCell("B11").numFmt = '"₱"#,##0.00';
        summarySheet.getCell("B12").numFmt = '0.00"%"';
        summarySheet.getCell("B13").numFmt = '0';
        summarySheet.getCell("B14").numFmt = '0';

        // =========================
        // SHEET 2: PAYMENTS
        // =========================
        const paymentsSheet = workbook.addWorksheet("Payments Collected");

        paymentsSheet.columns = [
            { header: "Payment ID", key: "payment_id", width: 15 },
            { header: "Customer ID", key: "customer_id", width: 15 },
            { header: "Customer Name", key: "customer_name", width: 30 },
            { header: "Amount", key: "amount", width: 15 },
            { header: "Payment Date", key: "payment_date", width: 18 },
            { header: "Type", key: "type", width: 15 }
        ];

        if (Array.isArray(fullPayments)) {
            fullPayments.forEach(payment => {
                paymentsSheet.addRow({
                    payment_id: payment.payment_id || "",
                    customer_id: payment.customer_id || "",
                    customer_name: payment.customer_name || "",
                    amount: Number(payment.amount || 0),
                    payment_date: payment.payment_date || "",
                    type: payment.payment_type || ""
                });
            });
        }

        paymentsSheet.getRow(1).font = { bold: true };
        paymentsSheet.getColumn("amount").numFmt = '"₱"#,##0.00';

        // =========================
        // SHEET 3: PRODUCT RANKING
        // =========================
        const rankingSheet = workbook.addWorksheet("Product Ranking");

        rankingSheet.columns = [
            { header: "Rank", key: "rank", width: 10 },
            { header: "Product Name", key: "product_name", width: 30 },
            { header: "Qty Sold", key: "qty_sold", width: 15 },
            { header: "Sales Count", key: "sales_count", width: 15 },
            { header: "Selling Value", key: "selling_value", width: 18 },
            { header: "Capital Value", key: "capital_value", width: 18 }
        ];

        if (Array.isArray(fullRanking)) {
            fullRanking.forEach((item, index) => {
                rankingSheet.addRow({
                    rank: index + 1,
                    product_name: item.item_name || "",
                    qty_sold: Number(item.total_quantity_ordered || 0),
                    sales_count: Number(item.total_sales_count || 0),
                    selling_value: Number(item.total_selling_value || 0),
                    capital_value: Number(item.total_capital_value || 0)
                });
            });
        }

        rankingSheet.getRow(1).font = { bold: true };
        rankingSheet.getColumn("selling_value").numFmt = '"₱"#,##0.00';
        rankingSheet.getColumn("capital_value").numFmt = '"₱"#,##0.00';

        // =========================
        // SHEET 4: SELECTED CUSTOMERS
        // =========================
        const customersSheet = workbook.addWorksheet("Selected Customers");

        customersSheet.columns = [
            { header: "Customer ID", key: "customer_id", width: 15 },
            { header: "Customer Name", key: "customer_name", width: 30 },
            { header: "Address", key: "address", width: 25 },
            { header: "Total Sales", key: "total_sales", width: 15 },
            { header: "Total Items Sold", key: "total_items_sold", width: 18 },
            { header: "Total Remaining Balance", key: "remaining_balance", width: 22 },
            { header: "Regular Payment Dates", key: "regular_payment_dates", width: 40 }
        ];

        if (Array.isArray(selected_customers)) {
            selected_customers.forEach(customer => {
                customersSheet.addRow({
                    customer_id: customer.id || customer.customer_id || "",
                    customer_name: customer.name || customer.customer_name || "",
                    address: customer.address || "",
                    total_sales: Number(customer.total_sales || 0),
                    total_items_sold: Number(customer.total_items_sold || 0),
                    remaining_balance: Number(customer.total_remaining_balance || 0),
                    regular_payment_dates: customer.regular_payment_dates || ""
                });
            });
        }

        customersSheet.getRow(1).font = { bold: true };
        customersSheet.getColumn("remaining_balance").numFmt = '"₱"#,##0.00';

        // =========================
        // SHEET 5: INTERPRETATION
        // =========================
        const interpretationSheet = workbook.addWorksheet("Interpretation");
        interpretationSheet.columns = [
            { header: "Interpretation", key: "text", width: 120 }
        ];

        if (Array.isArray(interpretation)) {
            interpretation.forEach(line => {
                interpretationSheet.addRow({ text: line });
            });
        }

        interpretationSheet.getRow(1).font = { bold: true };

        const safeCollector = (collector_name || "collector").replace(/[^a-z0-9]/gi, "_");
        const safeFrom = (date_from || "from").replace(/[^a-z0-9]/gi, "_");
        const safeTo = (date_to || "to").replace(/[^a-z0-9]/gi, "_");

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=collector_report_${safeCollector}_${safeFrom}_to_${safeTo}.xlsx`
        );

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error("Export Excel error:", error);
        res.status(500).json({ message: "Failed to export Excel report" });
    }
});

module.exports = router;
