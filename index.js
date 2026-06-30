require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const port = 3000;

// Configuration de la base de données
let dbUrl = process.env.DATABASE_URL;
if (dbUrl) {
  // Retirer les paramètres spécifiques non supportés de manière standard par le driver pg
  dbUrl = dbUrl
    .replace("?channel_binding=require", "")
    .replace("&channel_binding=require", "");
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Gérer les erreurs inattendues sur les clients inactifs (évite que le serveur crash)
pool.on("error", (err, client) => {
  console.error("Erreur inattendue sur le client PostgreSQL", err);
});

pool.connect((err) => {
  if (err) {
    console.error("Impossible de se connecter à la base de données:", err);
    process.exit(1);
  }
  console.log("Vous êtes connecté à votre base de données");

  // Création de la table si elle n'existe pas
  // Création de la table sync_logs
  const createSyncLogsQuery = `
        CREATE TABLE IF NOT EXISTS sync_logs (
            id SERIAL PRIMARY KEY,
            sync_id BIGINT NOT NULL,
            entity VARCHAR(255) NOT NULL,
            entity_id BIGINT NOT NULL,
            action VARCHAR(50) NOT NULL,
            payload JSONB NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;

  pool.query(createSyncLogsQuery, (err) => {
    if (err) console.error("Impossible de créer la table sync_logs:", err);
  });

  // Création de la table remote_sales
  const createSalesQuery = `
        CREATE TABLE IF NOT EXISTS remote_sales (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            customer_id BIGINT,
            user_id BIGINT,
            cash_session_id BIGINT,
            total_amount DECIMAL(10, 2) NOT NULL,
            total_tax DECIMAL(10, 2) NOT NULL,
            total_discount DECIMAL(10, 2) NOT NULL,
            amount_tendered DECIMAL(10, 2) NOT NULL,
            amount_change DECIMAL(10, 2) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;

  // Création de la table remote_sale_items
  const createSaleItemsQuery = `
        CREATE TABLE IF NOT EXISTS remote_sale_items (
            id SERIAL PRIMARY KEY,
            remote_sale_id BIGINT NOT NULL REFERENCES remote_sales(id),
            product_id BIGINT NOT NULL,
            quantity BIGINT NOT NULL,
            unit_price DECIMAL(10, 2) NOT NULL,
            discount DECIMAL(10, 2) NOT NULL,
            tax_rate DECIMAL(10, 2) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;

  pool.query(createSalesQuery, (err) => {
    if (err) {
      console.error("Impossible de créer la table remote_sales:", err);
    } else {
      pool.query(createSaleItemsQuery, (err) => {
        if (err)
          console.error("Impossible de créer la table remote_sale_items:", err);
      });
    }
  });

  // Création de la table remote_products
  const createProductsQuery = `
        CREATE TABLE IF NOT EXISTS remote_products (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            product_code VARCHAR(100),
            barcode VARCHAR(100),
            name VARCHAR(255) NOT NULL,
            generic_name VARCHAR(255),
            dosage VARCHAR(100),
            pharmaceutical_form VARCHAR(100),
            category_id BIGINT,
            manufacturer_id BIGINT,
            unit_id BIGINT,
            purchase_price DECIMAL(10, 2),
            sale_price DECIMAL(10, 2) NOT NULL,
            wholesale_price DECIMAL(10, 2),
            minimum_stock BIGINT,
            maximum_stock BIGINT,
            tax_rate DECIMAL(10, 2),
            requires_prescription BOOLEAN DEFAULT false,
            is_controlled_substance BOOLEAN DEFAULT false,
            description TEXT,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;

  pool.query(createProductsQuery, (err) => {
    if (err)
      console.error("Impossible de créer la table remote_products:", err);
  });

  // Création de la table remote_stock_movements
  const createStockMovementsQuery = `
        CREATE TABLE IF NOT EXISTS remote_stock_movements (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            product_id BIGINT NOT NULL,
            batch_number VARCHAR(100),
            expiration_date DATE,
            quantity BIGINT NOT NULL,
            user_id BIGINT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;

  pool.query(createStockMovementsQuery, (err) => {
    if (err)
      console.error(
        "Impossible de créer la table remote_stock_movements:",
        err,
      );
  });

  // Création de la table remote_cash_sessions
  const createCashSessionsQuery = `
        CREATE TABLE IF NOT EXISTS remote_cash_sessions (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            cash_register_id BIGINT NOT NULL,
            opened_by BIGINT NOT NULL,
            opening_balance DECIMAL(10, 2) NOT NULL,
            status VARCHAR(50) NOT NULL,
            opened_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            closed_at TIMESTAMP WITH TIME ZONE,
            closed_by BIGINT,
            expected_amount DECIMAL(10, 2),
            counted_amount DECIMAL(10, 2),
            difference DECIMAL(10, 2),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;

  pool.query(createCashSessionsQuery, (err) => {
    if (err)
      console.error("Impossible de créer la table remote_cash_sessions:", err);
  });

  // Création de la table remote_audit_logs
  const createAuditLogsQuery = `
        CREATE TABLE IF NOT EXISTS remote_audit_logs (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            user_id BIGINT,
            entity_name VARCHAR(255) NOT NULL,
            entity_id BIGINT NOT NULL,
            action VARCHAR(50) NOT NULL,
            old_values TEXT,
            new_values TEXT,
            ip_address VARCHAR(100),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;

  pool.query(createAuditLogsQuery, (err) => {
    if (err)
      console.error("Impossible de créer la table remote_audit_logs:", err);
  });

  // Création de la table remote_employees
  const createEmployeesQuery = `
        CREATE TABLE IF NOT EXISTS remote_employees (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            employee_code VARCHAR(100),
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            gender VARCHAR(20),
            birth_date DATE,
            phone VARCHAR(50),
            email VARCHAR(255),
            address TEXT,
            hire_date DATE,
            position VARCHAR(100),
            department_id BIGINT,
            salary DECIMAL(10, 2),
            status VARCHAR(50) DEFAULT 'active',
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;
  pool.query(createEmployeesQuery, (err) => {
    if (err) console.error(err);
  });

  // Création de la table remote_users
  const createUsersQuery = `
        CREATE TABLE IF NOT EXISTS remote_users (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            username VARCHAR(100) NOT NULL,
            email VARCHAR(255) NOT NULL,
            password_hash VARCHAR(255),
            first_name VARCHAR(100),
            last_name VARCHAR(100),
            phone VARCHAR(50),
            employee_id BIGINT,
            role_id BIGINT,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;
  pool.query(createUsersQuery, (err) => {
    if (err) console.error(err);
  });

  // Création de la table remote_inventories
  const createInventoriesQuery = `
        CREATE TABLE IF NOT EXISTS remote_inventories (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            completed_by BIGINT,
            status VARCHAR(50) DEFAULT 'completed',
            completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;
  pool.query(createInventoriesQuery, (err) => {
    if (err) console.error(err);
  });

  const createInventoryItemsQuery = `
        CREATE TABLE IF NOT EXISTS remote_inventory_items (
            id SERIAL PRIMARY KEY,
            remote_inventory_id BIGINT REFERENCES remote_inventories(id),
            product_id BIGINT NOT NULL,
            theoretical_quantity BIGINT NOT NULL,
            physical_quantity BIGINT NOT NULL,
            difference BIGINT NOT NULL
        );
    `;
  pool.query(createInventoryItemsQuery, (err) => {
    if (err) console.error(err);
  });

  // Création de la table remote_suppliers
  const createSuppliersQuery = `
        CREATE TABLE IF NOT EXISTS remote_suppliers (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            supplier_code VARCHAR(100),
            company_name VARCHAR(255) NOT NULL,
            contact_name VARCHAR(255),
            phone VARCHAR(50),
            email VARCHAR(255),
            address TEXT,
            tax_number VARCHAR(100),
            notes TEXT,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;
  pool.query(createSuppliersQuery, (err) => {
    if (err) console.error(err);
  });

  // Création de la table remote_purchase_orders
  const createPurchaseOrdersQuery = `
        CREATE TABLE IF NOT EXISTS remote_purchase_orders (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            order_number VARCHAR(100),
            supplier_id BIGINT,
            status VARCHAR(50) DEFAULT 'draft',
            order_date DATE,
            expected_date DATE,
            total_amount DECIMAL(15, 2),
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;

  const createPurchaseOrderItemsQuery = `
        CREATE TABLE IF NOT EXISTS remote_purchase_order_items (
            id SERIAL PRIMARY KEY,
            remote_order_id BIGINT REFERENCES remote_purchase_orders(id),
            product_id BIGINT NOT NULL,
            quantity BIGINT NOT NULL,
            purchase_price DECIMAL(15, 2),
            total DECIMAL(15, 2)
        );
    `;

  pool.query(createPurchaseOrdersQuery, (err) => {
    if (err) {
      console.error(err);
    } else {
      pool.query(createPurchaseOrderItemsQuery, (err) => {
        if (err) console.error(err);
      });
    }
  });

  const createCustomersQuery = `
        CREATE TABLE IF NOT EXISTS remote_customers (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            customer_code VARCHAR(100),
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            phone VARCHAR(50),
            email VARCHAR(255),
            address TEXT,
            loyalty_points INTEGER DEFAULT 0,
            credit_limit DECIMAL(10, 2) DEFAULT 0,
            current_credit DECIMAL(10, 2) DEFAULT 0
        );
    `;
  pool.query(createCustomersQuery, (err) => {
    if (err) console.error(err);
  });

  const createInsuranceCompaniesQuery = `
        CREATE TABLE IF NOT EXISTS remote_insurance_companies (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(50),
            email VARCHAR(255),
            address TEXT
        );
    `;
  pool.query(createInsuranceCompaniesQuery, (err) => {
    if (err) console.error(err);
  });

  const createInsuranceContractsQuery = `
        CREATE TABLE IF NOT EXISTS remote_insurance_contracts (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            customer_id BIGINT,
            insurance_company_id BIGINT,
            contract_number VARCHAR(100),
            coverage_rate DECIMAL(5, 2),
            coverage_limit DECIMAL(10, 2)
        );
    `;
  pool.query(createInsuranceContractsQuery, (err) => {
    if (err) console.error(err);
  });

  const createSalesQuery2 = `
        CREATE TABLE IF NOT EXISTS remote_sales (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            customer_id BIGINT,
            user_id BIGINT,
            cash_session_id BIGINT,
            total_amount DECIMAL(15, 2),
            total_discount DECIMAL(15, 2),
            total_tax DECIMAL(15, 2),
            amount_tendered DECIMAL(15, 2),
            amount_change DECIMAL(15, 2),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;
  const createSaleItemsQuery2 = `
        CREATE TABLE IF NOT EXISTS remote_sale_items (
            id SERIAL PRIMARY KEY,
            remote_sale_id BIGINT REFERENCES remote_sales(id),
            product_id BIGINT NOT NULL,
            quantity BIGINT NOT NULL,
            unit_price DECIMAL(15, 2),
            discount DECIMAL(15, 2),
            tax_rate DECIMAL(5, 2)
        );
    `;

  const createPaymentsQuery = `
        CREATE TABLE IF NOT EXISTS remote_payments (
            id SERIAL PRIMARY KEY,
            remote_sale_id BIGINT REFERENCES remote_sales(id),
            method VARCHAR(50),
            amount DECIMAL(15, 2)
        );
    `;

  pool.query(createSalesQuery2, (err) => {
    if (err) {
      console.error(err);
    } else {
      pool.query(createSaleItemsQuery2, (err) => {
        if (err) console.error(err);
      });
      pool.query(createPaymentsQuery, (err) => {
        if (err) console.error(err);
      });
    }
  });

  const createSaleReturnsQuery = `
        CREATE TABLE IF NOT EXISTS remote_sale_returns (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            sale_id BIGINT NOT NULL,
            reason TEXT,
            refund_method VARCHAR(50),
            user_id BIGINT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;
  pool.query(createSaleReturnsQuery, (err) => {
    if (err) console.error(err);
  });

  const createSaleReturnItemsQuery = `
        CREATE TABLE IF NOT EXISTS remote_sale_return_items (
            id SERIAL PRIMARY KEY,
            remote_return_id BIGINT REFERENCES remote_sale_returns(id),
            sale_item_id BIGINT,
            product_id BIGINT,
            quantity BIGINT,
            unit_price DECIMAL(15, 2)
        );
    `;
  pool.query(createSaleReturnItemsQuery, (err) => {
    if (err) console.error(err);
  });

  const createPrescriptionsQuery = `
        CREATE TABLE IF NOT EXISTS remote_prescriptions (
            id SERIAL PRIMARY KEY,
            local_id BIGINT NOT NULL,
            customer_id BIGINT,
            doctor_name VARCHAR(255),
            doctor_phone VARCHAR(50),
            prescription_date DATE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;
  pool.query(createPrescriptionsQuery, (err) => {
    if (err) console.error(err);
  });

  const createPrescriptionItemsQuery = `
        CREATE TABLE IF NOT EXISTS remote_prescription_items (
            id SERIAL PRIMARY KEY,
            remote_prescription_id BIGINT REFERENCES remote_prescriptions(id),
            product_id BIGINT NOT NULL,
            dosage TEXT,
            quantity BIGINT
        );
    `;
  pool.query(createPrescriptionItemsQuery, (err) => {
    if (err) console.error(err);
  });
});

// Middlewares
app.use(cors());
app.use(express.json());

// Middleware d'authentification supprimé pour autoriser les requêtes sans Bearer token

// Routes
app.get("/v1/ping", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/v1/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "healthy", database: "connected" });
  } catch (e) {
    console.error("Health check de la base de données a échoué:", e);
    res.status(503).json({ status: "unhealthy", database: "disconnected" });
  }
});

app.post("/v1/sync", async (req, res) => {
  const payload = req.body;

  if (!payload || !Array.isArray(payload.items)) {
    return res
      .status(400)
      .json({ error: "Format invalide, 'items' est requis" });
  }

  console.log(
    `Reçu une requête de synchronisation avec ${payload.items.length} éléments`,
  );

  try {
    for (const item of payload.items) {
      console.log(
        `-> Traitement: ${item.action} sur ${item.entity} #${item.entity_id}`,
      );

      // 1. Toujours enregistrer dans le journal des événements (Audit)
      const insertSyncLogQuery = `
                INSERT INTO sync_logs (sync_id, entity, entity_id, action, payload)
                VALUES ($1, $2, $3, $4, $5)
            `;
      const syncLogValues = [
        item.sync_id,
        item.entity,
        item.entity_id,
        item.action,
        JSON.stringify(item.payload),
      ];
      await pool.query(insertSyncLogQuery, syncLogValues);

      // 2. Routage vers les tables spécifiques
      switch (item.entity) {
        case "sales":
          if (item.action === "CREATE") {
            const sale = item.payload;
            const insertSaleQuery = `
              INSERT INTO remote_sales (
                local_id, customer_id, user_id, cash_session_id, 
                total_amount, total_tax, total_discount, amount_tendered, amount_change
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id;
            `;
            const saleValues = [
              item.entity_id,
              sale.customer_id,
              sale.user_id,
              sale.cash_session_id,
              sale.total_amount,
              sale.total_tax,
              sale.total_discount,
              sale.amount_tendered,
              sale.amount_change,
            ];

            const saleResult = await pool.query(insertSaleQuery, saleValues);
            const remoteSaleId = saleResult.rows[0].id;

            // Insérer les lignes (items)
            if (sale.items && Array.isArray(sale.items)) {
              for (const saleItem of sale.items) {
                const insertItemQuery = `
                  INSERT INTO remote_sale_items (
                    remote_sale_id, product_id, quantity, unit_price, discount, tax_rate
                  ) VALUES ($1, $2, $3, $4, $5, $6);
                `;
                const itemValues = [
                  remoteSaleId,
                  saleItem.product_id,
                  saleItem.quantity,
                  saleItem.unit_price,
                  saleItem.discount,
                  saleItem.tax_rate,
                ];
                await pool.query(insertItemQuery, itemValues);
              }
            }
          }
          break;

        case "products":
          if (item.action === "CREATE") {
            const product = item.payload;
            const insertProductQuery = `
              INSERT INTO remote_products (
                local_id, product_code, barcode, name, generic_name, dosage, pharmaceutical_form,
                category_id, manufacturer_id, unit_id, purchase_price, sale_price, wholesale_price,
                minimum_stock, maximum_stock, tax_rate, requires_prescription, is_controlled_substance,
                description, is_active
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, true);
            `;
            const productValues = [
              item.entity_id,
              product.product_code,
              product.barcode,
              product.name,
              product.generic_name,
              product.dosage,
              product.pharmaceutical_form,
              product.category_id,
              product.manufacturer_id,
              product.unit_id,
              product.purchase_price,
              product.sale_price,
              product.wholesale_price,
              product.minimum_stock,
              product.maximum_stock,
              product.tax_rate,
              product.requires_prescription,
              product.is_controlled_substance,
              product.description,
            ];
            await pool.query(insertProductQuery, productValues);
          } else if (item.action === "UPDATE") {
            const product = item.payload;
            const updateProductQuery = `
              UPDATE remote_products SET
                product_code = $2, barcode = $3, name = $4, generic_name = $5, dosage = $6, pharmaceutical_form = $7,
                category_id = $8, manufacturer_id = $9, unit_id = $10, purchase_price = $11, sale_price = $12, wholesale_price = $13,
                minimum_stock = $14, maximum_stock = $15, tax_rate = $16, requires_prescription = $17, is_controlled_substance = $18,
                description = $19, updated_at = CURRENT_TIMESTAMP
              WHERE local_id = $1;
            `;
            const productValues = [
              item.entity_id,
              product.product_code,
              product.barcode,
              product.name,
              product.generic_name,
              product.dosage,
              product.pharmaceutical_form,
              product.category_id,
              product.manufacturer_id,
              product.unit_id,
              product.purchase_price,
              product.sale_price,
              product.wholesale_price,
              product.minimum_stock,
              product.maximum_stock,
              product.tax_rate,
              product.requires_prescription,
              product.is_controlled_substance,
              product.description,
            ];
            await pool.query(updateProductQuery, productValues);
          } else if (item.action === "DELETE") {
            const deleteProductQuery = `UPDATE remote_products SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE local_id = $1;`;
            await pool.query(deleteProductQuery, [item.entity_id]);
          }
          break;

        case "stock_movements":
          if (item.action === "CREATE") {
            const movement = item.payload;
            const insertMovementQuery = `
              INSERT INTO remote_stock_movements (
                local_id, product_id, batch_number, expiration_date, quantity, user_id
              ) VALUES ($1, $2, $3, $4, $5, $6);
            `;
            const movementValues = [
              item.entity_id,
              movement.product_id,
              movement.batch_number,
              movement.expiration_date,
              movement.quantity,
              movement.user_id,
            ];
            await pool.query(insertMovementQuery, movementValues);
          }
          break;

        case "cash_sessions":
          if (item.action === "CREATE") {
            const session = item.payload;
            const insertSessionQuery = `
              INSERT INTO remote_cash_sessions (
                local_id, cash_register_id, opened_by, opening_balance, status, opened_at
              ) VALUES ($1, $2, $3, $4, 'open', CURRENT_TIMESTAMP);
            `;
            const sessionValues = [
              item.entity_id,
              session.cash_register_id,
              session.opened_by,
              session.opening_balance,
            ];
            await pool.query(insertSessionQuery, sessionValues);
          } else if (item.action === "UPDATE") {
            const closure = item.payload;
            const updateSessionQuery = `
              UPDATE remote_cash_sessions SET
                status = 'closed',
                closed_at = CURRENT_TIMESTAMP,
                closed_by = $2,
                counted_amount = $3,
                updated_at = CURRENT_TIMESTAMP
              WHERE local_id = $1;
            `;
            const closureValues = [
              item.entity_id,
              closure.closed_by,
              closure.counted_amount,
            ];
            await pool.query(updateSessionQuery, closureValues);
          }
          break;

        case "audit_logs":
          if (item.action === "CREATE") {
            const audit = item.payload;
            const insertAuditQuery = `
              INSERT INTO remote_audit_logs (
                local_id, user_id, entity_name, entity_id, action, old_values, new_values, ip_address
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
            `;
            const auditValues = [
              item.entity_id,
              audit.user_id,
              audit.entity_name,
              audit.entity_id,
              audit.action,
              audit.old_values,
              audit.new_values,
              audit.ip_address,
            ];
            await pool.query(insertAuditQuery, auditValues);
          }
          break;

        case "employees":
          if (item.action === "CREATE") {
            const emp = item.payload;
            await pool.query(
              `
              INSERT INTO remote_employees (
                local_id, employee_code, first_name, last_name, gender, birth_date, phone, email, address,
                hire_date, position, department_id, salary, status
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
            `,
              [
                item.entity_id,
                emp.employee_code,
                emp.first_name,
                emp.last_name,
                emp.gender,
                emp.birth_date,
                emp.phone,
                emp.email,
                emp.address,
                emp.hire_date,
                emp.position,
                emp.department_id,
                emp.salary,
                emp.status,
              ],
            );
          } else if (item.action === "UPDATE") {
            const emp = item.payload;
            await pool.query(
              `
              UPDATE remote_employees SET
                employee_code = $2, first_name = $3, last_name = $4, gender = $5, birth_date = $6, phone = $7, email = $8, address = $9,
                hire_date = $10, position = $11, department_id = $12, salary = $13, status = $14, updated_at = CURRENT_TIMESTAMP
              WHERE local_id = $1;
            `,
              [
                item.entity_id,
                emp.employee_code,
                emp.first_name,
                emp.last_name,
                emp.gender,
                emp.birth_date,
                emp.phone,
                emp.email,
                emp.address,
                emp.hire_date,
                emp.position,
                emp.department_id,
                emp.salary,
                emp.status,
              ],
            );
          } else if (item.action === "DELETE") {
            await pool.query(
              `UPDATE remote_employees SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE local_id = $1;`,
              [item.entity_id],
            );
          }
          break;

        case "users":
          if (item.action === "CREATE") {
            const user = item.payload;
            await pool.query(
              `
              INSERT INTO remote_users (
                local_id, username, email, password_hash, first_name, last_name, phone, employee_id, role_id
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
            `,
              [
                item.entity_id,
                user.username,
                user.email,
                user.password_hash,
                user.first_name,
                user.last_name,
                user.phone,
                user.employee_id,
                user.role_id,
              ],
            );
          } else if (item.action === "UPDATE") {
            const user = item.payload;
            await pool.query(
              `
              UPDATE remote_users SET
                email = $2, first_name = $3, last_name = $4, phone = $5, role_id = $6, is_active = $7, updated_at = CURRENT_TIMESTAMP
              WHERE local_id = $1;
            `,
              [
                item.entity_id,
                user.email,
                user.first_name,
                user.last_name,
                user.phone,
                user.role_id,
                user.is_active,
              ],
            );
          } else if (item.action === "DELETE") {
            await pool.query(
              `UPDATE remote_users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE local_id = $1;`,
              [item.entity_id],
            );
          }
          break;

        case "inventories":
          if (item.action === "COMPLETED") {
            const inv = item.payload;
            const insertInvQuery = `
              INSERT INTO remote_inventories (local_id, completed_by) VALUES ($1, $2) RETURNING id;
            `;
            const result = await pool.query(insertInvQuery, [
              item.entity_id,
              inv.completed_by,
            ]);
            const remoteInvId = result.rows[0].id;

            if (inv.items && Array.isArray(inv.items)) {
              for (const i of inv.items) {
                await pool.query(
                  `
                  INSERT INTO remote_inventory_items (remote_inventory_id, product_id, theoretical_quantity, physical_quantity, difference)
                  VALUES ($1, $2, $3, $4, $5)
                `,
                  [
                    remoteInvId,
                    i.product_id,
                    i.theoretical_quantity,
                    i.physical_quantity,
                    i.difference,
                  ],
                );
              }
            }
          }
          break;

        case "suppliers":
          if (item.action === "CREATE") {
            const sup = item.payload;
            await pool.query(
              `
              INSERT INTO remote_suppliers (
                local_id, supplier_code, company_name, contact_name, phone, email, address, tax_number, notes
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
            `,
              [
                item.entity_id,
                sup.supplier_code,
                sup.company_name,
                sup.contact_name,
                sup.phone,
                sup.email,
                sup.address,
                sup.tax_number,
                sup.notes,
              ],
            );
          } else if (item.action === "UPDATE") {
            const sup = item.payload;
            await pool.query(
              `
              UPDATE remote_suppliers SET
                supplier_code = $2, company_name = $3, contact_name = $4, phone = $5, email = $6, address = $7, tax_number = $8, notes = $9, updated_at = CURRENT_TIMESTAMP
              WHERE local_id = $1;
            `,
              [
                item.entity_id,
                sup.supplier_code,
                sup.company_name,
                sup.contact_name,
                sup.phone,
                sup.email,
                sup.address,
                sup.tax_number,
                sup.notes,
              ],
            );
          } else if (item.action === "DELETE") {
            await pool.query(
              `UPDATE remote_suppliers SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE local_id = $1;`,
              [item.entity_id],
            );
          }
          break;

        case "purchase_orders":
          if (item.action === "CREATE") {
            const po = item.payload;
            const res = await pool.query(
              `
              INSERT INTO remote_purchase_orders (
                local_id, order_number, supplier_id, status, order_date, expected_date, total_amount
              ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id;
            `,
              [
                item.entity_id,
                po.order_number,
                po.supplier_id,
                po.status,
                po.order_date || null,
                po.expected_date || null,
                po.total_amount,
              ],
            );

            const remoteOrderId = res.rows[0].id;
            if (po.items && Array.isArray(po.items)) {
              for (const i of po.items) {
                await pool.query(
                  `
                  INSERT INTO remote_purchase_order_items (remote_order_id, product_id, quantity, purchase_price, total)
                  VALUES ($1, $2, $3, $4, $5)
                `,
                  [
                    remoteOrderId,
                    i.product_id,
                    i.quantity,
                    i.purchase_price,
                    i.total,
                  ],
                );
              }
            }
          } else if (item.action === "UPDATE") {
            const po = item.payload;
            const res = await pool.query(
              `
              UPDATE remote_purchase_orders SET
                supplier_id = $2, status = $3, order_date = $4, expected_date = $5, total_amount = $6, updated_at = CURRENT_TIMESTAMP
              WHERE local_id = $1 RETURNING id;
            `,
              [
                item.entity_id,
                po.supplier_id,
                po.status,
                po.order_date || null,
                po.expected_date || null,
                po.total_amount,
              ],
            );

            if (res.rows.length > 0) {
              const remoteOrderId = res.rows[0].id;
              await pool.query(
                `DELETE FROM remote_purchase_order_items WHERE remote_order_id = $1`,
                [remoteOrderId],
              );
              if (po.items && Array.isArray(po.items)) {
                for (const i of po.items) {
                  await pool.query(
                    `
                    INSERT INTO remote_purchase_order_items (remote_order_id, product_id, quantity, purchase_price, total)
                    VALUES ($1, $2, $3, $4, $5)
                  `,
                    [
                      remoteOrderId,
                      i.product_id,
                      i.quantity,
                      i.purchase_price,
                      i.total,
                    ],
                  );
                }
              }
            }
          } else if (item.action === "UPDATE_STATUS") {
            const po = item.payload;
            await pool.query(
              `UPDATE remote_purchase_orders SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE local_id = $1;`,
              [item.entity_id, po.status],
            );
          } else if (item.action === "RECEIVE") {
            await pool.query(
              `UPDATE remote_purchase_orders SET status = 'received', updated_at = CURRENT_TIMESTAMP WHERE local_id = $1;`,
              [item.entity_id],
            );
          } else if (item.action === "DELETE") {
            await pool.query(
              `UPDATE remote_purchase_orders SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE local_id = $1;`,
              [item.entity_id],
            );
          }
          break;

        case "customers":
          if (item.action === "CREATE") {
            const cus = item.payload;
            await pool.query(
              `
              INSERT INTO remote_customers (
                local_id, customer_code, first_name, last_name, phone, email, address
              ) VALUES ($1, $2, $3, $4, $5, $6, $7);
            `,
              [
                item.entity_id,
                cus.customer_code,
                cus.first_name,
                cus.last_name,
                cus.phone,
                cus.email,
                cus.address,
              ],
            );
          }
          break;

        case "insurance_companies":
          if (item.action === "CREATE") {
            const ic = item.payload;
            await pool.query(
              `
              INSERT INTO remote_insurance_companies (
                local_id, name, phone, email, address
              ) VALUES ($1, $2, $3, $4, $5);
            `,
              [item.entity_id, ic.name, ic.phone, ic.email, ic.address],
            );
          }
          break;

        case "insurance_contracts":
          if (item.action === "CREATE") {
            const ic = item.payload;
            await pool.query(
              `
              INSERT INTO remote_insurance_contracts (
                local_id, customer_id, insurance_company_id, contract_number, coverage_rate, coverage_limit
              ) VALUES ($1, $2, $3, $4, $5, $6);
            `,
              [
                item.entity_id,
                ic.customer_id,
                ic.insurance_company_id,
                ic.contract_number,
                ic.coverage_rate,
                ic.coverage_limit,
              ],
            );
          }
          break;

        case "sales":
          if (item.action === "CREATE") {
            const sale = item.payload;
            const res = await pool.query(
              `
              INSERT INTO remote_sales (
                local_id, customer_id, user_id, cash_session_id, total_amount, total_discount, total_tax, amount_tendered, amount_change
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id;
            `,
              [
                item.entity_id,
                sale.customer_id,
                sale.user_id,
                sale.cash_session_id,
                sale.total_amount,
                sale.total_discount,
                sale.total_tax,
                sale.amount_tendered,
                sale.amount_change,
              ],
            );

            const remoteSaleId = res.rows[0].id;

            if (sale.items && Array.isArray(sale.items)) {
              for (const i of sale.items) {
                await pool.query(
                  `
                  INSERT INTO remote_sale_items (remote_sale_id, product_id, quantity, unit_price, discount, tax_rate)
                  VALUES ($1, $2, $3, $4, $5, $6)
                `,
                  [
                    remoteSaleId,
                    i.product_id,
                    i.quantity,
                    i.unit_price,
                    i.discount,
                    i.tax_rate,
                  ],
                );
              }
            }

            if (sale.payments && Array.isArray(sale.payments)) {
              for (const p of sale.payments) {
                await pool.query(
                  `
                  INSERT INTO remote_payments (remote_sale_id, method, amount)
                  VALUES ($1, $2, $3)
                `,
                  [remoteSaleId, p.method, p.amount],
                );
              }
            }
          }
          break;

        case "sale_returns":
          if (item.action === "CREATE") {
            const ret = item.payload;
            const res = await pool.query(
              `
              INSERT INTO remote_sale_returns (
                local_id, sale_id, reason, refund_method, user_id
              ) VALUES ($1, $2, $3, $4, $5) RETURNING id;
            `,
              [
                item.entity_id,
                ret.sale_id,
                ret.reason,
                ret.refund_method,
                ret.user_id,
              ],
            );

            const remoteReturnId = res.rows[0].id;

            if (ret.items && Array.isArray(ret.items)) {
              for (const i of ret.items) {
                await pool.query(
                  `
                  INSERT INTO remote_sale_return_items (remote_return_id, sale_item_id, product_id, quantity, unit_price)
                  VALUES ($1, $2, $3, $4, $5)
                `,
                  [
                    remoteReturnId,
                    i.sale_item_id,
                    i.product_id,
                    i.quantity,
                    i.unit_price,
                  ],
                );
              }
            }
          }
          break;

        case "prescriptions":
          if (item.action === "CREATE") {
            const pres = item.payload;
            const res = await pool.query(
              `
              INSERT INTO remote_prescriptions (
                local_id, customer_id, doctor_name, doctor_phone, prescription_date
              ) VALUES ($1, $2, $3, $4, $5) RETURNING id;
            `,
              [
                item.entity_id,
                pres.customer_id,
                pres.doctor_name,
                pres.doctor_phone,
                pres.prescription_date,
              ],
            );

            const remotePresId = res.rows[0].id;

            if (pres.items && Array.isArray(pres.items)) {
              for (const i of pres.items) {
                await pool.query(
                  `
                  INSERT INTO remote_prescription_items (remote_prescription_id, product_id, dosage, quantity)
                  VALUES ($1, $2, $3, $4)
                `,
                  [remotePresId, i.product_id, i.dosage, i.quantity],
                );
              }
            }
          }
          break;

        // On pourrait ajouter d'autres cas: case "customers", etc.
      }
    }

    res
      .status(200)
      .json({ status: "success", message: "Données synchronisées" });
  } catch (e) {
    console.error("Erreur lors de l'insertion en base:", e);
    res.status(500).json({ error: "Erreur serveur interne" });
  }
});

// Démarrage du serveur
app.listen(port, () => {
  console.log(`Serveur central démarré sur http://localhost:${port}`);
});
