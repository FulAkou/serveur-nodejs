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
    if (err) console.error("Impossible de créer la table remote_sale_items:", err);
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
              sale.amount_change
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
                  saleItem.tax_rate
                ];
                await pool.query(insertItemQuery, itemValues);
              }
            }
          }
          break;
          
        // On pourrait ajouter d'autres cas: case "products", case "customers", etc.
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
