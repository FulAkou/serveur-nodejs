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
  const createTableQuery = `
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

  pool.query(createTableQuery, (err) => {
    if (err) {
      console.error("Impossible de créer la table sync_logs:", err);
    }
  });
});

// Middlewares
app.use(cors());
app.use(express.json());

// Middleware d'authentification
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    // Accepte n'importe quel token de plus de 5 caractères pour le test
    if (token.length > 5) {
      return next();
    }
  }
  console.warn("Tentative d'accès non autorisée");
  res.status(401).json({ error: "Non autorisé" });
};

// Application du middleware d'authentification sur toutes les routes /v1
app.use("/v1", authMiddleware);

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

      const insertQuery = `
                INSERT INTO sync_logs (sync_id, entity, entity_id, action, payload)
                VALUES ($1, $2, $3, $4, $5)
            `;

      const values = [
        item.sync_id,
        item.entity,
        item.entity_id,
        item.action,
        JSON.stringify(item.payload),
      ];

      await pool.query(insertQuery, values);
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
