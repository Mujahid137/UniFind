import crypto from "node:crypto";
import { JWT_SECRET, TOKEN_TTL_SECONDS } from "./config.js";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(input) {
  return crypto.createHmac("sha256", JWT_SECRET).update(input).digest("base64url");
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash = "") {
  const [salt, originalHash] = storedHash.split(":");
  if (!salt || !originalHash) return false;
  const candidate = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(originalHash, "hex"));
}

export function createToken(payload, ttlSeconds = TOKEN_TTL_SECONDS) {
  const header = { alg: "HS256", typ: "JWT" };
  const body = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function verifyToken(token = "") {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;
  const unsigned = `${header}.${payload}`;
  if (sign(unsigned) !== signature) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, resetToken, emailVerificationCode, phoneVerificationCode, ...safe } = user;
  return safe;
}

export function createVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
