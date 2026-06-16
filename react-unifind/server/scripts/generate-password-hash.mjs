import { hashPassword } from "../auth.js";

const password = process.argv[2] || "";

if (!password) {
  console.error("Usage: node server/scripts/generate-password-hash.mjs \"NewPassword123!\"");
  process.exit(1);
}

console.log(hashPassword(password));
