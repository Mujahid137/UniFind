# UniFind Backend API

Base URL for local development:

```txt
http://localhost:5000
```

Use `Authorization: Bearer <token>` for protected routes.

## Database

The project supports SQLite/JSON for legacy demo flows, but the current React frontend is wired to the MySQL API under `/api/mysql/*`.

For XAMPP:

1. Start MySQL from XAMPP.
2. Run [setup_xampp_mysql.ps1](/E:/UIU%20Versity%20file/Unifind/Unifind/Unifind/setup_xampp_mysql.ps1:1)
3. Use database `unifind`.
4. If you prefer phpMyAdmin import, use [xampp-unifind.sql](/E:/UIU%20Versity%20file/Unifind/Unifind/Unifind/react-unifind/server/sql/xampp-unifind.sql:1).
5. To manually change the admin email/password in phpMyAdmin, use [update-admin-credentials.sql](/E:/UIU%20Versity%20file/Unifind/Unifind/Unifind/react-unifind/server/sql/update-admin-credentials.sql:1) and generate a hash with `npm run password:hash -- "NewPassword123!"`.

Seeded admin account for local XAMPP setup:

```txt
email: admin@uiu.ac.bd
password: Admin123!
```

| Setting | Default | Purpose |
| --- | --- | --- |
| `DATABASE_DRIVER` | `sqlite` | Use `sqlite` for SQL storage or `json` for the old JSON adapter |
| `SQLITE_FILE` | `server/data/unifind.sqlite` | SQLite database file |
| `DB_FILE` | `server/data/unifind-db.json` | Legacy JSON file used for first-run import and JSON fallback |
| `DB_NAME` | `unifind` | XAMPP/MariaDB database used by `/api/mysql/*` |

On first SQLite startup, the backend imports existing data from `server/data/unifind-db.json` if the SQL database is empty.

## Auth

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Register user, returns JWT and demo verification codes |
| `POST` | `/api/auth/login` | Login and receive JWT |
| `POST` | `/api/auth/logout` | Log logout activity |
| `GET` | `/api/auth/me` | Current user |
| `POST` | `/api/auth/password-reset/request` | Create reset token |
| `POST` | `/api/auth/password-reset/confirm` | Set new password |
| `POST` | `/api/auth/verify/email` | Verify email code |
| `POST` | `/api/auth/verify/phone` | Verify phone code |

## Users And Roles

Roles supported: `admin`, `user`, `moderator`, `security`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/users/me` | Current user profile |
| `PATCH` | `/api/users/me` | Update name, phone, UIU ID |
| `GET` | `/api/admin/users` | Admin user list |
| `PATCH` | `/api/admin/users/:id` | Update status or role |

## MySQL Frontend API

These are the routes used by the current React frontend for sign-in, posting items, and the admin console.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/mysql/auth/signup` | Create MySQL-backed student account and return JWT |
| `POST` | `/api/mysql/auth/signin` | Login against MySQL users table and return JWT |
| `GET` | `/api/mysql/auth/me` | Restore session from JWT |
| `PATCH` | `/api/mysql/admin/account` | Admin-only email/password update with current password verification |
| `GET` | `/api/mysql/items` | Public item list from MySQL |
| `POST` | `/api/mysql/items` | Authenticated item creation using current MySQL user |
| `POST` | `/api/mysql/claims` | Submit a claim into MySQL |
| `GET` | `/api/mysql/claims/my` | Current user's claims plus claims on their own reports |
| `POST` | `/api/mysql/messages` | Create a MySQL-backed contact message |
| `GET` | `/api/mysql/messages/my` | Current user's sent/received messages |
| `POST` | `/api/mysql/reports` | Create a MySQL-backed complaint/report |
| `GET` | `/api/mysql/reports/my` | Current user's submitted reports |
| `GET` | `/api/mysql/admin/dashboard` | Admin dashboard summary from MySQL |
| `GET` | `/api/mysql/admin/users` | Admin user list from MySQL |
| `GET` | `/api/mysql/admin/claims` | Admin claim queue from MySQL |
| `PATCH` | `/api/mysql/admin/claims/:id/status` | Admin claim review/status update |
| `GET` | `/api/mysql/admin/messages` | Admin message queue from MySQL |
| `PATCH` | `/api/mysql/admin/messages/:id/status` | Admin message status update |
| `GET` | `/api/mysql/admin/reports` | Admin complaint queue from MySQL |
| `PATCH` | `/api/mysql/admin/reports/:id/status` | Admin complaint status update |
| `PATCH` | `/api/mysql/admin/users/:id` | Admin update user status or role |
| `PATCH` | `/api/mysql/items/:id` | Admin edit item |
| `PATCH` | `/api/mysql/items/:id/status` | Admin update item status |
| `DELETE` | `/api/mysql/items/:id` | Admin delete item |

## Lost And Found Items

Item statuses: `pending`, `approved`, `rejected`, `claimed`, `returned`, `expired`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/items/lost` | List lost items |
| `POST` | `/api/items/lost` | Create lost item report |
| `GET` | `/api/items/found` | List found items |
| `POST` | `/api/items/found` | Create found item report |
| `GET` | `/api/items/:id` | Item details |
| `PATCH` | `/api/items/:id` | Update own item or staff update |
| `DELETE` | `/api/items/:id` | Delete own item or staff delete |
| `PATCH` | `/api/admin/items/:id/status` | Approve, reject, claimed, returned, expired |

## Categories And Locations

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/categories` | Public categories |
| `POST` | `/api/admin/categories` | Add category |
| `PATCH` | `/api/admin/categories/:id` | Update category |
| `DELETE` | `/api/admin/categories/:id` | Delete category |
| `GET` | `/api/locations` | Public locations |
| `POST` | `/api/admin/locations` | Add location |
| `PATCH` | `/api/admin/locations/:id` | Update location |
| `DELETE` | `/api/admin/locations/:id` | Delete location |

## Image Upload

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/uploads` | Upload JPG, PNG, WEBP, or GIF up to configured size |

Use multipart form-data with field name `image`.

## Search And Filter

| Method | Endpoint | Query |
| --- | --- | --- |
| `GET` | `/api/search/items` | `q`, `category`, `categoryId`, `location`, `dateFrom`, `dateTo`, `color`, `brand`, `status`, `userId` |

The same query params work on `/api/items/lost` and `/api/items/found`.

## Matching

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/matches` | User/staff match list |
| `GET` | `/api/admin/matches` | Staff match review |
| `POST` | `/api/admin/matches/rebuild` | Recalculate all matches |

Matching compares category, color, brand, location, and keyword overlap.

## AI And Smart Features

These endpoints are implemented with deterministic local logic so the project works without paid AI services. The response shapes are ready for real AI/OCR/image providers later.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/ai/match` | Smart item matching for an existing item or draft |
| `POST` | `/api/ai/image-recognition` | Demo image/OCR metadata detection for category, color, brand, serials |
| `POST` | `/api/ai/chatbot` | Rule-based assistant for report/search/claim guidance |
| `POST` | `/api/ai/suggestions` | Suggest matches, duplicates, and likely locations while posting |
| `POST` | `/api/ai/fraud-check` | Staff fraud risk review for claims, users, or items |
| `GET` | `/api/ai/analytics` | Staff AI analytics snapshot and predictions |
| `POST` | `/api/ai/lost-probability` | Predict likely lost location from a route and description |
| `GET` | `/api/ai/trust-score/:userId` | View user AI trust score |

## Advanced Security

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/security/blockchain/record` | Staff-only tamper-evident hash ledger for claim/item actions |
| `GET` | `/api/security/blockchain/:entityId` | View ledger history for an entity |
| `POST` | `/api/security/face-verify` | Demo identity/selfie verification contract |
| `POST` | `/api/security/device-fingerprint` | Register or check device fingerprint status |

## Smart Location

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/location/heatmap` | Lost/found heatmap by campus location |
| `GET` | `/api/location/geofences` | Active geofencing zones |
| `POST` | `/api/location/geofences` | Staff create geofence |
| `POST` | `/api/location/geofences/check` | Check whether user is near a smart zone |
| `POST` | `/api/location/routes/predict` | Predict likely item loss points from a route |

## Claims And Verification

Claim statuses: `submitted`, `under-review`, `approved`, `rejected`, `returned`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/claims` | Submit ownership claim |
| `GET` | `/api/claims/my` | My claims |
| `GET` | `/api/admin/claims` | Staff claim queue |
| `PATCH` | `/api/admin/claims/:id/status` | Verify, approve, reject, return |

Returned claims automatically create reward points and reputation updates.

## Rewards, Reputation, Community

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/rewards/me` | My points, badges, and rewards |
| `GET` | `/api/rewards/leaderboard` | Trusted finder leaderboard |
| `POST` | `/api/community/verify` | Community vote/verification for item ownership |
| `GET` | `/api/users/:id/reputation` | Reputation and trust score summary |

## Notifications

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/notifications` | Current user notifications |
| `PATCH` | `/api/notifications/:id/read` | Mark notification read |
| `POST` | `/api/admin/notifications` | Send app/email/SMS-style notification |

## Messaging

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/messages` | Send safe message |
| `GET` | `/api/messages/my` | User message inbox |
| `GET` | `/api/admin/messages` | Staff message monitor |
| `PATCH` | `/api/admin/messages/:id/status` | Mark message status |

## Reports And Complaints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/reports` | Report fake post, fraud, spam, suspicious claim |
| `GET` | `/api/admin/reports` | Staff complaint queue |
| `PATCH` | `/api/admin/reports/:id/status` | Update complaint status |

## Automation

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/automation/expire-posts` | Staff expire old pending/approved posts |
| `POST` | `/api/automation/duplicates` | Detect duplicate lost/found posts |
| `POST` | `/api/automation/translate` | Demo Bangla/English translation contract |

## QR, NFC, Partner Integrations

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/recovery-tags` | Generate QR recovery tag |
| `GET` | `/api/recovery-tags/:code` | Public safe recovery tag lookup |
| `POST` | `/api/nfc-tags` | Generate NFC recovery tag |
| `POST` | `/api/institutions` | Admin create partner institution |
| `POST` | `/api/institutions/import-found-items` | Staff bulk-import found items from a campus/security partner |
| `POST` | `/api/integrations/wearables` | Demo wearable tracker integration contract |
| `POST` | `/api/ar/search-session` | Demo AR search session waypoints |

## Emergency, Voice, Anonymous Return

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/emergency/items/:id` | Mark sensitive item as emergency |
| `GET` | `/api/admin/emergency` | Staff emergency case queue |
| `PATCH` | `/api/admin/emergency/:id` | Assign or close emergency case |
| `POST` | `/api/voice/report-draft` | Parse spoken report transcript into a report draft |
| `POST` | `/api/anonymous-return` | Create secure anonymous return pickup code |
| `GET` | `/api/anonymous-return/:code` | Lookup anonymous return status |

## Real Time

Server-sent events are used instead of WebSockets so the app has real-time behavior without extra dependencies.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/realtime/admin` | Staff live monitoring stream |
| `GET` | `/api/realtime/me` | Current user notification stream |
| `GET` | `/api/admin/live-events` | Recent live event history |

## Admin, Backups, Logs

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/dashboard` | Admin dashboard stats |
| `GET` | `/api/admin/statistics` | Analytics reports |
| `GET` | `/api/admin/settings` | Site settings |
| `PATCH` | `/api/admin/settings` | Update site settings |
| `GET` | `/api/admin/activity-logs` | Activity logs |
| `GET` | `/api/admin/sql/status` | SQLite file path and table counts |
| `GET` | `/api/admin/backups` | List database backups |
| `POST` | `/api/admin/backups` | Create database backup |

## Security Included

- PBKDF2 password hashing
- HMAC JWT-style access tokens
- Role-based middleware
- Rate limiting
- Upload file type and size validation
- Security headers
- Input required-field checks
- Activity logs for important actions
- Device fingerprint records
- Tamper-evident blockchain-style ledger
- Fraud risk scoring
- Emergency case escalation
- Server-sent events for live admin monitoring
- SQLite tables for users, items, claims, messages, reports, settings, matches, logs, and advanced feature records

For production, move credentials and secrets into environment variables. SQLite is good for demos and small deployments; PostgreSQL or MySQL would be the next step for multi-server production hosting.
