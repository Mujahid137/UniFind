CREATE DATABASE IF NOT EXISTS unifind
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE unifind;

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
);

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
);

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
);

ALTER TABLE claims ADD COLUMN IF NOT EXISTS claimant_name VARCHAR(255) NOT NULL DEFAULT '' AFTER claimant_id;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claimant_email VARCHAR(255) NOT NULL DEFAULT '' AFTER claimant_name;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claimant_phone VARCHAR(64) NULL AFTER claimant_email;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claimant_uiu_id VARCHAR(64) NULL AFTER claimant_phone;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS unique_mark TEXT NULL AFTER proof;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_seen VARCHAR(255) NULL AFTER unique_mark;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS preferred_return_location VARCHAR(255) NULL AFTER last_seen;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS admin_note TEXT NULL AFTER status;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

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
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255) NOT NULL DEFAULT '' AFTER sender_id;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_email VARCHAR(255) NOT NULL DEFAULT '' AFTER sender_name;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipient_id INT NULL AFTER sender_email;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS item_id INT NULL AFTER recipient_id;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'open' AFTER message;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

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
);

ALTER TABLE reports ADD COLUMN IF NOT EXISTS reporter_name VARCHAR(255) NOT NULL DEFAULT '' AFTER reporter_id;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reporter_email VARCHAR(255) NOT NULL DEFAULT '' AFTER reporter_name;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_label VARCHAR(255) NULL AFTER target_id;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'open' AFTER detail;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

INSERT INTO users (name, email, password, role, status, phone, uiu_id)
SELECT
  'UniFind Admin',
  'admin@uiu.ac.bd',
  '4dda8cf5aab3c57c29a44b14a9ddb137:779c7f855d4a48b7e08b6d28237c4a0bc8d922796dda6da8548eb1e2bc96a895c59fdf70e48fe02705ea92b31e4170960b4808397ad8ae5d6beef871dc3153af',
  'admin',
  'verified',
  '+8801700000001',
  'ADMIN-001'
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE email = 'admin@uiu.ac.bd'
);

INSERT INTO users (name, email, password, role, status, phone, uiu_id)
SELECT
  'Jordan Williams',
  'jordan.w@uiu.ac.bd',
  '33876045f88441d72e0a2dd41ca48d06:905cdc6c45d7ac1d83a568202601bc3a013a7095980b2777cf3f111d10e68f90e3935ddc05891cd76cf21af10f682f19fec50c60832f5a283e97a11211eebb56',
  'student',
  'verified',
  '+8801700000002',
  '011223001'
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE email = 'jordan.w@uiu.ac.bd'
);

INSERT INTO users (name, email, password, role, status, phone, uiu_id)
SELECT
  'Campus Security',
  'security@uiu.ac.bd',
  'c7723fa494dd701c5ee910a0d3a1c5cf:29aca8f3d7ba2c53b44fed2540592682e2126c61cd8f5bb2828bb1a8fb81d66b15e6e34fd61a0aae8fc2806df4da632801158547013e91ea8417512482666a7d',
  'security',
  'verified',
  '+8801700000003',
  'SEC-001'
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE email = 'security@uiu.ac.bd'
);

INSERT INTO items (title, description, category, color, location, date, kind, status, reporter, email, phone, uiu_id, map_link, photo)
SELECT
  'Black Samsung Phone',
  'Black Samsung phone lost near the library entrance. Clear case and a small crack on one corner.',
  'Mobile',
  'Black',
  'Main Library',
  '2026-06-10',
  'lost',
  'reported',
  'Jordan Williams',
  'jordan.w@uiu.ac.bd',
  '+8801700000002',
  '011223001',
  '',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM items WHERE title = 'Black Samsung Phone' AND email = 'jordan.w@uiu.ac.bd'
);

INSERT INTO items (title, description, category, color, location, date, kind, status, reporter, email, phone, uiu_id, map_link, photo)
SELECT
  'Blue Water Bottle',
  'Blue insulated bottle found near the Student Center gym lockers.',
  'Accessories',
  'Blue',
  'Student Center',
  '2026-06-11',
  'found',
  'approved',
  'Campus Security',
  'security@uiu.ac.bd',
  '+8801700000003',
  'SEC-001',
  '',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM items WHERE title = 'Blue Water Bottle' AND email = 'security@uiu.ac.bd'
);

INSERT INTO claims (item_id, claimant_id, claimant_name, claimant_email, claimant_phone, claimant_uiu_id, proof, unique_mark, last_seen, preferred_return_location, status, admin_note)
SELECT
  i.id,
  u.id,
  u.name,
  u.email,
  u.phone,
  u.uiu_id,
  'The lock screen wallpaper has my graduation photo and the back cover has a small crack near the camera.',
  'Small crack beside the camera edge',
  'Seen near the library entrance around noon',
  'Main Library front desk',
  'under-review',
  'Waiting for final owner verification.'
FROM items i
JOIN users u ON u.email = 'security@uiu.ac.bd'
WHERE i.title = 'Black Samsung Phone'
  AND NOT EXISTS (
    SELECT 1 FROM claims c WHERE c.item_id = i.id AND c.claimant_email = u.email
  );

INSERT INTO messages (sender_id, sender_name, sender_email, recipient_id, item_id, subject, message, status)
SELECT
  u.id,
  u.name,
  u.email,
  NULL,
  i.id,
  'Claim follow-up for Blue Water Bottle',
  'I want to confirm the pickup process and whether I should bring my student ID.',
  'open'
FROM items i
JOIN users u ON u.email = 'jordan.w@uiu.ac.bd'
WHERE i.title = 'Blue Water Bottle'
  AND NOT EXISTS (
    SELECT 1 FROM messages m WHERE m.subject = 'Claim follow-up for Blue Water Bottle' AND m.sender_email = u.email
  );

INSERT INTO reports (reporter_id, reporter_name, reporter_email, type, target_type, target_id, target_label, detail, status)
SELECT
  u.id,
  u.name,
  u.email,
  'Fake Post',
  'item',
  i.id,
  i.title,
  'This report looks suspicious because the contact details do not match the student directory record.',
  'reviewing'
FROM items i
JOIN users u ON u.email = 'security@uiu.ac.bd'
WHERE i.title = 'Blue Water Bottle'
  AND NOT EXISTS (
    SELECT 1 FROM reports r WHERE r.target_type = 'item' AND r.target_id = i.id AND r.reporter_email = u.email
  );
