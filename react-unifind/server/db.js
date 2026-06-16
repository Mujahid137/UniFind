import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { BACKUP_DIR, DATA_DIR, DB_FILE, SQLITE_FILE, UPLOAD_DIR, ADMIN_EMAIL, ADMIN_PASSWORD, DATABASE_DRIVER } from "./config.js";
import { hashPassword, createVerificationCode } from "./auth.js";
import { buildMatches } from "./matching.js";

function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function category(name) {
  return { id: id(), name, active: true, createdAt: now() };
}

function location(name, type = "campus") {
  return { id: id(), name, type, active: true, createdAt: now() };
}

function enrichUser(user) {
  return {
    points: 0,
    badges: [],
    trustScore: user.role === "admin" ? 100 : 60,
    reputation: {
      successfulReturns: 0,
      approvedClaims: 0,
      communityVotes: 0,
      responseSpeed: "new",
    },
    deviceFingerprints: [],
    ...user,
  };
}

function seedState() {
  const categories = ["Mobile", "Wallet", "ID Card", "Bag", "Keys", "Documents", "Pets", "Electronics", "Accessories", "Clothing"].map(category);
  const locations = ["Main Library", "Student Center", "Recreation Center", "Science Hall", "Business Building", "Engineering Block", "Parking Lot C"].map(location);
  const categoryByName = (name) => categories.find((entry) => entry.name === name)?.id;
  const adminId = id();
  const userA = id();
  const userB = id();
  const securityId = id();
  const adminUser = {
    id: adminId,
    name: "Lost & Found Admin",
    email: ADMIN_EMAIL.toLowerCase(),
    phone: "",
    role: "admin",
    status: "verified",
    emailVerified: true,
    phoneVerified: false,
    passwordHash: hashPassword(ADMIN_PASSWORD),
    createdAt: now(),
    updatedAt: now(),
  };
  const users = [
    enrichUser(adminUser),
    enrichUser({
      id: userA,
      name: "Jordan Williams",
      email: "jordan.w@university.edu",
      phone: "555-0109",
      role: "user",
      status: "verified",
      emailVerified: true,
      phoneVerified: true,
      passwordHash: hashPassword("Student123!"),
      createdAt: "2026-04-12T08:00:00.000Z",
      updatedAt: "2026-04-12T08:00:00.000Z",
    }),
    enrichUser({
      id: userB,
      name: "Rachel Green",
      email: "rachel.g@university.edu",
      phone: "555-0107",
      role: "user",
      status: "verified",
      emailVerified: true,
      phoneVerified: true,
      passwordHash: hashPassword("Student123!"),
      createdAt: "2026-04-13T08:00:00.000Z",
      updatedAt: "2026-04-13T08:00:00.000Z",
    }),
    enrichUser({
      id: securityId,
      name: "Campus Security",
      email: "security@university.edu",
      phone: "555-0199",
      role: "security",
      status: "verified",
      emailVerified: true,
      phoneVerified: true,
      passwordHash: hashPassword("Security123!"),
      createdAt: "2026-04-15T08:00:00.000Z",
      updatedAt: "2026-04-15T08:00:00.000Z",
    }),
  ];
  const items = [
    {
      id: id(),
      type: "lost",
      title: "Black Samsung Phone",
      description: "Black Samsung phone lost near library. Has a clear case and small crack on the corner.",
      categoryId: categoryByName("Mobile"),
      category: "Mobile",
      location: "Main Library",
      color: "Black",
      brand: "Samsung",
      date: "2026-05-10",
      status: "approved",
      reporterId: userA,
      contactName: "Jordan Williams",
      contactEmail: "jordan.w@university.edu",
      contactPhone: "555-0109",
      images: [],
      createdAt: "2026-05-10T09:10:00.000Z",
      updatedAt: "2026-05-10T09:10:00.000Z",
    },
    {
      id: id(),
      type: "found",
      title: "Black Samsung Mobile",
      description: "Black Samsung mobile found near library entrance. Clear case attached.",
      categoryId: categoryByName("Mobile"),
      category: "Mobile",
      location: "Main Library",
      color: "Black",
      brand: "Samsung",
      date: "2026-05-11",
      status: "pending",
      reporterId: userB,
      contactName: "Rachel Green",
      contactEmail: "rachel.g@university.edu",
      contactPhone: "555-0107",
      images: [],
      createdAt: "2026-05-11T11:30:00.000Z",
      updatedAt: "2026-05-11T11:30:00.000Z",
    },
  ];
  return {
    meta: { version: 1, createdAt: now(), updatedAt: now() },
    users,
    categories,
    locations,
    items,
    claims: [],
    messages: [],
    notifications: [],
    reports: [],
    recoveryTags: [],
    nfcTags: [],
    geofences: [
      {
        id: id(),
        name: "UIU Campus Safety Zone",
        location: "United International University",
        type: "campus",
        radiusMeters: 750,
        active: true,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    deviceFingerprints: [],
    rewards: [],
    communityVerifications: [],
    pickupCodes: [],
    blockchainLedger: [],
    emergencyCases: [],
    partnerInstitutions: [],
    routePredictions: [],
    liveEvents: [],
    aiReviews: [],
    translations: [],
    automationRuns: [],
    settings: {
      siteName: "UniFind",
      contactEmail: "support@unifind.demo",
      privacyPolicy: "Ownership verification data is only used for item recovery.",
      securityMode: "jwt-role-based-access",
      uploadsEnabled: true,
      aiProvider: "local-demo",
      qrRecoveryBaseUrl: "http://localhost:5173/recovery",
      autoExpireDays: 60,
      emergencyCategories: ["ID Card", "Documents", "Wallet", "Mobile"],
      notifications: {
        app: true,
        email: false,
        sms: false,
        push: false,
      },
    },
    activityLogs: [
      { id: id(), actorId: adminId, action: "database.seeded", entityType: "system", entityId: "initial", metadata: {}, createdAt: now() },
    ],
    matches: buildMatches(items),
  };
}

function normalizeState(state) {
  const seeded = seedState();
  return {
    ...seeded,
    ...state,
    users: Array.isArray(state.users) ? state.users.map(enrichUser) : [],
    categories: Array.isArray(state.categories) ? state.categories : [],
    locations: Array.isArray(state.locations) ? state.locations : [],
    items: Array.isArray(state.items) ? state.items : [],
    claims: Array.isArray(state.claims) ? state.claims : [],
    messages: Array.isArray(state.messages) ? state.messages : [],
    notifications: Array.isArray(state.notifications) ? state.notifications : [],
    reports: Array.isArray(state.reports) ? state.reports : [],
    recoveryTags: Array.isArray(state.recoveryTags) ? state.recoveryTags : [],
    nfcTags: Array.isArray(state.nfcTags) ? state.nfcTags : [],
    geofences: Array.isArray(state.geofences) ? state.geofences : seeded.geofences,
    deviceFingerprints: Array.isArray(state.deviceFingerprints) ? state.deviceFingerprints : [],
    rewards: Array.isArray(state.rewards) ? state.rewards : [],
    communityVerifications: Array.isArray(state.communityVerifications) ? state.communityVerifications : [],
    pickupCodes: Array.isArray(state.pickupCodes) ? state.pickupCodes : [],
    blockchainLedger: Array.isArray(state.blockchainLedger) ? state.blockchainLedger : [],
    emergencyCases: Array.isArray(state.emergencyCases) ? state.emergencyCases : [],
    partnerInstitutions: Array.isArray(state.partnerInstitutions) ? state.partnerInstitutions : [],
    routePredictions: Array.isArray(state.routePredictions) ? state.routePredictions : [],
    liveEvents: Array.isArray(state.liveEvents) ? state.liveEvents : [],
    aiReviews: Array.isArray(state.aiReviews) ? state.aiReviews : [],
    translations: Array.isArray(state.translations) ? state.translations : [],
    automationRuns: Array.isArray(state.automationRuns) ? state.automationRuns : [],
    activityLogs: Array.isArray(state.activityLogs) ? state.activityLogs : [],
    settings: state.settings && typeof state.settings === "object" ? { ...seeded.settings, ...state.settings } : seeded.settings,
    matches: buildMatches(Array.isArray(state.items) ? state.items : []),
  };
}

const EXTRA_COLLECTIONS = [
  "recoveryTags",
  "nfcTags",
  "geofences",
  "deviceFingerprints",
  "rewards",
  "communityVerifications",
  "pickupCodes",
  "blockchainLedger",
  "emergencyCases",
  "partnerInstitutions",
  "routePredictions",
  "liveEvents",
  "aiReviews",
  "translations",
  "automationRuns",
];

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function asInt(value) {
  return value ? 1 : 0;
}

function sqlString(value) {
  return String(value || "");
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function createJsonDatabase() {
  ensureDir(DATA_DIR);
  ensureDir(UPLOAD_DIR);
  ensureDir(BACKUP_DIR);
  let state;
  if (fs.existsSync(DB_FILE)) {
    state = normalizeState(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
  } else {
    state = seedState();
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
  }

  function persist() {
    state.meta = { ...state.meta, updatedAt: now() };
    state.matches = buildMatches(state.items);
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
  }

  function logActivity({ actorId = "system", action, entityType, entityId, metadata = {} }) {
    const entry = { id: id(), actorId, action, entityType, entityId, metadata, createdAt: now() };
    state.activityLogs.unshift(entry);
    persist();
    return entry;
  }

  return {
    get: () => state,
    set(updater) {
      state = typeof updater === "function" ? updater(state) : updater;
      persist();
      return state;
    },
    id,
    now,
    persist,
    logActivity,
    backup(reason = "manual") {
      ensureDir(BACKUP_DIR);
      const file = path.join(BACKUP_DIR, `unifind-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      fs.writeFileSync(file, JSON.stringify({ reason, state }, null, 2));
      logActivity({ action: "backup.created", entityType: "backup", entityId: path.basename(file), metadata: { reason } });
      return file;
    },
    listBackups() {
      ensureDir(BACKUP_DIR);
      return fs.readdirSync(BACKUP_DIR)
        .filter((file) => file.endsWith(".json"))
        .map((file) => ({ file, path: path.join(BACKUP_DIR, file) }))
        .sort((a, b) => b.file.localeCompare(a.file));
    },
    reset() {
      state = seedState();
      persist();
      return state;
    },
    info() {
      return {
        driver: "json",
        file: DB_FILE,
        collections: Object.fromEntries(Object.entries(state).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])),
      };
    },
    createVerificationCode,
  };
}

function createSqlSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      uiu_id TEXT,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category_id TEXT,
      category TEXT,
      location TEXT,
      color TEXT,
      brand TEXT,
      report_date TEXT,
      status TEXT NOT NULL,
      reporter_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_items_type_status ON items(type, status);
    CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
    CREATE INDEX IF NOT EXISTS idx_items_location ON items(location);
    CREATE INDEX IF NOT EXISTS idx_items_reporter ON items(reporter_id);

    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      claimant_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_claims_item_status ON claims(item_id, status);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT,
      recipient_id TEXT,
      item_id TEXT,
      subject TEXT,
      status TEXT,
      created_at TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT,
      channel TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      entity_type TEXT,
      entity_id TEXT,
      created_at TEXT,
      payload_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT,
      type TEXT,
      target_type TEXT,
      target_id TEXT,
      status TEXT,
      created_at TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      created_at TEXT,
      payload_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_logs(entity_type, entity_id);

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      lost_item_id TEXT,
      found_item_id TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      status TEXT,
      created_at TEXT,
      payload_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS collection_records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS idx_collection_records_created ON collection_records(collection, created_at);
  `);
}

function readPayloadRows(database, table) {
  return database
    .prepare(`SELECT payload_json FROM ${table} ORDER BY sort_order ASC`)
    .all()
    .map((row) => parseJson(row.payload_json, {}));
}

function readExtraCollection(database, collection) {
  return database
    .prepare("SELECT payload_json FROM collection_records WHERE collection = ? ORDER BY sort_order ASC")
    .all(collection)
    .map((row) => parseJson(row.payload_json, {}));
}

function loadSqlState(database) {
  const userCount = database.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (!userCount) return null;
  const metaRows = database.prepare("SELECT key, value FROM meta").all();
  const meta = Object.fromEntries(metaRows.map((row) => [row.key, parseJson(row.value, row.value)]));
  const settings = parseJson(database.prepare("SELECT payload_json FROM settings WHERE id = 'site'").get()?.payload_json, {});
  const state = {
    meta,
    users: readPayloadRows(database, "users"),
    categories: readPayloadRows(database, "categories"),
    locations: readPayloadRows(database, "locations"),
    items: readPayloadRows(database, "items"),
    claims: readPayloadRows(database, "claims"),
    messages: readPayloadRows(database, "messages"),
    notifications: readPayloadRows(database, "notifications"),
    reports: readPayloadRows(database, "reports"),
    activityLogs: readPayloadRows(database, "activity_logs"),
    matches: readPayloadRows(database, "matches"),
    settings,
  };
  EXTRA_COLLECTIONS.forEach((collection) => {
    state[collection] = readExtraCollection(database, collection);
  });
  return normalizeState(state);
}

function insertRows(database, state) {
  const insertUser = database.prepare(`
    INSERT INTO users (id, name, email, phone, uiu_id, role, status, email_verified, phone_verified, points, created_at, updated_at, payload_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCategory = database.prepare(`
    INSERT INTO categories (id, name, active, created_at, updated_at, payload_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLocation = database.prepare(`
    INSERT INTO locations (id, name, type, active, created_at, updated_at, payload_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertItem = database.prepare(`
    INSERT INTO items (id, type, title, description, category_id, category, location, color, brand, report_date, status, reporter_id, created_at, updated_at, payload_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertClaim = database.prepare(`
    INSERT INTO claims (id, item_id, claimant_id, status, created_at, updated_at, payload_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMessage = database.prepare(`
    INSERT INTO messages (id, sender_id, recipient_id, item_id, subject, status, created_at, updated_at, payload_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertNotification = database.prepare(`
    INSERT INTO notifications (id, user_id, title, channel, read, entity_type, entity_id, created_at, payload_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertReport = database.prepare(`
    INSERT INTO reports (id, reporter_id, type, target_type, target_id, status, created_at, updated_at, payload_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertActivity = database.prepare(`
    INSERT INTO activity_logs (id, actor_id, action, entity_type, entity_id, created_at, payload_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMatch = database.prepare(`
    INSERT INTO matches (id, lost_item_id, found_item_id, score, status, created_at, payload_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertExtra = database.prepare(`
    INSERT INTO collection_records (collection, id, created_at, updated_at, payload_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  state.users.forEach((user, index) => insertUser.run(user.id, user.name, user.email, user.phone || "", user.uiuId || "", user.role, user.status, asInt(user.emailVerified), asInt(user.phoneVerified), Number(user.points || 0), user.createdAt || "", user.updatedAt || "", JSON.stringify(user), index));
  state.categories.forEach((category, index) => insertCategory.run(category.id, category.name, asInt(category.active), category.createdAt || "", category.updatedAt || "", JSON.stringify(category), index));
  state.locations.forEach((location, index) => insertLocation.run(location.id, location.name, location.type || "", asInt(location.active), location.createdAt || "", location.updatedAt || "", JSON.stringify(location), index));
  state.items.forEach((item, index) => insertItem.run(item.id, item.type, item.title, item.description || "", item.categoryId || "", item.category || "", item.location || "", item.color || "", item.brand || "", item.date || "", item.status, item.reporterId || "", item.createdAt || "", item.updatedAt || "", JSON.stringify(item), index));
  state.claims.forEach((claim, index) => insertClaim.run(claim.id, claim.itemId, claim.claimantId, claim.status, claim.createdAt || "", claim.updatedAt || "", JSON.stringify(claim), index));
  state.messages.forEach((message, index) => insertMessage.run(message.id, message.senderId || "", message.recipientId || "", message.itemId || "", message.subject || "", message.status || "", message.createdAt || "", message.updatedAt || "", JSON.stringify(message), index));
  state.notifications.forEach((notification, index) => insertNotification.run(notification.id, notification.userId || "", notification.title || "", notification.channel || "", asInt(notification.read), notification.entityType || "", notification.entityId || "", notification.createdAt || "", JSON.stringify(notification), index));
  state.reports.forEach((report, index) => insertReport.run(report.id, report.reporterId || "", report.type || "", report.targetType || "", report.targetId || "", report.status || "", report.createdAt || "", report.updatedAt || "", JSON.stringify(report), index));
  state.activityLogs.forEach((entry, index) => insertActivity.run(entry.id, entry.actorId || "", entry.action, entry.entityType || "", entry.entityId || "", entry.createdAt || "", JSON.stringify(entry), index));
  state.matches.forEach((match, index) => insertMatch.run(match.id, match.lostItemId || "", match.foundItemId || "", Number(match.score || 0), match.status || "", match.createdAt || "", JSON.stringify(match), index));
  EXTRA_COLLECTIONS.forEach((collection) => {
    (state[collection] || []).forEach((entry, index) => {
      insertExtra.run(collection, entry.id || `${collection}-${index}`, entry.createdAt || entry.timestamp || "", entry.updatedAt || "", JSON.stringify(entry), index);
    });
  });
}

function saveSqlState(database, state) {
  state.meta = { ...state.meta, updatedAt: now() };
  state.matches = buildMatches(state.items);
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      DELETE FROM users;
      DELETE FROM categories;
      DELETE FROM locations;
      DELETE FROM items;
      DELETE FROM claims;
      DELETE FROM messages;
      DELETE FROM notifications;
      DELETE FROM reports;
      DELETE FROM activity_logs;
      DELETE FROM matches;
      DELETE FROM settings;
      DELETE FROM collection_records;
      DELETE FROM meta;
    `);
    Object.entries(state.meta || {}).forEach(([key, value]) => {
      database.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
    });
    database.prepare("INSERT INTO settings (id, payload_json, updated_at) VALUES ('site', ?, ?)").run(JSON.stringify(state.settings || {}), state.meta?.updatedAt || now());
    insertRows(database, state);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function tableCount(database, table) {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function createSqlDatabase() {
  ensureDir(DATA_DIR);
  ensureDir(UPLOAD_DIR);
  ensureDir(BACKUP_DIR);
  const database = new DatabaseSync(SQLITE_FILE);
  createSqlSchema(database);

  let state = loadSqlState(database);
  if (!state) {
    state = fs.existsSync(DB_FILE) ? normalizeState(JSON.parse(fs.readFileSync(DB_FILE, "utf8"))) : seedState();
    saveSqlState(database, state);
  }

  function persist() {
    saveSqlState(database, state);
  }

  function logActivity({ actorId = "system", action, entityType, entityId, metadata = {} }) {
    const entry = { id: id(), actorId, action, entityType, entityId, metadata, createdAt: now() };
    state.activityLogs.unshift(entry);
    persist();
    return entry;
  }

  return {
    get: () => state,
    set(updater) {
      state = normalizeState(typeof updater === "function" ? updater(state) : updater);
      persist();
      return state;
    },
    id,
    now,
    persist,
    logActivity,
    backup(reason = "manual") {
      ensureDir(BACKUP_DIR);
      persist();
      const safeTime = new Date().toISOString().replace(/[:.]/g, "-");
      const sqliteFile = path.join(BACKUP_DIR, `unifind-backup-${safeTime}.sqlite`);
      database.exec(`VACUUM INTO '${escapeSqlString(sqliteFile)}'`);
      const jsonFile = path.join(BACKUP_DIR, `unifind-backup-${safeTime}.json`);
      fs.writeFileSync(jsonFile, JSON.stringify({ reason, state }, null, 2));
      logActivity({ action: "backup.created", entityType: "backup", entityId: path.basename(sqliteFile), metadata: { reason, driver: "sqlite" } });
      return sqliteFile;
    },
    listBackups() {
      ensureDir(BACKUP_DIR);
      return fs.readdirSync(BACKUP_DIR)
        .filter((file) => file.endsWith(".json") || file.endsWith(".sqlite"))
        .map((file) => ({ file, path: path.join(BACKUP_DIR, file) }))
        .sort((a, b) => b.file.localeCompare(a.file));
    },
    reset() {
      state = seedState();
      persist();
      return state;
    },
    info() {
      return {
        driver: "sqlite",
        file: SQLITE_FILE,
        tables: {
          users: tableCount(database, "users"),
          categories: tableCount(database, "categories"),
          locations: tableCount(database, "locations"),
          items: tableCount(database, "items"),
          claims: tableCount(database, "claims"),
          messages: tableCount(database, "messages"),
          notifications: tableCount(database, "notifications"),
          reports: tableCount(database, "reports"),
          activityLogs: tableCount(database, "activity_logs"),
          matches: tableCount(database, "matches"),
          collectionRecords: tableCount(database, "collection_records"),
        },
      };
    },
    createVerificationCode,
  };
}

export function createDatabase() {
  if (sqlString(DATABASE_DRIVER).toLowerCase() === "json") return createJsonDatabase();
  return createSqlDatabase();
}
