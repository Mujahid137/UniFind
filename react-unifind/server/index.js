import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import multer from "multer";
import { createToken, hashPassword, publicUser, verifyPassword, createVerificationCode, verifyToken } from "./auth.js";
import { createDatabase } from "./db.js";
import { buildMatches } from "./matching.js";
import {
  analyticsSnapshot,
  chatbotReply,
  createLedgerEntry,
  detectDuplicates,
  fingerprintHash,
  fraudRisk,
  generateRecoveryCode,
  parseVoiceReport,
  predictLostLocation,
  recognizeImageMetadata,
  smartMatchItem,
  translateText,
  trustScore,
} from "./smart.js";
import {
  BACKUP_DIR,
  CLIENT_ORIGIN,
  CLIENT_ORIGINS,
  CLAIM_STATUSES,
  ITEM_STATUSES,
  MAX_UPLOAD_BYTES,
  PORT,
  UPLOAD_DIR,
  USER_ROLES,
} from "./config.js";
import { apiLimiter, asyncHandler, authLimiter, requireAuth, requireFields, requireRole, securityHeaders } from "./middleware.js";
import { ensureMysqlSchema, mysqlPool, testMysqlConnection } from "./mysql.js";

const app = express();
const db = createDatabase();
await ensureMysqlSchema();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      cb(null, `${db.id()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    if (!allowed.has(file.mimetype)) return cb(new Error("Only JPG, PNG, WEBP, or GIF images are allowed."));
    cb(null, true);
  },
});

const allowedClientOrigins = new Set([
  ...CLIENT_ORIGINS,
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);

function isAllowedClientOrigin(origin = "") {
  if (!origin || origin === "null") return true;
  if (allowedClientOrigins.has(origin)) return true;

  try {
    const url = new URL(origin);
    const isLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (isLocalHost && (url.protocol === "http:" || url.protocol === "https:")) return true;
  } catch {
    return false;
  }

  return false;
}

app.use(cors({
  origin(origin, callback) {
    if (isAllowedClientOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed by CORS.`));
  },
  credentials: true,
}));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use(securityHeaders);
app.use(apiLimiter);
app.use("/uploads", express.static(UPLOAD_DIR));

const auth = requireAuth(db);
const adminOnly = [auth, requireRole("admin")];
const staffOnly = [auth, requireRole("admin", "moderator", "security")];
const liveClients = new Set();
const MYSQL_MESSAGE_STATUSES = new Set(["open", "answered", "closed"]);
const MYSQL_REPORT_STATUSES = new Set(["open", "reviewing", "action-taken", "closed"]);

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function isOfficialUiuEmail(email = "") {
  const value = normalizeEmail(email);
  return value.includes("uiu.ac.bd");
}

function normalizeMysqlRole(role = "student") {
  const value = String(role || "student").trim().toLowerCase();
  if (value === "admin" || value === "moderator" || value === "security") return value;
  return "student";
}

function mysqlRoleLabel(role = "student") {
  const value = normalizeMysqlRole(role);
  if (value === "admin") return "Admin";
  if (value === "moderator") return "Moderator";
  if (value === "security") return "Security";
  return "Student";
}

function mysqlStatusValue(status = "verified") {
  return String(status || "verified").trim().toLowerCase();
}

const mysqlAuth = asyncHandler(async (req, res, next) => {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Authentication required." });
  const [rows] = await mysqlPool.execute("SELECT * FROM users WHERE id = ?", [payload.sub]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "Invalid account." });
  if (mysqlStatusValue(user.status) === "blocked") return res.status(403).json({ error: "Account is blocked." });
  req.mysqlUser = user;
  req.mysqlPublicUser = mysqlUserFromRow(user);
  next();
});

function requireMysqlRole(...roles) {
  return (req, res, next) => {
    const role = normalizeMysqlRole(req.mysqlUser?.role);
    if (!roles.includes(role)) return res.status(403).json({ error: "Insufficient permissions." });
    next();
  };
}

const mysqlAdminOnly = [mysqlAuth, requireMysqlRole("admin")];

function adminSafeUser(user) {
  return publicUser(user);
}

function findById(collection, id) {
  return collection.find((entry) => entry.id === id);
}

function assertAllowedStatus(status, allowed, res) {
  if (!allowed.includes(status)) {
    res.status(400).json({ error: `Invalid status. Allowed: ${allowed.join(", ")}` });
    return false;
  }
  return true;
}

function userCanEditItem(user, item) {
  return ["admin", "moderator", "security"].includes(user.role) || item.reporterId === user.id;
}

function isStaff(user) {
  return ["admin", "moderator", "security"].includes(user?.role);
}

function publicItem(item) {
  if (!item) return null;
  const { contactEmail, contactPhone, ...safe } = item;
  return {
    ...safe,
    contactEmail: contactEmail ? "protected" : "",
    contactPhone: contactPhone ? "protected" : "",
  };
}

function liveClientCanReceive(client, event) {
  if (event.audience === "all") return true;
  if (event.audience === "admin") return isStaff(client);
  if (event.audience === "user") return event.userId === client.userId;
  return false;
}

function pushLiveEvent(event) {
  liveClients.forEach((client) => {
    if (!liveClientCanReceive(client, event)) return;
    client.res.write(`event: ${event.type}\n`);
    client.res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
}

function recordLiveEvent(type, payload, { audience = "admin", userId = null } = {}) {
  const event = { id: db.id(), type, audience, userId, payload, createdAt: db.now() };
  db.set((state) => ({ ...state, liveEvents: [event, ...state.liveEvents].slice(0, 250) }));
  pushLiveEvent(event);
  return event;
}

function attachLiveClient(req, res, audience) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const client = { id: db.id(), userId: req.user.id, role: req.user.role, audience, res };
  liveClients.add(client);
  res.write(`event: ready\n`);
  res.write(`data: ${JSON.stringify({ ok: true, audience, time: db.now() })}\n\n`);
  req.on("close", () => liveClients.delete(client));
}

function filterItems(items, query) {
  const {
    q = "",
    category,
    categoryId,
    location,
    dateFrom,
    dateTo,
    color,
    brand,
    status,
    userId,
  } = query;
  const text = String(q).toLowerCase();
  return items.filter((item) => {
    const textMatch = !text || [item.title, item.description, item.category, item.location, item.color, item.brand, item.contactName]
      .some((value) => String(value || "").toLowerCase().includes(text));
    const categoryMatch = !category && !categoryId
      ? true
      : item.categoryId === categoryId || String(item.category || "").toLowerCase() === String(category || "").toLowerCase();
    const locationMatch = !location || item.location === location;
    const colorMatch = !color || String(item.color || "").toLowerCase() === String(color).toLowerCase();
    const brandMatch = !brand || String(item.brand || "").toLowerCase() === String(brand).toLowerCase();
    const statusMatch = !status || item.status === status;
    const userMatch = !userId || item.reporterId === userId;
    const fromMatch = !dateFrom || String(item.date || "") >= dateFrom;
    const toMatch = !dateTo || String(item.date || "") <= dateTo;
    return textMatch && categoryMatch && locationMatch && colorMatch && brandMatch && statusMatch && userMatch && fromMatch && toMatch;
  });
}

function makeImageUrl(req, file) {
  if (!file) return null;
  return `${req.protocol}://${req.get("host")}/uploads/${file.filename}`;
}

function createNotification({ userId = null, title, message, channel = "app", entityType = "system", entityId = null }) {
  const notification = {
    id: db.id(),
    userId,
    title,
    message,
    channel,
    read: false,
    entityType,
    entityId,
    createdAt: db.now(),
  };
  db.set((state) => ({ ...state, notifications: [notification, ...state.notifications] }));
  pushLiveEvent({
    id: notification.id,
    type: "notification.created",
    audience: userId ? "user" : "all",
    userId,
    payload: notification,
    createdAt: notification.createdAt,
  });
  return notification;
}

function saveAiReview({ type, entityType = "system", entityId = null, input = {}, result = {} }) {
  const review = {
    id: db.id(),
    type,
    entityType,
    entityId,
    input,
    result,
    createdAt: db.now(),
  };
  db.set((state) => ({ ...state, aiReviews: [review, ...state.aiReviews].slice(0, 300) }));
  return review;
}

function awardUserPoints(userId, points, reason, entityType = "system", entityId = null) {
  const reward = {
    id: db.id(),
    userId,
    points,
    reason,
    entityType,
    entityId,
    createdAt: db.now(),
  };
  db.set((state) => ({
    ...state,
    rewards: [reward, ...state.rewards],
    users: state.users.map((user) => {
      if (user.id !== userId) return user;
      const nextPoints = Number(user.points || 0) + points;
      const badges = new Set(user.badges || []);
      if (nextPoints >= 50) badges.add("campus-helper");
      if (nextPoints >= 100) badges.add("trusted-finder");
      return {
        ...user,
        points: nextPoints,
        badges: [...badges],
        reputation: {
          ...user.reputation,
          successfulReturns: reason.includes("return") ? Number(user.reputation?.successfulReturns || 0) + 1 : Number(user.reputation?.successfulReturns || 0),
        },
        updatedAt: db.now(),
      };
    }),
  }));
  return reward;
}

function createItemHandler(type) {
  return [
    auth,
    upload.single("image"),
    requireFields(["title", "description", "location", "date"]),
    asyncHandler((req, res) => {
      const state = db.get();
      const category = req.body.categoryId
        ? state.categories.find((entry) => entry.id === req.body.categoryId)
        : state.categories.find((entry) => entry.name.toLowerCase() === String(req.body.category || "").toLowerCase());
      if (!category) return res.status(400).json({ error: "Valid category or categoryId is required." });
      const image = makeImageUrl(req, req.file);
      const item = {
        id: db.id(),
        type,
        title: String(req.body.title).trim(),
        description: String(req.body.description).trim(),
        categoryId: category.id,
        category: category.name,
        location: String(req.body.location).trim(),
        color: String(req.body.color || "").trim(),
        brand: String(req.body.brand || "").trim(),
        date: String(req.body.date).trim(),
        status: ["admin", "moderator", "security"].includes(req.user.role) ? "approved" : "pending",
        reporterId: req.user.id,
        contactName: req.body.contactName || req.user.name,
        contactEmail: req.body.contactEmail || req.user.email,
        contactPhone: req.body.contactPhone || req.user.phone || "",
        images: image ? [image] : [],
        createdAt: db.now(),
        updatedAt: db.now(),
      };
      db.set((current) => ({ ...current, items: [item, ...current.items] }));
      db.logActivity({ actorId: req.user.id, action: `${type}.item.created`, entityType: "item", entityId: item.id });
      createNotification({ userId: req.user.id, title: "Report submitted", message: `${item.title} is now ${item.status}.`, entityType: "item", entityId: item.id });
      recordLiveEvent("item.created", { itemId: item.id, type: item.type, title: item.title, status: item.status, reporterId: item.reporterId });
      res.status(201).json({ item, matches: buildMatches(db.get().items).filter((match) => [match.lostItemId, match.foundItemId].includes(item.id)) });
    }),
  ];
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "UniFind API", time: db.now() });
});

app.get("/api/mysql/health", asyncHandler(async (req, res) => {
  const result = await testMysqlConnection();
  res.json({ ok: true, database: result.database_name, time: result.server_time });
}));

function mysqlItemFromRow(row) {
  const mysqlDate = row.date instanceof Date
    ? [
        row.date.getFullYear(),
        String(row.date.getMonth() + 1).padStart(2, "0"),
        String(row.date.getDate()).padStart(2, "0"),
      ].join("-")
    : String(row.date || "").slice(0, 10);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    color: row.color || "",
    location: row.location,
    date: mysqlDate,
    kind: row.kind,
    status: row.status || "reported",
    reporter: row.reporter,
    email: row.email,
    phone: row.phone || "",
    uiuId: row.uiu_id || "",
    map: row.map_link || "",
    photo: row.photo || "",
    source: "mysql",
    submittedAt: row.created_at,
    createdAt: row.created_at,
  };
}

app.get("/api/mysql/items", asyncHandler(async (req, res) => {
  const [rows] = await mysqlPool.query("SELECT * FROM items ORDER BY created_at DESC, id DESC");
  res.json({ items: rows.map(mysqlItemFromRow) });
}));

function mysqlUserFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: mysqlRoleLabel(row.role),
    status: row.status || "verified",
    phone: row.phone || "",
    uiuId: row.uiu_id || "",
    joinedAt: row.created_at,
  };
}

function mysqlDateTimeValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function mysqlClaimFromRow(row) {
  return {
    id: row.id,
    itemId: row.item_id,
    itemKind: row.item_kind || "",
    itemTitle: row.item_title || "Unknown item",
    itemCategory: row.item_category || "",
    itemLocation: row.item_location || "",
    itemDate: row.item_date instanceof Date
      ? [
          row.item_date.getFullYear(),
          String(row.item_date.getMonth() + 1).padStart(2, "0"),
          String(row.item_date.getDate()).padStart(2, "0"),
        ].join("-")
      : String(row.item_date || "").slice(0, 10),
    itemReporter: row.item_reporter || "",
    uiuId: row.claimant_uiu_id || "",
    name: row.claimant_name,
    email: row.claimant_email,
    phone: row.claimant_phone || "",
    proof: row.proof || "",
    uniqueMark: row.unique_mark || "",
    lastSeen: row.last_seen || "",
    preferredReturnLocation: row.preferred_return_location || "",
    submittedBy: row.claimant_email,
    status: row.status || "submitted",
    adminNote: row.admin_note || "",
    createdAt: mysqlDateTimeValue(row.created_at),
    updatedAt: mysqlDateTimeValue(row.updated_at),
  };
}

function mysqlMessageFromRow(row) {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    itemId: row.item_id,
    name: row.sender_name,
    email: row.sender_email,
    subject: row.subject || "Lost and found message",
    message: row.message || "",
    status: row.status || "open",
    createdAt: mysqlDateTimeValue(row.created_at),
    updatedAt: mysqlDateTimeValue(row.updated_at),
  };
}

function mysqlReportFromRow(row) {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    type: row.type || "General",
    reporter: row.reporter_name || "Unknown reporter",
    email: row.reporter_email || "",
    targetType: row.target_type || "general",
    targetId: row.target_id,
    target: row.target_label || "General report",
    detail: row.detail || "",
    status: row.status || "open",
    createdAt: mysqlDateTimeValue(row.created_at),
    updatedAt: mysqlDateTimeValue(row.updated_at),
  };
}

app.post("/api/mysql/auth/signup", asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  if (name.length < 2) return res.status(400).json({ error: "Enter your full name." });
  if (!isOfficialUiuEmail(email)) return res.status(400).json({ error: "Use an email that contains uiu.ac.bd." });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

  const [existing] = await mysqlPool.execute("SELECT id FROM users WHERE email = ?", [email]);
  if (existing.length) return res.status(409).json({ error: "Email already registered. Please sign in." });

  const [result] = await mysqlPool.execute(
    "INSERT INTO users (name, email, password, role, status, phone, uiu_id) VALUES (?, ?, ?, 'student', 'verified', ?, ?)",
    [name, email, hashPassword(password), String(req.body.phone || "").trim(), String(req.body.uiuId || "").trim()],
  );
  const [rows] = await mysqlPool.execute("SELECT * FROM users WHERE id = ?", [result.insertId]);
  const user = rows[0];
  res.status(201).json({
    user: mysqlUserFromRow(user),
    token: createToken({ sub: String(user.id), role: normalizeMysqlRole(user.role), provider: "mysql" }),
  });
}));

app.post("/api/mysql/auth/signin", asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const [rows] = await mysqlPool.execute("SELECT * FROM users WHERE email = ?", [email]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password || "")) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  if (mysqlStatusValue(user.status) === "blocked") {
    return res.status(403).json({ error: "Account is blocked." });
  }
  res.json({
    user: mysqlUserFromRow(user),
    token: createToken({ sub: String(user.id), role: normalizeMysqlRole(user.role), provider: "mysql" }),
  });
}));

app.get("/api/mysql/auth/me", mysqlAuth, asyncHandler(async (req, res) => {
  res.json({ user: req.mysqlPublicUser });
}));

app.patch("/api/mysql/admin/account", ...mysqlAdminOnly, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const nextEmail = req.body.email === undefined ? "" : normalizeEmail(req.body.email);
  const nextPassword = String(req.body.newPassword || "");

  if (!currentPassword) return res.status(400).json({ error: "Current password is required." });
  if (!verifyPassword(currentPassword, req.mysqlUser.password || "")) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }

  const updates = [];
  const values = [];

  if (req.body.email !== undefined) {
    if (!nextEmail) return res.status(400).json({ error: "Admin email cannot be empty." });
    if (!isOfficialUiuEmail(nextEmail)) {
      return res.status(400).json({ error: "Use an email that contains uiu.ac.bd." });
    }
    const [existing] = await mysqlPool.execute(
      "SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1",
      [nextEmail, req.mysqlUser.id],
    );
    if (existing.length) return res.status(409).json({ error: "That email is already in use." });
    updates.push("email = ?");
    values.push(nextEmail);
  }

  if (req.body.newPassword !== undefined) {
    if (nextPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters." });
    }
    updates.push("password = ?");
    values.push(hashPassword(nextPassword));
  }

  if (!updates.length) {
    return res.status(400).json({ error: "Provide a new admin email or a new password." });
  }

  values.push(req.mysqlUser.id);
  await mysqlPool.execute(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, values);

  const [rows] = await mysqlPool.execute("SELECT * FROM users WHERE id = ?", [req.mysqlUser.id]);
  const user = rows[0];
  res.json({
    user: mysqlUserFromRow(user),
    token: createToken({ sub: String(user.id), role: normalizeMysqlRole(user.role), provider: "mysql" }),
    message: "Admin account updated successfully.",
  });
}));

app.post("/api/mysql/claims", mysqlAuth, asyncHandler(async (req, res) => {
  const itemId = Number(req.body.itemId);
  if (!itemId) return res.status(400).json({ error: "A valid item is required." });

  const proof = String(req.body.proof || "").trim();

  const [itemRows] = await mysqlPool.execute("SELECT * FROM items WHERE id = ?", [itemId]);
  const item = itemRows[0];
  if (!item) return res.status(404).json({ error: "Item not found." });
  if (normalizeEmail(item.email) === normalizeEmail(req.mysqlUser.email)) {
    return res.status(400).json({ error: "You cannot claim your own report." });
  }

  const [existing] = await mysqlPool.execute(
    "SELECT id FROM claims WHERE item_id = ? AND claimant_id = ? LIMIT 1",
    [itemId, req.mysqlUser.id],
  );
  if (existing.length) return res.status(409).json({ error: "You already submitted a claim for this item." });

  const [result] = await mysqlPool.execute(
    `INSERT INTO claims
      (item_id, claimant_id, claimant_name, claimant_email, claimant_phone, claimant_uiu_id, proof, unique_mark, last_seen, preferred_return_location, status, admin_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', '')`,
    [
      itemId,
      req.mysqlUser.id,
      String(req.body.name || req.mysqlUser.name || "").trim(),
      normalizeEmail(req.mysqlUser.email),
      String(req.body.phone || req.mysqlUser.phone || "").trim(),
      String(req.body.uiuId || req.mysqlUser.uiu_id || "").trim(),
      proof,
      String(req.body.uniqueMark || "").trim(),
      String(req.body.lastSeen || "").trim(),
      String(req.body.preferredReturnLocation || "").trim(),
    ],
  );

  const [rows] = await mysqlPool.execute(
    `SELECT c.*, i.title AS item_title, i.category AS item_category, i.location AS item_location,
            i.date AS item_date, i.kind AS item_kind, i.reporter AS item_reporter
     FROM claims c
     LEFT JOIN items i ON i.id = c.item_id
     WHERE c.id = ?`,
    [result.insertId],
  );
  res.status(201).json({ claim: mysqlClaimFromRow(rows[0]) });
}));

app.get("/api/mysql/claims/my", mysqlAuth, asyncHandler(async (req, res) => {
  const [rows] = await mysqlPool.execute(
    `SELECT c.*, i.title AS item_title, i.category AS item_category, i.location AS item_location,
            i.date AS item_date, i.kind AS item_kind, i.reporter AS item_reporter
     FROM claims c
     LEFT JOIN items i ON i.id = c.item_id
     WHERE c.claimant_id = ? OR i.email = ?
     ORDER BY c.created_at DESC, c.id DESC`,
    [req.mysqlUser.id, normalizeEmail(req.mysqlUser.email)],
  );
  res.json({ claims: rows.map(mysqlClaimFromRow) });
}));

app.get("/api/mysql/admin/claims", ...mysqlAdminOnly, asyncHandler(async (req, res) => {
  const [rows] = await mysqlPool.query(
    `SELECT c.*, i.title AS item_title, i.category AS item_category, i.location AS item_location,
            i.date AS item_date, i.kind AS item_kind, i.reporter AS item_reporter
     FROM claims c
     LEFT JOIN items i ON i.id = c.item_id
     ORDER BY c.created_at DESC, c.id DESC`,
  );
  res.json({ claims: rows.map(mysqlClaimFromRow) });
}));

app.patch("/api/mysql/admin/claims/:id/status", ...mysqlAdminOnly, asyncHandler(async (req, res) => {
  const status = String(req.body.status || "").trim();
  if (!CLAIM_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${CLAIM_STATUSES.join(", ")}` });
  }

  const [currentRows] = await mysqlPool.execute(
    `SELECT c.*, i.title AS item_title, i.category AS item_category, i.location AS item_location,
            i.date AS item_date, i.kind AS item_kind, i.reporter AS item_reporter
     FROM claims c
     LEFT JOIN items i ON i.id = c.item_id
     WHERE c.id = ?`,
    [Number(req.params.id)],
  );
  const current = currentRows[0];
  if (!current) return res.status(404).json({ error: "Claim not found." });

  await mysqlPool.execute(
    "UPDATE claims SET status = ?, admin_note = ? WHERE id = ?",
    [status, String(req.body.adminNote || "").trim(), Number(req.params.id)],
  );

  if (status === "returned") {
    await mysqlPool.execute("UPDATE items SET status = 'returned' WHERE id = ?", [current.item_id]);
  }

  const [rows] = await mysqlPool.execute(
    `SELECT c.*, i.title AS item_title, i.category AS item_category, i.location AS item_location,
            i.date AS item_date, i.kind AS item_kind, i.reporter AS item_reporter
     FROM claims c
     LEFT JOIN items i ON i.id = c.item_id
     WHERE c.id = ?`,
    [Number(req.params.id)],
  );
  res.json({ claim: mysqlClaimFromRow(rows[0]) });
}));

app.post("/api/mysql/messages", mysqlAuth, asyncHandler(async (req, res) => {
  const message = String(req.body.message || "").trim();
  if (!message) return res.status(400).json({ error: "Message text is required." });

  const [result] = await mysqlPool.execute(
    `INSERT INTO messages
      (sender_id, sender_name, sender_email, recipient_id, item_id, subject, message, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
    [
      req.mysqlUser.id,
      String(req.mysqlUser.name || "").trim(),
      normalizeEmail(req.mysqlUser.email),
      req.body.recipientId ? Number(req.body.recipientId) : null,
      req.body.itemId ? Number(req.body.itemId) : null,
      String(req.body.subject || "Lost and found message").trim(),
      message,
    ],
  );

  const [rows] = await mysqlPool.execute("SELECT * FROM messages WHERE id = ?", [result.insertId]);
  res.status(201).json({ message: mysqlMessageFromRow(rows[0]) });
}));

app.get("/api/mysql/messages/my", mysqlAuth, asyncHandler(async (req, res) => {
  const [rows] = await mysqlPool.execute(
    `SELECT * FROM messages
     WHERE sender_id = ? OR recipient_id = ?
     ORDER BY created_at DESC, id DESC`,
    [req.mysqlUser.id, req.mysqlUser.id],
  );
  res.json({ messages: rows.map(mysqlMessageFromRow) });
}));

app.get("/api/mysql/admin/messages", ...mysqlAdminOnly, asyncHandler(async (req, res) => {
  const [rows] = await mysqlPool.query("SELECT * FROM messages ORDER BY created_at DESC, id DESC");
  res.json({ messages: rows.map(mysqlMessageFromRow) });
}));

app.patch("/api/mysql/admin/messages/:id/status", ...mysqlAdminOnly, asyncHandler(async (req, res) => {
  const status = String(req.body.status || "").trim();
  if (!MYSQL_MESSAGE_STATUSES.has(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${[...MYSQL_MESSAGE_STATUSES].join(", ")}` });
  }

  const [result] = await mysqlPool.execute(
    "UPDATE messages SET status = ? WHERE id = ?",
    [status, Number(req.params.id)],
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Message not found." });

  const [rows] = await mysqlPool.execute("SELECT * FROM messages WHERE id = ?", [Number(req.params.id)]);
  res.json({ message: mysqlMessageFromRow(rows[0]) });
}));

app.post("/api/mysql/reports", mysqlAuth, asyncHandler(async (req, res) => {
  const type = String(req.body.type || "").trim();
  const detail = String(req.body.detail || "").trim();
  if (!type) return res.status(400).json({ error: "Report type is required." });
  if (!detail) return res.status(400).json({ error: "Report details are required." });

  let targetLabel = String(req.body.targetLabel || "").trim();
  const targetType = String(req.body.targetType || "general").trim() || "general";
  const targetId = req.body.targetId ? Number(req.body.targetId) : null;
  if (!targetLabel && targetType === "item" && targetId) {
    const [itemRows] = await mysqlPool.execute("SELECT title FROM items WHERE id = ?", [targetId]);
    targetLabel = itemRows[0]?.title || "";
  }

  const [result] = await mysqlPool.execute(
    `INSERT INTO reports
      (reporter_id, reporter_name, reporter_email, type, target_type, target_id, target_label, detail, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
    [
      req.mysqlUser.id,
      String(req.mysqlUser.name || "").trim(),
      normalizeEmail(req.mysqlUser.email),
      type,
      targetType,
      targetId,
      targetLabel,
      detail,
    ],
  );

  const [rows] = await mysqlPool.execute("SELECT * FROM reports WHERE id = ?", [result.insertId]);
  res.status(201).json({ report: mysqlReportFromRow(rows[0]) });
}));

app.get("/api/mysql/reports/my", mysqlAuth, asyncHandler(async (req, res) => {
  const [rows] = await mysqlPool.execute(
    `SELECT * FROM reports
     WHERE reporter_id = ?
     ORDER BY created_at DESC, id DESC`,
    [req.mysqlUser.id],
  );
  res.json({ reports: rows.map(mysqlReportFromRow) });
}));

app.get("/api/mysql/admin/reports", ...mysqlAdminOnly, asyncHandler(async (req, res) => {
  const [rows] = await mysqlPool.query("SELECT * FROM reports ORDER BY created_at DESC, id DESC");
  res.json({ reports: rows.map(mysqlReportFromRow) });
}));

app.patch("/api/mysql/admin/reports/:id/status", ...mysqlAdminOnly, asyncHandler(async (req, res) => {
  const status = String(req.body.status || "").trim();
  if (!MYSQL_REPORT_STATUSES.has(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${[...MYSQL_REPORT_STATUSES].join(", ")}` });
  }

  const [result] = await mysqlPool.execute(
    "UPDATE reports SET status = ? WHERE id = ?",
    [status, Number(req.params.id)],
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Report not found." });

  const [rows] = await mysqlPool.execute("SELECT * FROM reports WHERE id = ?", [Number(req.params.id)]);
  res.json({ report: mysqlReportFromRow(rows[0]) });
}));

app.post("/api/mysql/items", mysqlAuth, asyncHandler(async (req, res) => {
  const required = ["title", "description", "category", "location", "date", "kind"];
  const missing = required.filter((key) => !String(req.body[key] || "").trim());
  if (missing.length) return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });

  const kind = req.body.kind === "found" ? "found" : "lost";
  const reporter = String(req.mysqlUser.name || "").trim();
  const email = normalizeEmail(req.mysqlUser.email);
  const phone = String(req.mysqlUser.phone || req.body.phone || "").trim();
  const uiuId = String(req.mysqlUser.uiu_id || req.body.uiuId || "").trim();
  const [result] = await mysqlPool.execute(
    `INSERT INTO items
      (title, description, category, color, location, date, kind, status, reporter, email, phone, uiu_id, map_link, photo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'reported', ?, ?, ?, ?, ?, ?)`,
    [
      String(req.body.title).trim(),
      String(req.body.description).trim(),
      String(req.body.category).trim(),
      String(req.body.color || "").trim(),
      String(req.body.location).trim(),
      String(req.body.date).slice(0, 10),
      kind,
      reporter,
      email,
      phone,
      uiuId,
      String(req.body.map || "").trim(),
      req.body.photo || null,
    ],
  );
  const [rows] = await mysqlPool.execute("SELECT * FROM items WHERE id = ?", [result.insertId]);
  res.status(201).json({ item: mysqlItemFromRow(rows[0]) });
}));

app.get("/api/mysql/admin/dashboard", ...mysqlAdminOnly, asyncHandler(async (req, res) => {
  const [itemRows] = await mysqlPool.query("SELECT * FROM items ORDER BY created_at DESC, id DESC");
  const [userRows] = await mysqlPool.query("SELECT * FROM users ORDER BY created_at DESC, id DESC");
  const [claimRows] = await mysqlPool.query("SELECT status FROM claims");
  const [messageRows] = await mysqlPool.query("SELECT status FROM messages");
  const [reportRows] = await mysqlPool.query("SELECT status FROM reports");
  const stats = {
    totalLostItems: itemRows.filter((item) => item.kind === "lost").length,
    totalFoundItems: itemRows.filter((item) => item.kind === "found").length,
    pendingPosts: itemRows.filter((item) => ["reported", "pending"].includes(String(item.status || "").toLowerCase())).length,
    resolvedCases: itemRows.filter((item) => String(item.status || "").toLowerCase() === "returned").length,
    users: userRows.length,
    recentReports: itemRows.slice(0, 8).map(mysqlItemFromRow),
    openClaims: claimRows.filter((claim) => ["submitted", "under-review"].includes(String(claim.status || "").toLowerCase())).length,
    emergencyCases: 0,
    openComplaints: reportRows.filter((report) => ["open", "reviewing"].includes(String(report.status || "").toLowerCase())).length,
    openMessages: messageRows.filter((message) => String(message.status || "").toLowerCase() === "open").length,
    liveEvents: 0,
  };
  res.json({ stats });
}));

app.get("/api/mysql/admin/users", ...mysqlAdminOnly, asyncHandler(async (req, res) => {
  const [rows] = await mysqlPool.query("SELECT * FROM users ORDER BY created_at DESC, id DESC");
  res.json({ users: rows.map(mysqlUserFromRow) });
}));

app.patch("/api/mysql/admin/users/:id", ...mysqlAdminOnly, asyncHandler(async (req, res) => {
  const updates = [];
  const values = [];
  const allowedUserStatuses = new Set(["verified", "pending", "blocked"]);

  if (req.body.status !== undefined) {
    const status = mysqlStatusValue(req.body.status);
    if (!allowedUserStatuses.has(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${[...allowedUserStatuses].join(", ")}` });
    }
    updates.push("status = ?");
    values.push(status);
  }

  if (req.body.role !== undefined) {
    const normalizedRole = normalizeMysqlRole(req.body.role);
    if (String(req.body.role || "").trim() && normalizedRole === "student" && String(req.body.role || "").trim().toLowerCase() !== "student") {
      return res.status(400).json({ error: "Invalid role. Allowed: admin, moderator, security, student." });
    }
    updates.push("role = ?");
    values.push(normalizedRole);
  }

  if (!updates.length) return res.status(400).json({ error: "No valid user fields provided." });

  values.push(Number(req.params.id));
  const [result] = await mysqlPool.execute(
    `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
    values,
  );
  if (!result.affectedRows) return res.status(404).json({ error: "User not found." });

  const [rows] = await mysqlPool.execute("SELECT * FROM users WHERE id = ?", [Number(req.params.id)]);
  res.json({ user: mysqlUserFromRow(rows[0]) });
}));

app.patch("/api/mysql/items/:id/status", ...mysqlAdminOnly, asyncHandler(async (req, res) => {
  const allowedStatuses = new Set(["reported", ...ITEM_STATUSES]);
  const status = String(req.body.status || "").trim();
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${[...allowedStatuses].join(", ")}` });
  }

  const [result] = await mysqlPool.execute(
    "UPDATE items SET status = ? WHERE id = ?",
    [status, Number(req.params.id)],
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Item not found." });

  const [rows] = await mysqlPool.execute("SELECT * FROM items WHERE id = ?", [Number(req.params.id)]);
  res.json({ item: mysqlItemFromRow(rows[0]) });
}));

app.patch("/api/mysql/items/:id", ...mysqlAdminOnly, asyncHandler(async (req, res) => {
  const updates = [];
  const values = [];
  const fieldMap = {
    title: (value) => String(value).trim(),
    description: (value) => String(value).trim(),
    category: (value) => String(value).trim(),
    color: (value) => String(value).trim(),
    location: (value) => String(value).trim(),
    date: (value) => String(value).slice(0, 10),
  };

  Object.entries(fieldMap).forEach(([field, mapValue]) => {
    if (req.body[field] === undefined) return;
    updates.push(`${field} = ?`);
    values.push(mapValue(req.body[field]));
  });

  if (req.body.status !== undefined) {
    const allowedStatuses = new Set(["reported", ...ITEM_STATUSES]);
    const status = String(req.body.status || "").trim();
    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${[...allowedStatuses].join(", ")}` });
    }
    updates.push("status = ?");
    values.push(status);
  }

  if (!updates.length) return res.status(400).json({ error: "No valid item fields provided." });

  values.push(Number(req.params.id));
  const [result] = await mysqlPool.execute(
    `UPDATE items SET ${updates.join(", ")} WHERE id = ?`,
    values,
  );
  if (!result.affectedRows) return res.status(404).json({ error: "Item not found." });

  const [rows] = await mysqlPool.execute("SELECT * FROM items WHERE id = ?", [Number(req.params.id)]);
  res.json({ item: mysqlItemFromRow(rows[0]) });
}));

app.delete("/api/mysql/items/:id", ...mysqlAdminOnly, asyncHandler(async (req, res) => {
  const [result] = await mysqlPool.execute("DELETE FROM items WHERE id = ?", [Number(req.params.id)]);
  if (!result.affectedRows) return res.status(404).json({ error: "Item not found." });
  res.json({ ok: true });
}));

app.get("/api/realtime/admin", ...staffOnly, (req, res) => attachLiveClient(req, res, "admin"));
app.get("/api/realtime/me", auth, (req, res) => attachLiveClient(req, res, "user"));

app.post("/api/auth/register", authLimiter, requireFields(["name", "email", "password"]), (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (String(req.body.password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (db.get().users.some((user) => user.email === email)) return res.status(409).json({ error: "Email already registered." });
  const user = {
    id: db.id(),
    name: String(req.body.name).trim(),
    email,
    phone: String(req.body.phone || "").trim(),
    uiuId: String(req.body.uiuId || "").trim(),
    role: "user",
    status: "pending",
    emailVerified: false,
    phoneVerified: false,
    emailVerificationCode: createVerificationCode(),
    phoneVerificationCode: createVerificationCode(),
    passwordHash: hashPassword(req.body.password),
    createdAt: db.now(),
    updatedAt: db.now(),
  };
  db.set((state) => ({ ...state, users: [user, ...state.users] }));
  db.logActivity({ actorId: user.id, action: "auth.register", entityType: "user", entityId: user.id });
  const token = createToken({ sub: user.id, role: user.role });
  res.status(201).json({
    user: publicUser(user),
    token,
    demoVerification: { emailCode: user.emailVerificationCode, phoneCode: user.phoneVerificationCode },
  });
});

app.post("/api/auth/login", authLimiter, requireFields(["email", "password"]), (req, res) => {
  const user = db.get().users.find((entry) => entry.email === normalizeEmail(req.body.email));
  if (!user || !verifyPassword(req.body.password, user.passwordHash)) return res.status(401).json({ error: "Invalid email or password." });
  if (user.status === "blocked") return res.status(403).json({ error: "Account is blocked." });
  db.logActivity({ actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id });
  res.json({ user: publicUser(user), token: createToken({ sub: user.id, role: user.role }) });
});

app.post("/api/auth/logout", auth, (req, res) => {
  db.logActivity({ actorId: req.user.id, action: "auth.logout", entityType: "user", entityId: req.user.id });
  res.json({ ok: true });
});

app.get("/api/auth/me", auth, (req, res) => {
  res.json({ user: req.publicUser });
});

app.post("/api/auth/password-reset/request", requireFields(["email"]), (req, res) => {
  const user = db.get().users.find((entry) => entry.email === normalizeEmail(req.body.email));
  if (!user) return res.json({ ok: true });
  const resetToken = db.id();
  db.set((state) => ({
    ...state,
    users: state.users.map((entry) => entry.id === user.id ? { ...entry, resetToken, resetExpiresAt: Date.now() + 1000 * 60 * 20 } : entry),
  }));
  db.logActivity({ actorId: user.id, action: "auth.password_reset_requested", entityType: "user", entityId: user.id });
  res.json({ ok: true, demoResetToken: resetToken });
});

app.post("/api/auth/password-reset/confirm", requireFields(["token", "password"]), (req, res) => {
  const user = db.get().users.find((entry) => entry.resetToken === req.body.token && entry.resetExpiresAt > Date.now());
  if (!user) return res.status(400).json({ error: "Invalid or expired reset token." });
  db.set((state) => ({
    ...state,
    users: state.users.map((entry) => entry.id === user.id ? { ...entry, passwordHash: hashPassword(req.body.password), resetToken: null, resetExpiresAt: null, updatedAt: db.now() } : entry),
  }));
  db.logActivity({ actorId: user.id, action: "auth.password_reset_completed", entityType: "user", entityId: user.id });
  res.json({ ok: true });
});

app.post("/api/auth/verify/email", auth, requireFields(["code"]), (req, res) => {
  if (req.body.code !== req.user.emailVerificationCode) return res.status(400).json({ error: "Invalid email verification code." });
  db.set((state) => ({
    ...state,
    users: state.users.map((entry) => entry.id === req.user.id ? { ...entry, emailVerified: true, status: entry.status === "pending" ? "verified" : entry.status, updatedAt: db.now() } : entry),
  }));
  db.logActivity({ actorId: req.user.id, action: "auth.email_verified", entityType: "user", entityId: req.user.id });
  res.json({ ok: true });
});

app.post("/api/auth/verify/phone", auth, requireFields(["code"]), (req, res) => {
  if (req.body.code !== req.user.phoneVerificationCode) return res.status(400).json({ error: "Invalid phone verification code." });
  db.set((state) => ({
    ...state,
    users: state.users.map((entry) => entry.id === req.user.id ? { ...entry, phoneVerified: true, updatedAt: db.now() } : entry),
  }));
  db.logActivity({ actorId: req.user.id, action: "auth.phone_verified", entityType: "user", entityId: req.user.id });
  res.json({ ok: true });
});

app.get("/api/users/me", auth, (req, res) => res.json({ user: req.publicUser }));

app.patch("/api/users/me", auth, (req, res) => {
  const allowed = ["name", "phone", "uiuId"];
  db.set((state) => ({
    ...state,
    users: state.users.map((entry) => entry.id === req.user.id
      ? { ...entry, ...Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]])), updatedAt: db.now() }
      : entry),
  }));
  db.logActivity({ actorId: req.user.id, action: "user.profile_updated", entityType: "user", entityId: req.user.id });
  res.json({ user: publicUser(findById(db.get().users, req.user.id)) });
});

app.get("/api/categories", (req, res) => res.json({ categories: db.get().categories.filter((entry) => entry.active) }));
app.get("/api/locations", (req, res) => res.json({ locations: db.get().locations.filter((entry) => entry.active) }));

app.post("/api/uploads", auth, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Image file is required." });
  const file = { url: makeImageUrl(req, req.file), filename: req.file.filename, mimetype: req.file.mimetype, size: req.file.size };
  db.logActivity({ actorId: req.user.id, action: "image.uploaded", entityType: "upload", entityId: req.file.filename, metadata: file });
  res.status(201).json({ file });
});

app.get("/api/items/lost", (req, res) => res.json({ items: filterItems(db.get().items.filter((item) => item.type === "lost"), req.query) }));
app.get("/api/items/found", (req, res) => res.json({ items: filterItems(db.get().items.filter((item) => item.type === "found"), req.query) }));
app.post("/api/items/lost", ...createItemHandler("lost"));
app.post("/api/items/found", ...createItemHandler("found"));

app.get("/api/items/:id", (req, res) => {
  const item = findById(db.get().items, req.params.id);
  if (!item) return res.status(404).json({ error: "Item not found." });
  res.json({ item });
});

app.patch("/api/items/:id", auth, upload.single("image"), (req, res) => {
  const item = findById(db.get().items, req.params.id);
  if (!item) return res.status(404).json({ error: "Item not found." });
  if (!userCanEditItem(req.user, item)) return res.status(403).json({ error: "Only owner or staff can edit this item." });
  const allowed = ["title", "description", "categoryId", "category", "location", "color", "brand", "date", "contactName", "contactEmail", "contactPhone"];
  const updates = Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
  const image = makeImageUrl(req, req.file);
  db.set((state) => ({
    ...state,
    items: state.items.map((entry) => entry.id === item.id ? { ...entry, ...updates, images: image ? [...entry.images, image] : entry.images, updatedAt: db.now() } : entry),
  }));
  db.logActivity({ actorId: req.user.id, action: "item.updated", entityType: "item", entityId: item.id });
  recordLiveEvent("item.updated", { itemId: item.id, title: updates.title || item.title, actorId: req.user.id });
  res.json({ item: findById(db.get().items, item.id) });
});

app.delete("/api/items/:id", auth, (req, res) => {
  const item = findById(db.get().items, req.params.id);
  if (!item) return res.status(404).json({ error: "Item not found." });
  if (!userCanEditItem(req.user, item)) return res.status(403).json({ error: "Only owner or staff can delete this item." });
  db.set((state) => ({ ...state, items: state.items.filter((entry) => entry.id !== item.id), claims: state.claims.filter((claim) => claim.itemId !== item.id) }));
  db.logActivity({ actorId: req.user.id, action: "item.deleted", entityType: "item", entityId: item.id });
  recordLiveEvent("item.deleted", { itemId: item.id, title: item.title, actorId: req.user.id });
  res.json({ ok: true });
});

app.get("/api/search/items", (req, res) => res.json({ items: filterItems(db.get().items, req.query) }));

app.get("/api/matches", auth, (req, res) => {
  const matches = db.get().matches;
  if (["admin", "moderator", "security"].includes(req.user.role)) return res.json({ matches });
  const ownItemIds = new Set(db.get().items.filter((item) => item.reporterId === req.user.id).map((item) => item.id));
  res.json({ matches: matches.filter((match) => ownItemIds.has(match.lostItemId) || ownItemIds.has(match.foundItemId)) });
});

app.post("/api/claims", auth, requireFields(["itemId", "proof"]), (req, res) => {
  const item = findById(db.get().items, req.body.itemId);
  if (!item) return res.status(404).json({ error: "Item not found." });
  if (item.reporterId === req.user.id) return res.status(400).json({ error: "You cannot claim your own report." });
  const claim = {
    id: db.id(),
    itemId: item.id,
    claimantId: req.user.id,
    proof: String(req.body.proof).trim(),
    description: String(req.body.description || "").trim(),
    status: "submitted",
    adminNote: "",
    createdAt: db.now(),
    updatedAt: db.now(),
  };
  const fraudReview = fraudRisk({ user: req.user, claim, item, state: db.get() });
  const aiReview = {
    id: db.id(),
    type: "fraud-check",
    entityType: "claim",
    entityId: claim.id,
    result: fraudReview,
    createdAt: db.now(),
  };
  db.set((state) => ({ ...state, claims: [claim, ...state.claims], aiReviews: [aiReview, ...state.aiReviews] }));
  db.logActivity({ actorId: req.user.id, action: "claim.submitted", entityType: "claim", entityId: claim.id, metadata: { itemId: item.id } });
  createNotification({ userId: item.reporterId, title: "New claim submitted", message: `${req.user.name} submitted a claim for ${item.title}.`, entityType: "claim", entityId: claim.id });
  recordLiveEvent("claim.submitted", { claimId: claim.id, itemId: item.id, claimantId: req.user.id, fraudLevel: fraudReview.level });
  res.status(201).json({ claim, fraudReview });
});

app.get("/api/claims/my", auth, (req, res) => {
  res.json({ claims: db.get().claims.filter((claim) => claim.claimantId === req.user.id) });
});

app.post("/api/messages", auth, requireFields(["message"]), (req, res) => {
  const message = {
    id: db.id(),
    senderId: req.user.id,
    recipientId: req.body.recipientId || null,
    itemId: req.body.itemId || null,
    subject: req.body.subject || "Lost and found message",
    message: String(req.body.message).trim(),
    status: "open",
    createdAt: db.now(),
    updatedAt: db.now(),
  };
  db.set((state) => ({ ...state, messages: [message, ...state.messages] }));
  db.logActivity({ actorId: req.user.id, action: "message.created", entityType: "message", entityId: message.id });
  recordLiveEvent("message.created", { messageId: message.id, senderId: req.user.id, recipientId: message.recipientId, itemId: message.itemId });
  res.status(201).json({ message });
});

app.get("/api/messages/my", auth, (req, res) => {
  res.json({ messages: db.get().messages.filter((message) => message.senderId === req.user.id || message.recipientId === req.user.id) });
});

app.post("/api/reports", auth, requireFields(["type", "detail"]), (req, res) => {
  const report = {
    id: db.id(),
    reporterId: req.user.id,
    type: req.body.type,
    targetType: req.body.targetType || "general",
    targetId: req.body.targetId || null,
    detail: req.body.detail,
    status: "open",
    createdAt: db.now(),
    updatedAt: db.now(),
  };
  db.set((state) => ({ ...state, reports: [report, ...state.reports] }));
  db.logActivity({ actorId: req.user.id, action: "report.created", entityType: "report", entityId: report.id });
  recordLiveEvent("report.created", { reportId: report.id, type: report.type, targetType: report.targetType, targetId: report.targetId });
  res.status(201).json({ report });
});

app.get("/api/notifications", auth, (req, res) => {
  const notifications = db.get().notifications.filter((notification) => !notification.userId || notification.userId === req.user.id);
  res.json({ notifications });
});

app.patch("/api/notifications/:id/read", auth, (req, res) => {
  db.set((state) => ({
    ...state,
    notifications: state.notifications.map((entry) => entry.id === req.params.id && (!entry.userId || entry.userId === req.user.id) ? { ...entry, read: true } : entry),
  }));
  res.json({ ok: true });
});

app.post("/api/ai/match", auth, (req, res) => {
  const state = db.get();
  const target = req.body.itemId ? findById(state.items, req.body.itemId) : { id: `draft-${db.id()}`, ...req.body };
  if (!target) return res.status(404).json({ error: "Item not found." });
  if (req.body.itemId && !isStaff(req.user) && target.reporterId !== req.user.id) return res.status(403).json({ error: "You can only run private AI matching on your own reports." });
  const candidates = state.items.filter((item) => !["returned", "rejected", "expired"].includes(item.status));
  const matches = smartMatchItem(target, candidates, Number(req.body.minimumScore || 45));
  const review = saveAiReview({
    type: "ai-item-match",
    entityType: "item",
    entityId: target.id,
    input: { itemId: req.body.itemId || null, minimumScore: req.body.minimumScore || 45 },
    result: { matchCount: matches.length, topScore: matches[0]?.score || 0 },
  });
  res.json({ target, matches, reviewId: review.id });
});

app.post("/api/ai/image-recognition", auth, upload.single("image"), (req, res) => {
  const recognition = recognizeImageMetadata({
    ...req.body,
    filename: req.file?.filename,
    originalName: req.file?.originalname,
  });
  const file = req.file ? { url: makeImageUrl(req, req.file), filename: req.file.filename, mimetype: req.file.mimetype, size: req.file.size } : null;
  const review = saveAiReview({
    type: "image-recognition",
    entityType: req.body.itemId ? "item" : "draft",
    entityId: req.body.itemId || null,
    input: { hasFile: Boolean(req.file), filename: req.file?.originalname || null },
    result: recognition,
  });
  res.status(201).json({ recognition, file, reviewId: review.id });
});

app.post("/api/ai/chatbot", (req, res) => {
  const assistant = chatbotReply(req.body.message || "");
  res.json({ assistant });
});

app.post("/api/ai/suggestions", auth, (req, res) => {
  const state = db.get();
  const draft = { id: `draft-${db.id()}`, type: req.body.type || "lost", ...req.body };
  const matches = smartMatchItem(draft, state.items, Number(req.body.minimumScore || 35)).slice(0, 10);
  const duplicates = detectDuplicates(draft, state.items, 70).slice(0, 5);
  const likelyLocations = predictLostLocation({
    route: req.body.route || [],
    description: `${draft.title || ""} ${draft.description || ""}`,
    category: draft.category,
    items: state.items,
  }).slice(0, 5);
  const review = saveAiReview({
    type: "auto-suggestions",
    entityType: "draft",
    input: draft,
    result: { matches: matches.length, duplicates: duplicates.length, likelyLocations: likelyLocations.length },
  });
  res.json({ suggestions: { matches, duplicates, likelyLocations }, reviewId: review.id });
});

app.post("/api/ai/fraud-check", ...staffOnly, (req, res) => {
  const state = db.get();
  const claim = req.body.claimId ? findById(state.claims, req.body.claimId) : null;
  const item = claim ? findById(state.items, claim.itemId) : req.body.itemId ? findById(state.items, req.body.itemId) : null;
  const user = claim ? findById(state.users, claim.claimantId) : req.body.userId ? findById(state.users, req.body.userId) : null;
  if ((req.body.claimId && !claim) || (req.body.userId && !user) || (req.body.itemId && !item)) return res.status(404).json({ error: "Fraud review target not found." });
  const result = fraudRisk({ user: user || req.user, claim, item, state });
  const review = saveAiReview({
    type: "fraud-check",
    entityType: claim ? "claim" : user ? "user" : "item",
    entityId: claim?.id || user?.id || item?.id || null,
    input: { claimId: req.body.claimId || null, userId: req.body.userId || null, itemId: req.body.itemId || null },
    result,
  });
  res.json({ fraudReview: result, reviewId: review.id });
});

app.get("/api/ai/analytics", ...staffOnly, (req, res) => {
  res.json({ analytics: analyticsSnapshot(db.get()) });
});

app.post("/api/ai/lost-probability", auth, (req, res) => {
  const prediction = predictLostLocation({ ...req.body, items: db.get().items });
  const entry = {
    id: db.id(),
    userId: req.user.id,
    route: req.body.route || [],
    description: req.body.description || "",
    prediction,
    createdAt: db.now(),
  };
  db.set((state) => ({ ...state, routePredictions: [entry, ...state.routePredictions].slice(0, 200) }));
  res.status(201).json({ prediction, record: entry });
});

app.get("/api/ai/trust-score/:userId", auth, (req, res) => {
  if (!isStaff(req.user) && req.user.id !== req.params.userId) return res.status(403).json({ error: "You can only view your own trust score." });
  const user = findById(db.get().users, req.params.userId);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: publicUser(user), trust: trustScore(user, db.get()) });
});

app.post("/api/security/blockchain/record", ...staffOnly, requireFields(["entityType", "entityId", "action"]), (req, res) => {
  const state = db.get();
  const previousHash = state.blockchainLedger[0]?.hash;
  const ledgerBody = createLedgerEntry(previousHash, {
    entityType: req.body.entityType,
    entityId: req.body.entityId,
    action: req.body.action,
    actorId: req.user.id,
    note: req.body.note || "",
  });
  const entry = { id: db.id(), ...ledgerBody };
  db.set((current) => ({ ...current, blockchainLedger: [entry, ...current.blockchainLedger] }));
  db.logActivity({ actorId: req.user.id, action: "security.blockchain_recorded", entityType: req.body.entityType, entityId: req.body.entityId, metadata: { hash: entry.hash } });
  res.status(201).json({ ledgerEntry: entry });
});

app.get("/api/security/blockchain/:entityId", ...staffOnly, (req, res) => {
  const entries = db.get().blockchainLedger.filter((entry) => entry.payload?.entityId === req.params.entityId);
  res.json({ entries });
});

app.post("/api/security/face-verify", auth, upload.single("image"), (req, res) => {
  const uiuMatches = req.body.uiuId && req.user.uiuId && String(req.body.uiuId).trim() === String(req.user.uiuId).trim();
  const hasImage = Boolean(req.file || req.body.selfieHash);
  const confidence = Math.min(0.96, 0.38 + (uiuMatches ? 0.34 : 0) + (hasImage ? 0.18 : 0) + (req.user.emailVerified ? 0.06 : 0));
  const result = {
    provider: "local-demo-face-verification",
    verified: confidence >= 0.72,
    confidence,
    checks: {
      uiuIdMatch: Boolean(uiuMatches),
      selfieProvided: hasImage,
      emailVerified: Boolean(req.user.emailVerified),
    },
    note: "This endpoint keeps the contract ready for a real face verification provider.",
  };
  saveAiReview({ type: "face-verification", entityType: "user", entityId: req.user.id, result });
  res.json({ result });
});

app.post("/api/security/device-fingerprint", auth, requireFields(["fingerprint"]), (req, res) => {
  const userAgent = req.get("user-agent") || "";
  const hash = fingerprintHash(`${req.body.fingerprint}:${userAgent}`);
  const existing = db.get().deviceFingerprints.find((entry) => entry.hash === hash);
  const record = existing || {
    id: db.id(),
    hash,
    userId: req.user.id,
    label: req.body.label || "browser-device",
    status: "trusted",
    firstSeenAt: db.now(),
    lastSeenAt: db.now(),
  };
  db.set((state) => ({
    ...state,
    deviceFingerprints: existing
      ? state.deviceFingerprints.map((entry) => entry.hash === hash ? { ...entry, lastSeenAt: db.now(), userId: req.user.id } : entry)
      : [record, ...state.deviceFingerprints],
    users: state.users.map((user) => user.id === req.user.id
      ? { ...user, deviceFingerprints: [...new Set([...(user.deviceFingerprints || []), hash])], updatedAt: db.now() }
      : user),
  }));
  res.status(existing ? 200 : 201).json({ fingerprint: { ...record, hash }, allowed: record.status !== "banned" });
});

app.get("/api/location/heatmap", (req, res) => {
  res.json({ heatmap: analyticsSnapshot(db.get()).heatmap });
});

app.get("/api/location/geofences", auth, (req, res) => {
  res.json({ geofences: db.get().geofences.filter((entry) => entry.active) });
});

app.post("/api/location/geofences", ...staffOnly, requireFields(["name", "location"]), (req, res) => {
  const geofence = {
    id: db.id(),
    name: req.body.name,
    location: req.body.location,
    type: req.body.type || "campus",
    radiusMeters: Number(req.body.radiusMeters || 300),
    active: req.body.active !== false,
    createdAt: db.now(),
    updatedAt: db.now(),
  };
  db.set((state) => ({ ...state, geofences: [geofence, ...state.geofences] }));
  db.logActivity({ actorId: req.user.id, action: "location.geofence_created", entityType: "geofence", entityId: geofence.id });
  res.status(201).json({ geofence });
});

app.post("/api/location/geofences/check", auth, requireFields(["location"]), (req, res) => {
  const location = String(req.body.location).toLowerCase();
  const geofences = db.get().geofences.filter((entry) => entry.active && String(entry.location).toLowerCase().includes(location));
  if (geofences.length) {
    createNotification({
      userId: req.user.id,
      title: "Nearby lost and found zone",
      message: `You are near ${geofences[0].name}. Check recent found reports.`,
      entityType: "geofence",
      entityId: geofences[0].id,
    });
  }
  res.json({ inside: geofences.length > 0, geofences });
});

app.post("/api/location/routes/predict", auth, (req, res) => {
  const prediction = predictLostLocation({ ...req.body, items: db.get().items });
  const entry = {
    id: db.id(),
    userId: req.user.id,
    route: req.body.route || [],
    prediction,
    createdAt: db.now(),
  };
  db.set((state) => ({ ...state, routePredictions: [entry, ...state.routePredictions].slice(0, 200) }));
  res.status(201).json({ prediction, record: entry });
});

app.get("/api/rewards/me", auth, (req, res) => {
  res.json({
    points: Number(req.user.points || 0),
    badges: req.user.badges || [],
    rewards: db.get().rewards.filter((reward) => reward.userId === req.user.id),
  });
});

app.get("/api/rewards/leaderboard", (req, res) => {
  const leaderboard = db.get().users
    .map((user) => ({ user: publicUser(user), trust: trustScore(user, db.get()), points: Number(user.points || 0), badges: user.badges || [] }))
    .sort((a, b) => b.points - a.points || b.trust.score - a.trust.score)
    .slice(0, 20);
  res.json({ leaderboard });
});

app.post("/api/community/verify", auth, requireFields(["itemId", "vote"]), (req, res) => {
  const item = findById(db.get().items, req.body.itemId);
  if (!item) return res.status(404).json({ error: "Item not found." });
  const verification = {
    id: db.id(),
    itemId: item.id,
    claimId: req.body.claimId || null,
    verifierId: req.user.id,
    vote: req.body.vote,
    comment: req.body.comment || "",
    createdAt: db.now(),
  };
  db.set((state) => ({ ...state, communityVerifications: [verification, ...state.communityVerifications] }));
  db.logActivity({ actorId: req.user.id, action: "community.verification_created", entityType: "item", entityId: item.id, metadata: { vote: verification.vote } });
  res.status(201).json({ verification });
});

app.get("/api/users/:id/reputation", auth, (req, res) => {
  const user = findById(db.get().users, req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: publicUser(user), trust: trustScore(user, db.get()), rewards: db.get().rewards.filter((reward) => reward.userId === user.id) });
});

app.post("/api/automation/expire-posts", ...staffOnly, (req, res) => {
  const days = Number(req.body.days || db.get().settings.autoExpireDays || 60);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const expiredIds = [];
  db.set((state) => ({
    ...state,
    items: state.items.map((item) => {
      const time = new Date(item.date || item.createdAt).getTime();
      if (!["pending", "approved"].includes(item.status) || Number.isNaN(time) || time >= cutoff) return item;
      expiredIds.push(item.id);
      return { ...item, status: "expired", updatedAt: db.now() };
    }),
    automationRuns: [{ id: db.id(), type: "expire-posts", actorId: req.user.id, affectedIds: expiredIds, createdAt: db.now() }, ...state.automationRuns],
  }));
  db.logActivity({ actorId: req.user.id, action: "automation.posts_expired", entityType: "item", entityId: "batch", metadata: { count: expiredIds.length, days } });
  res.json({ expiredIds, count: expiredIds.length, days });
});

app.post("/api/automation/duplicates", auth, (req, res) => {
  const state = db.get();
  const target = req.body.itemId ? findById(state.items, req.body.itemId) : { id: `draft-${db.id()}`, ...req.body };
  if (!target) return res.status(404).json({ error: "Item not found." });
  if (req.body.itemId && !isStaff(req.user) && target.reporterId !== req.user.id) return res.status(403).json({ error: "You can only scan your own report." });
  res.json({ duplicates: detectDuplicates(target, state.items, Number(req.body.minimumScore || 72)) });
});

app.post("/api/automation/translate", auth, requireFields(["text"]), (req, res) => {
  const translation = {
    id: db.id(),
    userId: req.user.id,
    ...translateText(req.body.text, req.body.targetLanguage || "bn"),
    createdAt: db.now(),
  };
  db.set((state) => ({ ...state, translations: [translation, ...state.translations].slice(0, 300) }));
  res.status(201).json({ translation });
});

app.post("/api/recovery-tags", auth, requireFields(["label"]), (req, res) => {
  const item = req.body.itemId ? findById(db.get().items, req.body.itemId) : null;
  if (req.body.itemId && !item) return res.status(404).json({ error: "Item not found." });
  if (item && !userCanEditItem(req.user, item)) return res.status(403).json({ error: "Only owner or staff can create a tag for this item." });
  const code = generateRecoveryCode("QR");
  const tag = {
    id: db.id(),
    code,
    type: "qr",
    label: req.body.label,
    ownerId: req.user.id,
    itemId: item?.id || null,
    status: "active",
    recoveryUrl: `${db.get().settings.qrRecoveryBaseUrl}/${code}`,
    createdAt: db.now(),
    updatedAt: db.now(),
  };
  db.set((state) => ({ ...state, recoveryTags: [tag, ...state.recoveryTags] }));
  db.logActivity({ actorId: req.user.id, action: "recovery.qr_tag_created", entityType: "recovery-tag", entityId: tag.id });
  res.status(201).json({ tag });
});

app.get("/api/recovery-tags/:code", (req, res) => {
  const state = db.get();
  const tag = state.recoveryTags.find((entry) => entry.code === req.params.code);
  if (!tag || tag.status !== "active") return res.status(404).json({ error: "Recovery tag not found." });
  const item = tag.itemId ? findById(state.items, tag.itemId) : null;
  res.json({
    tag: { code: tag.code, label: tag.label, type: tag.type, status: tag.status },
    item: publicItem(item),
    nextStep: "Submit an anonymous return request or contact campus Lost & Found.",
  });
});

app.post("/api/nfc-tags", auth, requireFields(["label"]), (req, res) => {
  const code = generateRecoveryCode("NFC");
  const tag = {
    id: db.id(),
    code,
    type: "nfc",
    label: req.body.label,
    ownerId: req.user.id,
    itemId: req.body.itemId || null,
    status: "active",
    recoveryUrl: `${db.get().settings.qrRecoveryBaseUrl}/${code}`,
    createdAt: db.now(),
    updatedAt: db.now(),
  };
  db.set((state) => ({ ...state, nfcTags: [tag, ...state.nfcTags], recoveryTags: [tag, ...state.recoveryTags] }));
  db.logActivity({ actorId: req.user.id, action: "recovery.nfc_tag_created", entityType: "nfc-tag", entityId: tag.id });
  res.status(201).json({ tag });
});

app.post("/api/institutions", ...adminOnly, requireFields(["name"]), (req, res) => {
  const institution = {
    id: db.id(),
    name: req.body.name,
    contactEmail: req.body.contactEmail || "",
    type: req.body.type || "campus",
    status: "active",
    createdAt: db.now(),
    updatedAt: db.now(),
  };
  db.set((state) => ({ ...state, partnerInstitutions: [institution, ...state.partnerInstitutions] }));
  res.status(201).json({ institution });
});

app.post("/api/institutions/import-found-items", ...staffOnly, (req, res) => {
  if (!Array.isArray(req.body.items) || !req.body.items.length) return res.status(400).json({ error: "items must be a non-empty array." });
  const state = db.get();
  const imported = req.body.items.map((entry) => {
    const category = state.categories.find((item) => item.name.toLowerCase() === String(entry.category || "").toLowerCase()) || state.categories[0];
    return {
      id: db.id(),
      type: "found",
      title: entry.title || "Institution Found Item",
      description: entry.description || "",
      categoryId: category?.id || "",
      category: category?.name || entry.category || "Other",
      location: entry.location || req.body.defaultLocation || "Partner institution",
      color: entry.color || "",
      brand: entry.brand || "",
      date: entry.date || new Date().toISOString().slice(0, 10),
      status: req.body.status || "pending",
      reporterId: req.user.id,
      contactName: req.body.institutionName || req.user.name,
      contactEmail: req.user.email,
      contactPhone: req.user.phone || "",
      images: [],
      partnerInstitutionId: req.body.institutionId || null,
      createdAt: db.now(),
      updatedAt: db.now(),
    };
  });
  db.set((current) => ({ ...current, items: [...imported, ...current.items] }));
  db.logActivity({ actorId: req.user.id, action: "institution.found_items_imported", entityType: "item", entityId: "batch", metadata: { count: imported.length } });
  recordLiveEvent("institution.import", { count: imported.length, actorId: req.user.id });
  res.status(201).json({ items: imported });
});

app.post("/api/emergency/items/:id", auth, requireFields(["reason"]), (req, res) => {
  const item = findById(db.get().items, req.params.id);
  if (!item) return res.status(404).json({ error: "Item not found." });
  if (!userCanEditItem(req.user, item) && item.reporterId !== req.user.id) return res.status(403).json({ error: "Only the reporter or staff can mark this item urgent." });
  const emergency = {
    id: db.id(),
    itemId: item.id,
    requesterId: req.user.id,
    priority: req.body.priority || (db.get().settings.emergencyCategories.includes(item.category) ? "high" : "normal"),
    reason: req.body.reason,
    status: "open",
    assignedTo: null,
    createdAt: db.now(),
    updatedAt: db.now(),
  };
  db.set((state) => ({ ...state, emergencyCases: [emergency, ...state.emergencyCases] }));
  createNotification({ title: "Emergency case opened", message: `${item.title} needs priority review.`, entityType: "emergency", entityId: emergency.id });
  recordLiveEvent("emergency.created", { emergencyId: emergency.id, itemId: item.id, priority: emergency.priority });
  res.status(201).json({ emergency });
});

app.get("/api/admin/emergency", ...staffOnly, (req, res) => {
  res.json({ emergencyCases: db.get().emergencyCases });
});

app.patch("/api/admin/emergency/:id", ...staffOnly, (req, res) => {
  const emergency = findById(db.get().emergencyCases, req.params.id);
  if (!emergency) return res.status(404).json({ error: "Emergency case not found." });
  db.set((state) => ({
    ...state,
    emergencyCases: state.emergencyCases.map((entry) => entry.id === emergency.id
      ? { ...entry, status: req.body.status || entry.status, assignedTo: req.body.assignedTo || entry.assignedTo, adminNote: req.body.adminNote || entry.adminNote, updatedAt: db.now() }
      : entry),
  }));
  db.logActivity({ actorId: req.user.id, action: "admin.emergency_updated", entityType: "emergency", entityId: emergency.id });
  res.json({ emergency: findById(db.get().emergencyCases, emergency.id) });
});

app.post("/api/voice/report-draft", auth, requireFields(["transcript"]), (req, res) => {
  const draft = parseVoiceReport(req.body.transcript);
  const suggestions = smartMatchItem(draft, db.get().items, 35).slice(0, 5);
  saveAiReview({ type: "voice-report-parser", entityType: "draft", input: { transcript: req.body.transcript }, result: draft });
  res.json({ draft, suggestions });
});

app.post("/api/anonymous-return", requireFields(["itemId", "pickupPoint"]), (req, res) => {
  const item = findById(db.get().items, req.body.itemId);
  if (!item) return res.status(404).json({ error: "Item not found." });
  const pickup = {
    id: db.id(),
    code: generateRecoveryCode("PICKUP"),
    itemId: item.id,
    pickupPoint: req.body.pickupPoint,
    finderNote: req.body.finderNote || "",
    status: "pending-dropoff",
    createdAt: db.now(),
    updatedAt: db.now(),
  };
  db.set((state) => ({ ...state, pickupCodes: [pickup, ...state.pickupCodes] }));
  createNotification({ userId: item.reporterId, title: "Anonymous return started", message: `${item.title} may be returned at ${pickup.pickupPoint}.`, entityType: "anonymous-return", entityId: pickup.id });
  recordLiveEvent("anonymous_return.created", { pickupId: pickup.id, itemId: item.id });
  res.status(201).json({ pickup });
});

app.get("/api/anonymous-return/:code", (req, res) => {
  const pickup = db.get().pickupCodes.find((entry) => entry.code === req.params.code);
  if (!pickup) return res.status(404).json({ error: "Pickup code not found." });
  res.json({ pickup });
});

app.post("/api/integrations/wearables", auth, requireFields(["provider"]), (req, res) => {
  const integration = {
    id: db.id(),
    userId: req.user.id,
    provider: req.body.provider,
    deviceLabel: req.body.deviceLabel || "smart tracker",
    lastKnownLocation: req.body.lastKnownLocation || "",
    status: "connected-demo",
    createdAt: db.now(),
  };
  db.logActivity({ actorId: req.user.id, action: "integration.wearable_connected", entityType: "integration", entityId: integration.id, metadata: integration });
  res.status(201).json({ integration });
});

app.post("/api/ar/search-session", auth, (req, res) => {
  const prediction = predictLostLocation({ route: req.body.route || [], description: req.body.description || "", items: db.get().items });
  const session = {
    id: db.id(),
    userId: req.user.id,
    itemId: req.body.itemId || null,
    waypoints: prediction.map((entry, index) => ({ order: index + 1, location: entry.location, confidence: entry.probability })),
    status: "ready-demo",
    createdAt: db.now(),
  };
  res.status(201).json({ session });
});

app.get("/api/admin/live-events", ...staffOnly, (req, res) => {
  res.json({ liveEvents: db.get().liveEvents.slice(0, Number(req.query.limit || 100)) });
});

app.get("/api/admin/dashboard", ...adminOnly, (req, res) => {
  const state = db.get();
  const stats = {
    totalLostItems: state.items.filter((item) => item.type === "lost").length,
    totalFoundItems: state.items.filter((item) => item.type === "found").length,
    pendingPosts: state.items.filter((item) => item.status === "pending").length,
    resolvedCases: state.items.filter((item) => item.status === "returned").length,
    users: state.users.length,
    recentReports: state.items.slice(0, 8),
    openClaims: state.claims.filter((claim) => ["submitted", "under-review"].includes(claim.status)).length,
    emergencyCases: state.emergencyCases.filter((entry) => entry.status !== "closed").length,
    openComplaints: state.reports.filter((entry) => entry.status === "open").length,
    liveEvents: state.liveEvents.length,
  };
  res.json({ stats });
});

app.get("/api/admin/users", ...adminOnly, (req, res) => res.json({ users: db.get().users.map(adminSafeUser) }));
app.patch("/api/admin/users/:id", ...adminOnly, (req, res) => {
  const { status, role } = req.body;
  if (role && !USER_ROLES.includes(role)) return res.status(400).json({ error: `Invalid role. Allowed: ${USER_ROLES.join(", ")}` });
  db.set((state) => ({
    ...state,
    users: state.users.map((user) => user.id === req.params.id ? { ...user, status: status || user.status, role: role || user.role, updatedAt: db.now() } : user),
  }));
  db.logActivity({ actorId: req.user.id, action: "admin.user_updated", entityType: "user", entityId: req.params.id });
  res.json({ user: publicUser(findById(db.get().users, req.params.id)) });
});

app.post("/api/admin/categories", ...adminOnly, requireFields(["name"]), (req, res) => {
  const item = { id: db.id(), name: req.body.name, active: true, createdAt: db.now(), updatedAt: db.now() };
  db.set((state) => ({ ...state, categories: [item, ...state.categories] }));
  db.logActivity({ actorId: req.user.id, action: "admin.category_created", entityType: "category", entityId: item.id });
  res.status(201).json({ category: item });
});

app.patch("/api/admin/categories/:id", ...adminOnly, (req, res) => {
  db.set((state) => ({
    ...state,
    categories: state.categories.map((entry) => entry.id === req.params.id ? { ...entry, ...req.body, updatedAt: db.now() } : entry),
  }));
  db.logActivity({ actorId: req.user.id, action: "admin.category_updated", entityType: "category", entityId: req.params.id });
  res.json({ category: findById(db.get().categories, req.params.id) });
});

app.delete("/api/admin/categories/:id", ...adminOnly, (req, res) => {
  db.set((state) => ({ ...state, categories: state.categories.filter((entry) => entry.id !== req.params.id) }));
  db.logActivity({ actorId: req.user.id, action: "admin.category_deleted", entityType: "category", entityId: req.params.id });
  res.json({ ok: true });
});

app.post("/api/admin/locations", ...adminOnly, requireFields(["name"]), (req, res) => {
  const item = { id: db.id(), name: req.body.name, type: req.body.type || "campus", active: true, createdAt: db.now(), updatedAt: db.now() };
  db.set((state) => ({ ...state, locations: [item, ...state.locations] }));
  db.logActivity({ actorId: req.user.id, action: "admin.location_created", entityType: "location", entityId: item.id });
  res.status(201).json({ location: item });
});

app.patch("/api/admin/locations/:id", ...adminOnly, (req, res) => {
  db.set((state) => ({
    ...state,
    locations: state.locations.map((entry) => entry.id === req.params.id ? { ...entry, ...req.body, updatedAt: db.now() } : entry),
  }));
  db.logActivity({ actorId: req.user.id, action: "admin.location_updated", entityType: "location", entityId: req.params.id });
  res.json({ location: findById(db.get().locations, req.params.id) });
});

app.delete("/api/admin/locations/:id", ...adminOnly, (req, res) => {
  db.set((state) => ({ ...state, locations: state.locations.filter((entry) => entry.id !== req.params.id) }));
  db.logActivity({ actorId: req.user.id, action: "admin.location_deleted", entityType: "location", entityId: req.params.id });
  res.json({ ok: true });
});

app.patch("/api/admin/items/:id/status", ...staffOnly, requireFields(["status"]), (req, res) => {
  if (!assertAllowedStatus(req.body.status, ITEM_STATUSES, res)) return;
  db.set((state) => ({
    ...state,
    items: state.items.map((item) => item.id === req.params.id ? { ...item, status: req.body.status, updatedAt: db.now() } : item),
  }));
  db.logActivity({ actorId: req.user.id, action: "admin.item_status_updated", entityType: "item", entityId: req.params.id, metadata: { status: req.body.status } });
  recordLiveEvent("admin.item_status_updated", { itemId: req.params.id, status: req.body.status, actorId: req.user.id });
  res.json({ item: findById(db.get().items, req.params.id) });
});

app.get("/api/admin/claims", ...staffOnly, (req, res) => res.json({ claims: db.get().claims }));
app.patch("/api/admin/claims/:id/status", ...staffOnly, requireFields(["status"]), (req, res) => {
  if (!assertAllowedStatus(req.body.status, CLAIM_STATUSES, res)) return;
  const claim = findById(db.get().claims, req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found." });
  const reward = req.body.status === "returned"
    ? { id: db.id(), userId: claim.claimantId, points: 30, reason: "successful item return", entityType: "claim", entityId: claim.id, createdAt: db.now() }
    : null;
  db.set((state) => ({
    ...state,
    claims: state.claims.map((entry) => entry.id === claim.id ? { ...entry, status: req.body.status, adminNote: req.body.adminNote || entry.adminNote, updatedAt: db.now() } : entry),
    items: req.body.status === "returned" ? state.items.map((item) => item.id === claim.itemId ? { ...item, status: "returned", updatedAt: db.now() } : item) : state.items,
    rewards: reward ? [reward, ...state.rewards] : state.rewards,
    users: reward ? state.users.map((user) => {
      if (user.id !== claim.claimantId) return user;
      const points = Number(user.points || 0) + reward.points;
      const badges = new Set(user.badges || []);
      if (points >= 50) badges.add("campus-helper");
      if (points >= 100) badges.add("trusted-finder");
      return {
        ...user,
        points,
        badges: [...badges],
        reputation: {
          ...user.reputation,
          successfulReturns: Number(user.reputation?.successfulReturns || 0) + 1,
          approvedClaims: Number(user.reputation?.approvedClaims || 0) + 1,
        },
        updatedAt: db.now(),
      };
    }) : state.users,
  }));
  db.logActivity({ actorId: req.user.id, action: "admin.claim_status_updated", entityType: "claim", entityId: claim.id, metadata: { status: req.body.status } });
  createNotification({ userId: claim.claimantId, title: "Claim update", message: `Your claim was marked ${req.body.status}.`, entityType: "claim", entityId: claim.id });
  recordLiveEvent("admin.claim_status_updated", { claimId: claim.id, status: req.body.status, actorId: req.user.id });
  res.json({ claim: findById(db.get().claims, claim.id) });
});

app.get("/api/admin/messages", ...staffOnly, (req, res) => res.json({ messages: db.get().messages }));
app.patch("/api/admin/messages/:id/status", ...staffOnly, requireFields(["status"]), (req, res) => {
  db.set((state) => ({ ...state, messages: state.messages.map((entry) => entry.id === req.params.id ? { ...entry, status: req.body.status, updatedAt: db.now() } : entry) }));
  db.logActivity({ actorId: req.user.id, action: "admin.message_status_updated", entityType: "message", entityId: req.params.id });
  res.json({ message: findById(db.get().messages, req.params.id) });
});

app.get("/api/admin/reports", ...staffOnly, (req, res) => res.json({ reports: db.get().reports }));
app.patch("/api/admin/reports/:id/status", ...staffOnly, requireFields(["status"]), (req, res) => {
  db.set((state) => ({ ...state, reports: state.reports.map((entry) => entry.id === req.params.id ? { ...entry, status: req.body.status, updatedAt: db.now() } : entry) }));
  db.logActivity({ actorId: req.user.id, action: "admin.report_status_updated", entityType: "report", entityId: req.params.id });
  res.json({ report: findById(db.get().reports, req.params.id) });
});

app.get("/api/admin/matches", ...staffOnly, (req, res) => res.json({ matches: db.get().matches }));
app.post("/api/admin/matches/rebuild", ...staffOnly, (req, res) => {
  db.set((state) => ({ ...state, matches: buildMatches(state.items) }));
  db.logActivity({ actorId: req.user.id, action: "admin.matches_rebuilt", entityType: "match", entityId: "all" });
  res.json({ matches: db.get().matches });
});

app.post("/api/admin/notifications", ...adminOnly, requireFields(["title", "message"]), (req, res) => {
  const notification = createNotification({
    userId: req.body.userId || null,
    title: req.body.title,
    message: req.body.message,
    channel: req.body.channel || "app",
    entityType: "admin-notification",
  });
  db.logActivity({ actorId: req.user.id, action: "admin.notification_sent", entityType: "notification", entityId: notification.id });
  res.status(201).json({ notification });
});

app.get("/api/admin/statistics", ...staffOnly, (req, res) => {
  const state = db.get();
  const byCategory = state.items.reduce((acc, item) => ({ ...acc, [item.category]: (acc[item.category] || 0) + 1 }), {});
  const byMonth = state.items.reduce((acc, item) => {
    const month = String(item.date || item.createdAt).slice(0, 7);
    return { ...acc, [month]: (acc[month] || 0) + 1 };
  }, {});
  res.json({
    totals: {
      items: state.items.length,
      lost: state.items.filter((item) => item.type === "lost").length,
      found: state.items.filter((item) => item.type === "found").length,
      returned: state.items.filter((item) => item.status === "returned").length,
      claims: state.claims.length,
      users: state.users.length,
    },
    byCategory,
    byMonth,
  });
});

app.get("/api/admin/settings", ...adminOnly, (req, res) => res.json({ settings: db.get().settings }));
app.patch("/api/admin/settings", ...adminOnly, (req, res) => {
  db.set((state) => ({ ...state, settings: { ...state.settings, ...req.body } }));
  db.logActivity({ actorId: req.user.id, action: "admin.settings_updated", entityType: "settings", entityId: "site" });
  res.json({ settings: db.get().settings });
});

app.get("/api/admin/activity-logs", ...adminOnly, (req, res) => res.json({ activityLogs: db.get().activityLogs.slice(0, Number(req.query.limit || 100)) }));
app.get("/api/admin/sql/status", ...adminOnly, (req, res) => res.json({ database: db.info() }));
app.get("/api/admin/backups", ...adminOnly, (req, res) => res.json({ backups: db.listBackups().map((entry) => ({ file: entry.file })) }));
app.post("/api/admin/backups", ...adminOnly, (req, res) => {
  const file = db.backup(req.body.reason || "manual");
  res.status(201).json({ backup: { file: path.basename(file), directory: BACKUP_DIR } });
});

app.get("/api/docs", (req, res) => {
  res.json({
    auth: ["POST /api/auth/register", "POST /api/auth/login", "POST /api/auth/logout", "POST /api/auth/password-reset/request", "POST /api/auth/password-reset/confirm", "POST /api/auth/verify/email", "POST /api/auth/verify/phone"],
    items: ["GET /api/items/lost", "POST /api/items/lost", "GET /api/items/found", "POST /api/items/found", "GET /api/items/:id", "PATCH /api/items/:id", "DELETE /api/items/:id"],
    categories: ["GET /api/categories", "POST /api/admin/categories", "PATCH /api/admin/categories/:id", "DELETE /api/admin/categories/:id"],
    uploads: ["POST /api/uploads"],
    search: ["GET /api/search/items"],
    matching: ["GET /api/matches", "GET /api/admin/matches", "POST /api/admin/matches/rebuild"],
    claims: ["POST /api/claims", "GET /api/claims/my", "GET /api/admin/claims", "PATCH /api/admin/claims/:id/status"],
    smart: ["POST /api/ai/match", "POST /api/ai/image-recognition", "POST /api/ai/chatbot", "POST /api/ai/suggestions", "POST /api/ai/fraud-check", "GET /api/ai/analytics", "POST /api/ai/lost-probability", "GET /api/ai/trust-score/:userId"],
    security: ["POST /api/security/blockchain/record", "GET /api/security/blockchain/:entityId", "POST /api/security/face-verify", "POST /api/security/device-fingerprint"],
    location: ["GET /api/location/heatmap", "GET /api/location/geofences", "POST /api/location/geofences", "POST /api/location/geofences/check", "POST /api/location/routes/predict"],
    social: ["GET /api/rewards/me", "GET /api/rewards/leaderboard", "POST /api/community/verify", "GET /api/users/:id/reputation"],
    automation: ["POST /api/automation/expire-posts", "POST /api/automation/duplicates", "POST /api/automation/translate"],
    integrations: ["POST /api/recovery-tags", "GET /api/recovery-tags/:code", "POST /api/nfc-tags", "POST /api/institutions", "POST /api/institutions/import-found-items", "POST /api/integrations/wearables", "POST /api/ar/search-session"],
    emergency: ["POST /api/emergency/items/:id", "GET /api/admin/emergency", "PATCH /api/admin/emergency/:id", "POST /api/voice/report-draft", "POST /api/anonymous-return", "GET /api/anonymous-return/:code"],
    realtime: ["GET /api/realtime/admin", "GET /api/realtime/me", "GET /api/admin/live-events"],
    admin: ["GET /api/admin/dashboard", "GET /api/admin/users", "GET /api/admin/statistics", "GET /api/admin/activity-logs", "GET /api/admin/sql/status", "POST /api/admin/backups"],
  });
});

app.use((err, req, res, next) => {
  const status = err.message?.includes("Only JPG") ? 400 : 500;
  res.status(status).json({ error: err.message || "Server error." });
});

app.listen(PORT, () => {
  console.log(`UniFind API running on http://localhost:${PORT}`);
});
