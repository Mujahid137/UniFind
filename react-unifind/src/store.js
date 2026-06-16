import { create } from "zustand";

const STORAGE_KEY = "unifind-store-v2";

const lostSeed = [
  { id: 1, title: "Grey Hoodie", category: "Clothing", description: 'University hoodie, grey color, size M. Has my initials "JW" on the tag.', color: "Gray", location: "Recreation Center", date: "2026-04-23", reporter: "Jordan Williams", email: "jordan.w@university.edu", phone: "555-0109", kind: "lost", status: "reported" },
  { id: 2, title: "Black Backpack", category: "Bags", description: "North Face black backpack with laptop inside. Has a red keychain attached.", color: "Black", location: "Science Hall, Lecture Room 101", date: "2026-04-23", reporter: "Rachel Green", email: "rachel.g@university.edu", phone: "555-0107", kind: "lost", status: "reported" },
  { id: 3, title: "Blue Water Bottle", category: "Accessories", description: 'Hydroflask water bottle, blue color with dents on the bottom. Has my name "Alex".', color: "Blue", location: "Student Center Gym", date: "2026-04-22", reporter: "Alex Rodriguez", email: "alex.r@university.edu", phone: "555-0103", kind: "lost", status: "reported" },
];

const foundSeed = [
  { id: 101, title: "AirPods Pro", category: "Accessories", description: "Found AirPods Pro in white charging case near the vending machines.", color: "White", location: "Student Center, 1st Floor", date: "2026-04-24", reporter: "Tom Anderson", email: "t.anderson@university.edu", phone: "555-0108", kind: "found", status: "reported" },
  { id: 102, title: "Blue Insulated Bottle", category: "Accessories", description: "Found a blue Hydroflask near the treadmills. Looks well-used.", color: "Blue", location: "Student Center, Gym Lockers", date: "2026-04-22", reporter: "Jessica Park", email: "j.park@university.edu", phone: "555-0104", kind: "found", status: "reported" },
  { id: 103, title: "Black Smartphone", category: "Electronics", description: "Found a black smartphone near the study tables. Has a purple protective case.", color: "Black", location: "Library, 3rd Floor", date: "2026-04-20", reporter: "Emma Scott", email: "emma.s@university.edu", phone: "555-0114", kind: "found", status: "reported" },
];

const categorySeed = ["Mobile", "Wallet", "ID Card", "Bags", "Keys", "Documents", "Pets", "Electronics", "Accessories", "Clothing", "Other"];
const locationSeed = ["Main Library", "Student Center", "Recreation Center", "Science Hall", "Business Building", "Engineering Block", "Parking Lot C"];
const userSeed = [
  { id: 1, name: "Jordan Williams", email: "jordan.w@university.edu", role: "Student", status: "verified", joinedAt: "2026-04-12" },
  { id: 2, name: "Rachel Green", email: "rachel.g@university.edu", role: "Student", status: "verified", joinedAt: "2026-04-13" },
  { id: 3, name: "Guest User", email: "guest@unifind.demo", role: "Guest", status: "limited", joinedAt: "2026-04-16" },
];
const messageSeed = [
  { id: 1, name: "Campus Help Desk", email: "helpdesk@university.edu", subject: "Finder asked for pickup timing", message: "Can an owner collect items after 5 PM from the student center?", status: "open", createdAt: "2026-05-12T10:00:00.000Z" },
  { id: 2, name: "Alex Rodriguez", email: "alex.r@university.edu", subject: "Claim follow-up", message: "I submitted a claim for a blue bottle and want to know the next step.", status: "answered", createdAt: "2026-05-13T14:30:00.000Z" },
];
const complaintSeed = [
  { id: 1, type: "Fake Post", reporter: "Tom Anderson", target: "Black Backpack", detail: "Duplicate-looking report with mismatched contact information.", status: "open", createdAt: "2026-05-11T09:20:00.000Z" },
  { id: 2, type: "Spam", reporter: "Jessica Park", target: "Unknown user", detail: "Repeated claim messages without proof.", status: "reviewing", createdAt: "2026-05-14T15:10:00.000Z" },
];
const settingsSeed = {
  siteName: "UniFind",
  contactEmail: "support@unifind.demo",
  contactPhone: "+880 1700 000000",
  privacyPolicy: "Only verified claim details should be used for ownership review.",
  securityMode: "Strict admin login",
  notificationsEnabled: true,
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Unable to save UniFind state locally.", error);
  }
}

function makeNotification(text, extra = {}) {
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    text,
    date: new Date().toISOString(),
    read: false,
    audience: "user",
    ...extra,
  };
}

function isAdminAudienceNotification(notification = {}) {
  return notification.audience === "admin" || notification.source === "admin-review" || notification.type === "alert";
}

function notificationMatchesAudience(notification, audience) {
  if (!audience) return true;
  return audience === "admin" ? isAdminAudienceNotification(notification) : !isAdminAudienceNotification(notification);
}

function normalizeItem(item) {
  const status = item.status || "reported";
  const kind = item.kind === "found" || item.type === "found" ? "found" : "lost";
  const createdAt = item.createdAt || item.submittedAt || (item.date ? `${item.date}T00:00:00.000Z` : new Date().toISOString());
  return {
    ...item,
    kind,
    status,
    source: item.source || "student-report",
    adminStatus: item.adminStatus || (["reported", "pending"].includes(status) ? "pending-review" : "reviewed"),
    submittedAt: item.submittedAt || createdAt,
    createdAt,
  };
}

function normalizeText(s) {
  return String(s || "").toLowerCase();
}

function locationScore(a, b) {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const xFirst = x.split(",")[0].trim();
  const yFirst = y.split(",")[0].trim();
  return xFirst && xFirst === yFirst ? 0.75 : 0;
}

function keywordOverlap(a, b) {
  const stop = new Set(["the", "and", "with", "item", "lost", "found", "has"]);
  const setA = new Set(normalizeText(a).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w)));
  const setB = new Set(normalizeText(b).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w)));
  if (setA.size === 0 || setB.size === 0) return 0;
  let common = 0;
  setA.forEach((w) => { if (setB.has(w)) common += 1; });
  return common / Math.max(setA.size, setB.size);
}

function scorePair(lost, found) {
  let score = 0;
  if (normalizeText(lost.category) === normalizeText(found.category)) score += 0.3;
  if (normalizeText(lost.color) && normalizeText(lost.color) === normalizeText(found.color)) score += 0.2;
  score += locationScore(lost.location, found.location) * 0.2;
  score += keywordOverlap(`${lost.title} ${lost.description}`, `${found.title} ${found.description}`) * 0.3;
  return Math.round(score * 100);
}

function buildMatches(items) {
  const inactiveStatuses = new Set(["returned", "rejected", "expired"]);
  const lost = items.filter((x) => x.kind === "lost" && !inactiveStatuses.has(x.status));
  const found = items.filter((x) => x.kind === "found" && !inactiveStatuses.has(x.status));
  const matches = [];
  lost.forEach((l) => {
    found.forEach((f) => {
      const score = scorePair(l, f);
      if (score >= 55) matches.push({ id: `${l.id}-${f.id}`, lostId: l.id, foundId: f.id, score, status: "matched" });
    });
  });
  return matches.sort((a, b) => b.score - a.score);
}

const defaultState = {
  user: null,
  profile: { uiuId: "", phone: "", department: "", semester: "" },
  items: [...lostSeed, ...foundSeed],
  categories: categorySeed,
  locations: locationSeed,
  users: userSeed,
  messages: messageSeed,
  complaints: complaintSeed,
  settings: settingsSeed,
  savedFilters: {
    lost: { query: "", category: "All Categories", location: "All Locations", status: "All Statuses", sort: "Newest" },
    found: { query: "", category: "All Categories", location: "All Locations", status: "All Statuses", sort: "Newest" },
  },
  claims: [],
  notifications: [{ id: 1, text: "Welcome to UniFind. You can report and browse items.", date: new Date().toISOString(), read: false }],
};

function normalizeState(restored) {
  if (!restored || typeof restored !== "object") {
    return { ...defaultState, items: defaultState.items.map(normalizeItem) };
  }

  return {
    ...defaultState,
    ...restored,
    profile: {
      ...defaultState.profile,
      ...(restored.profile || {}),
    },
    items: Array.isArray(restored.items) ? restored.items.map(normalizeItem) : defaultState.items.map(normalizeItem),
    categories: Array.isArray(restored.categories) ? restored.categories : defaultState.categories,
    locations: Array.isArray(restored.locations) ? restored.locations : defaultState.locations,
    users: Array.isArray(restored.users) ? restored.users : defaultState.users,
    messages: Array.isArray(restored.messages) ? restored.messages : defaultState.messages,
    complaints: Array.isArray(restored.complaints) ? restored.complaints : defaultState.complaints,
    settings: {
      ...defaultState.settings,
      ...(restored.settings || {}),
    },
    savedFilters: {
      lost: {
        ...defaultState.savedFilters.lost,
        ...(restored.savedFilters?.lost || {}),
      },
      found: {
        ...defaultState.savedFilters.found,
        ...(restored.savedFilters?.found || {}),
      },
    },
    claims: Array.isArray(restored.claims) ? restored.claims : defaultState.claims,
    notifications: Array.isArray(restored.notifications)
      ? restored.notifications.map((notification) => ({
          read: false,
          audience: isAdminAudienceNotification(notification) ? "admin" : "user",
          ...notification,
        }))
      : defaultState.notifications,
  };
}

export const useAppStore = create((set, get) => {
  const restored = loadState();
  const initial = normalizeState(restored);
  const withMatches = { ...initial, matches: buildMatches(initial.items) };

  return {
    ...withMatches,
    login(mode, payload = {}) {
      const user = mode === "guest"
        ? { name: "Guest User", role: "Guest", email: "guest@unifind.demo" }
        : {
            name: payload.name || (mode === "signin" ? "UIU Student" : "New UIU User"),
            role: payload.role || "Student",
            email: payload.email || (mode === "signin" ? "student@uiu.ac.bd" : "newuser@uiu.ac.bd"),
          };
      const users = get().users.some((entry) => entry.email === user.email)
        ? get().users.map((entry) => (entry.email === user.email ? { ...entry, name: user.name, role: user.role } : entry))
        : [{ id: Date.now(), name: user.name, email: user.email, role: user.role, status: user.role === "Admin" ? "verified" : "pending", joinedAt: new Date().toISOString() }, ...get().users];
      const next = { ...get(), user, users };
      saveState(next);
      set({ user, users });
    },
    loginWithUser(userPayload) {
      const user = {
        id: userPayload.id,
        name: userPayload.name || "UIU Student",
        role: userPayload.role || "Student",
        email: userPayload.email,
      };
      const users = get().users.some((entry) => entry.email === user.email)
        ? get().users.map((entry) => (entry.email === user.email ? { ...entry, ...user, status: user.role === "Admin" ? "verified" : "verified" } : entry))
        : [{ ...user, status: "verified", joinedAt: userPayload.joinedAt || new Date().toISOString() }, ...get().users];
      const profile = {
        ...get().profile,
        phone: userPayload.phone || get().profile.phone || "",
        uiuId: userPayload.uiuId || get().profile.uiuId || "",
      };
      const next = { ...get(), user, users, profile };
      saveState(next);
      set({ user, users, profile });
    },
    logout() {
      const next = { ...get(), user: null };
      saveState(next);
      set({ user: null });
    },
    addItem(payload) {
      const createdAt = new Date().toISOString();
      const item = normalizeItem({
        ...payload,
        id: payload.id ?? Date.now(),
        status: "reported",
        adminStatus: "pending-review",
        reviewStatus: "pending",
        source: payload.source || "student-report",
        submittedAt: payload.submittedAt || createdAt,
        createdAt: payload.createdAt || createdAt,
      });
      const items = [item, ...get().items];
      const matches = buildMatches(items);
      const notifications = [
        makeNotification(`${payload.kind === "lost" ? "Lost" : "Found"} report submitted: ${payload.title}`, { actionTo: `/items/${item.id}` }),
        makeNotification(`Admin queue updated: ${payload.title} is waiting for review.`, { actionTo: "/admin", source: "admin-review", audience: "admin", type: "alert" }),
        ...get().notifications,
      ];
      if (matches.length > get().matches.length) {
        notifications.unshift(makeNotification("New potential match found.", { actionTo: "/matches" }));
      }
      const next = { ...get(), items, matches, notifications };
      saveState(next);
      set({ items, matches, notifications });
      return item;
    },
    replaceItems(incomingItems) {
      const items = Array.isArray(incomingItems) ? incomingItems.map(normalizeItem) : [];
      const matches = buildMatches(items);
      const next = { ...get(), items, matches };
      saveState(next);
      set({ items, matches });
    },
    replaceClaims(incomingClaims) {
      const claims = Array.isArray(incomingClaims) ? incomingClaims : [];
      const next = { ...get(), claims };
      saveState(next);
      set({ claims });
    },
    replaceMessages(incomingMessages) {
      const messages = Array.isArray(incomingMessages) ? incomingMessages : [];
      const next = { ...get(), messages };
      saveState(next);
      set({ messages });
    },
    replaceComplaints(incomingComplaints) {
      const complaints = Array.isArray(incomingComplaints) ? incomingComplaints : [];
      const next = { ...get(), complaints };
      saveState(next);
      set({ complaints });
    },
    mergeItems(incomingItems) {
      const normalizedIncoming = Array.isArray(incomingItems) ? incomingItems.map(normalizeItem) : [];
      if (!normalizedIncoming.length) return;
      const incomingIds = new Set(normalizedIncoming.map((item) => String(item.id)));
      const items = [
        ...normalizedIncoming,
        ...get().items.filter((item) => !incomingIds.has(String(item.id))),
      ];
      const matches = buildMatches(items);
      const next = { ...get(), items, matches };
      saveState(next);
      set({ items, matches });
    },
    saveFilter(kind, filter) {
      const savedFilters = { ...get().savedFilters, [kind]: filter };
      const next = { ...get(), savedFilters };
      saveState(next);
      set({ savedFilters });
    },
    updateMatchStatus(matchId, status) {
      const matches = get().matches.map((m) => (m.id === matchId ? { ...m, status } : m));
      const notifications = [makeNotification(`Match status updated to ${status}.`, { actionTo: "/matches" }), ...get().notifications];
      const next = { ...get(), matches, notifications };
      saveState(next);
      set({ matches, notifications });
    },
    updateItemStatus(itemId, status) {
      const items = get().items.map((item) => (
        item.id === itemId
          ? normalizeItem({ ...item, status })
          : item
      ));
      const matches = buildMatches(items);
      const target = items.find((item) => item.id === itemId);
      const notifications = [makeNotification(`${target?.title || "Item"} marked ${status}.`, { actionTo: target ? `/items/${target.id}` : "/admin" }), ...get().notifications];
      const next = { ...get(), items, matches, notifications };
      saveState(next);
      set({ items, matches, notifications });
    },
    updateItemDetails(itemId, payload) {
      const items = get().items.map((item) => (
        item.id === itemId
          ? normalizeItem({ ...item, ...payload })
          : item
      ));
      const matches = buildMatches(items);
      const target = items.find((item) => item.id === itemId);
      const notifications = [makeNotification(`${target?.title || "Item"} details updated.`, { actionTo: target ? `/items/${target.id}` : "/admin" }), ...get().notifications];
      const next = { ...get(), items, matches, notifications };
      saveState(next);
      set({ items, matches, notifications });
    },
    deleteItem(itemId) {
      const item = get().items.find((entry) => entry.id === itemId);
      const items = get().items.filter((entry) => entry.id !== itemId);
      const claims = get().claims.filter((claim) => claim.itemId !== itemId);
      const matches = buildMatches(items);
      const notifications = [makeNotification(`${item?.title || "Item"} deleted from reports.`, { actionTo: "/admin" }), ...get().notifications];
      const next = { ...get(), items, claims, matches, notifications };
      saveState(next);
      set({ items, claims, matches, notifications });
    },
    addCategory(name) {
      const clean = String(name || "").trim();
      if (!clean || get().categories.some((category) => category.toLowerCase() === clean.toLowerCase())) return;
      const categories = [...get().categories, clean].sort((a, b) => a.localeCompare(b));
      const next = { ...get(), categories };
      saveState(next);
      set({ categories });
    },
    removeCategory(name) {
      const categories = get().categories.filter((category) => category !== name);
      const next = { ...get(), categories };
      saveState(next);
      set({ categories });
    },
    addLocation(name) {
      const clean = String(name || "").trim();
      if (!clean || get().locations.some((location) => location.toLowerCase() === clean.toLowerCase())) return;
      const locations = [...get().locations, clean].sort((a, b) => a.localeCompare(b));
      const next = { ...get(), locations };
      saveState(next);
      set({ locations });
    },
    removeLocation(name) {
      const locations = get().locations.filter((location) => location !== name);
      const next = { ...get(), locations };
      saveState(next);
      set({ locations });
    },
    updateUserStatus(userId, status) {
      const users = get().users.map((entry) => (entry.id === userId ? { ...entry, status } : entry));
      const next = { ...get(), users };
      saveState(next);
      set({ users });
    },
    updateUserRole(userId, role) {
      const users = get().users.map((entry) => (entry.id === userId ? { ...entry, role } : entry));
      const next = { ...get(), users };
      saveState(next);
      set({ users });
    },
    updateMessageStatus(messageId, status) {
      const messages = get().messages.map((message) => (String(message.id) === String(messageId) ? { ...message, status } : message));
      const next = { ...get(), messages };
      saveState(next);
      set({ messages });
    },
    updateComplaintStatus(complaintId, status) {
      const complaints = get().complaints.map((complaint) => (String(complaint.id) === String(complaintId) ? { ...complaint, status } : complaint));
      const next = { ...get(), complaints };
      saveState(next);
      set({ complaints });
    },
    sendAdminNotification(text) {
      const clean = String(text || "").trim();
      if (!clean) return;
      const notifications = [makeNotification(clean, { actionTo: "/notifications", source: "admin" }), ...get().notifications];
      const next = { ...get(), notifications };
      saveState(next);
      set({ notifications });
    },
    updateSettings(payload) {
      const settings = { ...get().settings, ...payload };
      const next = { ...get(), settings };
      saveState(next);
      set({ settings });
    },
    submitClaim(payload) {
      const createdAt = payload.createdAt || new Date().toISOString();
      const claim = { status: "submitted", adminNote: "", createdAt, updatedAt: payload.updatedAt || createdAt, ...payload };
      const claims = [claim, ...get().claims.filter((entry) => String(entry.id) !== String(claim.id))];
      const notifications = [
        makeNotification(`Claim submitted for ${claim.itemTitle}.`, { actionTo: "/claims", date: createdAt }),
        makeNotification(`Claim review needed: ${claim.name || "A user"} submitted a claim for ${claim.itemTitle}.`, {
          actionTo: "/admin",
          audience: "admin",
          date: createdAt,
          source: "admin-review",
          type: "alert",
        }),
        ...get().notifications,
      ];
      const next = { ...get(), claims, notifications };
      saveState(next);
      set({ claims, notifications });
      return claim;
    },
    updateClaimStatus(claimId, status, adminNote = "") {
      const claim = get().claims.find((entry) => String(entry.id) === String(claimId));
      if (!claim) return;
      const updatedAt = new Date().toISOString();
      const claims = get().claims.map((entry) => (
        String(entry.id) === String(claimId) ? { ...entry, status, adminNote, updatedAt } : entry
      ));
      const shouldReturnItem = status === "returned";
      const items = shouldReturnItem
        ? get().items.map((item) => (String(item.id) === String(claim.itemId) ? { ...item, status: "returned" } : item))
        : get().items;
      const matches = shouldReturnItem ? buildMatches(items) : get().matches;
      const notifications = [
        makeNotification(`Claim for ${claim.itemTitle} marked ${status}.`, { actionTo: "/claims" }),
        ...get().notifications,
      ];
      const next = { ...get(), claims, items, matches, notifications };
      saveState(next);
      set({ claims, items, matches, notifications });
    },
    updateProfile(payload) {
      const profile = { ...get().profile, ...payload };
      const user = get().user ? { ...get().user, name: payload.name || get().user.name } : get().user;
      const next = { ...get(), profile, user };
      saveState(next);
      set({ profile, user });
    },
    markNotificationRead(notificationId) {
      const notifications = get().notifications.map((notification) => (
        notification.id === notificationId ? { ...notification, read: true } : notification
      ));
      const next = { ...get(), notifications };
      saveState(next);
      set({ notifications });
    },
    markAllNotificationsRead(audience = null) {
      const notifications = get().notifications.map((notification) => (
        notificationMatchesAudience(notification, audience) ? { ...notification, read: true } : notification
      ));
      const next = { ...get(), notifications };
      saveState(next);
      set({ notifications });
    },
    clearNotifications(audience = null) {
      const notifications = audience
        ? get().notifications.filter((notification) => !notificationMatchesAudience(notification, audience))
        : [];
      const next = { ...get(), notifications };
      saveState(next);
      set({ notifications });
    },
  };
});
