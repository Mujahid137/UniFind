import mysql from "mysql2/promise";
import { MYSQL_CONFIG } from "./config.js";

export const mysqlPool = mysql.createPool({
  ...MYSQL_CONFIG,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

let mysqlSchemaReady;

async function columnExists(table, column) {
  const [rows] = await mysqlPool.query("SHOW COLUMNS FROM ?? LIKE ?", [table, column]);
  return rows.length > 0;
}

async function ensureColumn(table, column, definition) {
  if (await columnExists(table, column)) return;
  await mysqlPool.query(`ALTER TABLE ?? ADD COLUMN ${definition}`, [table]);
}

export async function ensureMysqlSchema() {
  if (mysqlSchemaReady) return mysqlSchemaReady;

  mysqlSchemaReady = (async () => {
    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role VARCHAR(32) NOT NULL DEFAULT 'student',
        status VARCHAR(32) NOT NULL DEFAULT 'verified',
        phone VARCHAR(64) NULL,
        uiu_id VARCHAR(64) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        category VARCHAR(128) NOT NULL,
        color VARCHAR(64) NULL,
        location VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        kind VARCHAR(16) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'reported',
        reporter VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(64) NULL,
        uiu_id VARCHAR(64) NULL,
        map_link TEXT NULL,
        photo LONGTEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS claims (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        item_id INT NOT NULL,
        claimant_id INT NOT NULL,
        claimant_name VARCHAR(255) NOT NULL,
        claimant_email VARCHAR(255) NOT NULL,
        claimant_phone VARCHAR(64) NULL,
        claimant_uiu_id VARCHAR(64) NULL,
        proof TEXT NOT NULL,
        unique_mark TEXT NULL,
        last_seen VARCHAR(255) NULL,
        preferred_return_location VARCHAR(255) NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'submitted',
        admin_note TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        sender_id INT NULL,
        sender_name VARCHAR(255) NOT NULL,
        sender_email VARCHAR(255) NOT NULL,
        recipient_id INT NULL,
        item_id INT NULL,
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        reporter_id INT NULL,
        reporter_name VARCHAR(255) NOT NULL,
        reporter_email VARCHAR(255) NOT NULL,
        type VARCHAR(128) NOT NULL,
        target_type VARCHAR(64) NOT NULL DEFAULT 'general',
        target_id INT NULL,
        target_label VARCHAR(255) NULL,
        detail TEXT NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await ensureColumn("users", "status", "status VARCHAR(32) NOT NULL DEFAULT 'verified'");
    await ensureColumn("users", "phone", "phone VARCHAR(64) NULL");
    await ensureColumn("users", "uiu_id", "uiu_id VARCHAR(64) NULL");
    await ensureColumn("users", "created_at", "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await ensureColumn("users", "updated_at", "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

    await ensureColumn("items", "color", "color VARCHAR(64) NULL");
    await ensureColumn("items", "phone", "phone VARCHAR(64) NULL");
    await ensureColumn("items", "uiu_id", "uiu_id VARCHAR(64) NULL");
    await ensureColumn("items", "map_link", "map_link TEXT NULL");
    await ensureColumn("items", "photo", "photo LONGTEXT NULL");
    await ensureColumn("items", "created_at", "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await ensureColumn("items", "updated_at", "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

    await ensureColumn("claims", "claimant_name", "claimant_name VARCHAR(255) NOT NULL DEFAULT ''");
    await ensureColumn("claims", "claimant_email", "claimant_email VARCHAR(255) NOT NULL DEFAULT ''");
    await ensureColumn("claims", "claimant_phone", "claimant_phone VARCHAR(64) NULL");
    await ensureColumn("claims", "claimant_uiu_id", "claimant_uiu_id VARCHAR(64) NULL");
    await ensureColumn("claims", "unique_mark", "unique_mark TEXT NULL");
    await ensureColumn("claims", "last_seen", "last_seen VARCHAR(255) NULL");
    await ensureColumn("claims", "preferred_return_location", "preferred_return_location VARCHAR(255) NULL");
    await ensureColumn("claims", "status", "status VARCHAR(32) NOT NULL DEFAULT 'submitted'");
    await ensureColumn("claims", "admin_note", "admin_note TEXT NULL");
    await ensureColumn("claims", "created_at", "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await ensureColumn("claims", "updated_at", "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

    await ensureColumn("messages", "sender_id", "sender_id INT NULL");
    await ensureColumn("messages", "sender_name", "sender_name VARCHAR(255) NOT NULL DEFAULT ''");
    await ensureColumn("messages", "sender_email", "sender_email VARCHAR(255) NOT NULL DEFAULT ''");
    await ensureColumn("messages", "recipient_id", "recipient_id INT NULL");
    await ensureColumn("messages", "item_id", "item_id INT NULL");
    await ensureColumn("messages", "status", "status VARCHAR(32) NOT NULL DEFAULT 'open'");
    await ensureColumn("messages", "created_at", "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await ensureColumn("messages", "updated_at", "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

    await ensureColumn("reports", "reporter_id", "reporter_id INT NULL");
    await ensureColumn("reports", "reporter_name", "reporter_name VARCHAR(255) NOT NULL");
    await ensureColumn("reports", "reporter_email", "reporter_email VARCHAR(255) NOT NULL");
    await ensureColumn("reports", "target_type", "target_type VARCHAR(64) NOT NULL DEFAULT 'general'");
    await ensureColumn("reports", "target_id", "target_id INT NULL");
    await ensureColumn("reports", "target_label", "target_label VARCHAR(255) NULL");
    await ensureColumn("reports", "status", "status VARCHAR(32) NOT NULL DEFAULT 'open'");
    await ensureColumn("reports", "created_at", "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await ensureColumn("reports", "updated_at", "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
  })();

  return mysqlSchemaReady;
}

export async function testMysqlConnection() {
  await ensureMysqlSchema();
  const [rows] = await mysqlPool.query("SELECT DATABASE() AS database_name, NOW() AS server_time");
  return rows[0];
}
