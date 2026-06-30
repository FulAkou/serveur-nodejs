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

  pool.query(createSalesQuery, (err) => {
    if (err) console.error("Impossible de créer la table remote_sales:", err);
  });

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

  pool.query(createSaleItemsQuery, (err) => {
    if (err)
      console.error("Impossible de créer la table remote_sale_items:", err);
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
    if (err) console.error("Impossible de créer la table remote_products:", err);
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
    if (err) console.error("Impossible de créer la table remote_stock_movements:", err);
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
              item.entity_id, product.product_code, product.barcode, product.name, product.generic_name, product.dosage, product.pharmaceutical_form,
              product.category_id, product.manufacturer_id, product.unit_id, product.purchase_price, product.sale_price, product.wholesale_price,
              product.minimum_stock, product.maximum_stock, product.tax_rate, product.requires_prescription, product.is_controlled_substance,
              product.description
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
              item.entity_id, product.product_code, product.barcode, product.name, product.generic_name, product.dosage, product.pharmaceutical_form,
              product.category_id, product.manufacturer_id, product.unit_id, product.purchase_price, product.sale_price, product.wholesale_price,
              product.minimum_stock, product.maximum_stock, product.tax_rate, product.requires_prescription, product.is_controlled_substance,
              product.description
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
              item.entity_id, movement.product_id, movement.batch_number, movement.expiration_date, movement.quantity, movement.user_id
            ];
            await pool.query(insertMovementQuery, movementValues);
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
