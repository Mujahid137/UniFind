-- UniFind admin credential update helper for phpMyAdmin / XAMPP
-- 1. Generate a password hash first:
--    node server/scripts/generate-password-hash.mjs "YourNewPassword123!"
-- 2. Copy the printed hash into the password field below.

USE unifind;

UPDATE users
SET
  email = 'admin@uiu.ac.bd',
  password = 'PASTE_GENERATED_HASH_HERE',
  updated_at = CURRENT_TIMESTAMP
WHERE role = 'admin'
ORDER BY id
LIMIT 1;
