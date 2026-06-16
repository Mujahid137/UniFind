import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, "..");
export const SERVER_DIR = __dirname;
export const DATA_DIR = path.join(SERVER_DIR, "data");
export const UPLOAD_DIR = path.join(SERVER_DIR, "uploads");
export const BACKUP_DIR = path.join(SERVER_DIR, "backups");
export const DB_FILE = path.join(DATA_DIR, "unifind-db.json");
export const SQLITE_FILE = process.env.SQLITE_FILE || path.join(DATA_DIR, "unifind.sqlite");
export const DATABASE_DRIVER = process.env.DATABASE_DRIVER || "sqlite";

export const PORT = Number(process.env.PORT || 4000);
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
export const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
export const MYSQL_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "unifind",
  port: Number(process.env.DB_PORT || 3306),
};
export const JWT_SECRET = process.env.JWT_SECRET || "replace-this-dev-secret-before-deployment";
export const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS || 60 * 60 * 24 * 7);
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@uiu.ac.bd";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin123!";
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);

export const ITEM_STATUSES = ["pending", "approved", "rejected", "claimed", "returned", "expired"];
export const CLAIM_STATUSES = ["submitted", "under-review", "approved", "rejected", "returned"];
export const USER_ROLES = ["admin", "user", "moderator", "security"];
