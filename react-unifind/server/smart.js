import crypto from "node:crypto";

const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "item",
  "lost",
  "found",
  "near",
  "from",
  "this",
  "that",
  "has",
  "have",
  "was",
  "were",
  "for",
  "you",
  "your",
  "please",
]);

const COLORS = [
  "black",
  "white",
  "blue",
  "red",
  "green",
  "yellow",
  "orange",
  "purple",
  "pink",
  "brown",
  "gray",
  "grey",
  "silver",
  "gold",
  "navy",
  "maroon",
];

const BRANDS = [
  "apple",
  "samsung",
  "xiaomi",
  "oneplus",
  "oppo",
  "vivo",
  "huawei",
  "dell",
  "hp",
  "lenovo",
  "asus",
  "acer",
  "north face",
  "nike",
  "adidas",
  "honda",
  "toyota",
  "anker",
  "sony",
  "jbl",
];

const OBJECT_KEYWORDS = [
  { type: "Mobile", keywords: ["phone", "mobile", "iphone", "samsung", "smartphone", "android"] },
  { type: "Wallet", keywords: ["wallet", "purse", "card holder"] },
  { type: "ID Card", keywords: ["id", "student id", "identity", "card"] },
  { type: "Bag", keywords: ["bag", "backpack", "rucksack", "laptop bag"] },
  { type: "Keys", keywords: ["key", "keys", "keychain"] },
  { type: "Documents", keywords: ["document", "certificate", "passport", "license", "paper"] },
  { type: "Electronics", keywords: ["laptop", "charger", "earbuds", "airpods", "headphone", "tablet"] },
  { type: "Accessories", keywords: ["watch", "bottle", "umbrella", "glasses", "ring"] },
  { type: "Clothing", keywords: ["hoodie", "shirt", "jacket", "cap", "scarf"] },
  { type: "Pets", keywords: ["cat", "dog", "pet"] },
];

function clean(value) {
  return String(value || "").toLowerCase().trim();
}

function compact(values) {
  return values.filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

export function tokenize(value) {
  return clean(value)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

export function textSimilarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  setA.forEach((word) => {
    if (setB.has(word)) intersection += 1;
  });
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

function includesKeyword(text, keyword) {
  return clean(text).includes(clean(keyword));
}

function detectFromList(text, values) {
  return values.find((value) => includesKeyword(text, value)) || "";
}

function payloadText(payload = {}) {
  return compact([
    payload.title,
    payload.description,
    payload.category,
    payload.color,
    payload.brand,
    payload.location,
    payload.filename,
    payload.originalName,
    payload.ocrText,
    payload.extractedText,
    payload.transcript,
    payload.notes,
  ]).join(" ");
}

export function detectObjectType(payload = {}) {
  const text = payloadText(payload);
  const category = clean(payload.category);
  if (category) return payload.category;
  const match = OBJECT_KEYWORDS.find((entry) => entry.keywords.some((keyword) => includesKeyword(text, keyword)));
  return match?.type || "Unknown Item";
}

export function detectColor(payload = {}) {
  const text = payloadText(payload);
  const color = clean(payload.color);
  if (color) return payload.color;
  const found = detectFromList(text, COLORS);
  return found === "grey" ? "gray" : found;
}

export function detectBrand(payload = {}) {
  const text = payloadText(payload);
  const brand = clean(payload.brand);
  if (brand) return payload.brand;
  return detectFromList(text, BRANDS);
}

export function extractSerialCandidates(payload = {}) {
  const text = payloadText(payload);
  const patterns = [
    /\b\d{8,12}\b/g,
    /\b[A-Z0-9]{2,4}[- ]?[A-Z0-9]{4,8}[- ]?[A-Z0-9]{2,6}\b/gi,
    /\b(?:id|serial|sn|imei)\s*[:#-]?\s*([A-Z0-9-]{5,20})\b/gi,
  ];
  const matches = new Set();
  patterns.forEach((pattern) => {
    for (const match of text.matchAll(pattern)) {
      matches.add(String(match[1] || match[0]).toUpperCase().replace(/\s+/g, ""));
    }
  });
  return [...matches].slice(0, 8);
}

export function recognizeImageMetadata(payload = {}) {
  const objectType = detectObjectType(payload);
  const color = detectColor(payload);
  const brand = detectBrand(payload);
  const serialNumbers = extractSerialCandidates(payload);
  const tags = [...new Set([objectType, color, brand, ...tokenize(payloadText(payload)).slice(0, 6)].filter(Boolean))];
  const confidenceParts = [objectType !== "Unknown Item", Boolean(color), Boolean(brand), serialNumbers.length > 0]
    .filter(Boolean).length;

  return {
    provider: "local-demo-recognition",
    objectType,
    categorySuggestion: objectType === "Unknown Item" ? "" : objectType,
    primaryColor: color,
    brand,
    serialNumbers,
    ocrText: payload.ocrText || payload.extractedText || "",
    tags,
    confidence: Math.min(0.95, 0.45 + confidenceParts * 0.12),
    note: "This is a deterministic local recognizer. Connect OCR/image AI later behind the same response shape.",
  };
}

function locationSimilarity(a, b) {
  const first = clean(a);
  const second = clean(b);
  if (!first || !second) return 0;
  if (first === second) return 1;
  if (first.includes(second) || second.includes(first)) return 0.7;
  const firstTokens = new Set(tokenize(first));
  const secondTokens = new Set(tokenize(second));
  let overlap = 0;
  firstTokens.forEach((word) => {
    if (secondTokens.has(word)) overlap += 1;
  });
  return overlap ? Math.min(0.6, overlap / Math.max(firstTokens.size, secondTokens.size)) : 0;
}

function dateScore(a, b) {
  if (!a || !b) return 0.2;
  const first = new Date(a).getTime();
  const second = new Date(b).getTime();
  if (Number.isNaN(first) || Number.isNaN(second)) return 0.2;
  const days = Math.abs(first - second) / (1000 * 60 * 60 * 24);
  if (days <= 1) return 1;
  if (days <= 3) return 0.85;
  if (days <= 7) return 0.6;
  if (days <= 21) return 0.35;
  return 0.1;
}

export function scoreSmartPair(target, candidate) {
  const sameCategory = clean(target.categoryId || target.category) && clean(target.categoryId || target.category) === clean(candidate.categoryId || candidate.category);
  const sameColor = clean(target.color) && clean(target.color) === clean(candidate.color);
  const sameBrand = clean(target.brand) && clean(target.brand) === clean(candidate.brand);
  const text = textSimilarity(`${target.title} ${target.description}`, `${candidate.title} ${candidate.description}`);
  const location = locationSimilarity(target.location, candidate.location);
  const date = dateScore(target.date, candidate.date);
  const imageTags = textSimilarity((target.imageTags || target.tags || []).join(" "), (candidate.imageTags || candidate.tags || []).join(" "));

  const raw = (sameCategory ? 0.2 : 0) +
    (sameColor ? 0.16 : 0) +
    (sameBrand ? 0.14 : 0) +
    text * 0.24 +
    location * 0.16 +
    date * 0.06 +
    imageTags * 0.04;

  return Math.round(Math.min(1, raw) * 100);
}

export function smartMatchItem(target, candidates = [], minimumScore = 45) {
  return candidates
    .filter((candidate) => candidate.id !== target.id)
    .filter((candidate) => !target.type || !candidate.type || target.type !== candidate.type)
    .map((candidate) => ({
      item: candidate,
      score: scoreSmartPair(target, candidate),
      reasons: buildMatchReasons(target, candidate),
    }))
    .filter((entry) => entry.score >= minimumScore)
    .sort((a, b) => b.score - a.score);
}

export function detectDuplicates(target, items = [], minimumScore = 72) {
  return items
    .filter((item) => item.id !== target.id && (!target.type || item.type === target.type))
    .map((item) => ({ item, score: scoreSmartPair(target, item), reasons: buildMatchReasons(target, item) }))
    .filter((entry) => entry.score >= minimumScore)
    .sort((a, b) => b.score - a.score);
}

function buildMatchReasons(a, b) {
  const reasons = [];
  if (clean(a.categoryId || a.category) === clean(b.categoryId || b.category)) reasons.push("same category");
  if (clean(a.color) && clean(a.color) === clean(b.color)) reasons.push("same color");
  if (clean(a.brand) && clean(a.brand) === clean(b.brand)) reasons.push("same brand");
  if (locationSimilarity(a.location, b.location) >= 0.7) reasons.push("nearby or same location");
  if (textSimilarity(`${a.title} ${a.description}`, `${b.title} ${b.description}`) >= 0.25) reasons.push("similar title or description");
  if (dateScore(a.date, b.date) >= 0.85) reasons.push("close report date");
  return reasons;
}

export function fraudRisk({ user, claim, item, state }) {
  const reasons = [];
  let score = 5;
  const claims = state.claims || [];
  const reports = state.reports || [];

  if (!user?.emailVerified) {
    score += 12;
    reasons.push("email not verified");
  }
  if (!user?.phoneVerified) {
    score += 8;
    reasons.push("phone not verified");
  }
  if (claim?.proof && String(claim.proof).trim().length < 30) {
    score += 16;
    reasons.push("short ownership proof");
  }
  if (claim && item && item.reporterId === claim.claimantId) {
    score += 30;
    reasons.push("claimant is also the reporter");
  }
  const openClaimsByUser = claims.filter((entry) => entry.claimantId === user?.id && ["submitted", "under-review"].includes(entry.status));
  if (openClaimsByUser.length >= 3) {
    score += 18;
    reasons.push("multiple open claims");
  }
  const rejectedClaimsByUser = claims.filter((entry) => entry.claimantId === user?.id && entry.status === "rejected");
  if (rejectedClaimsByUser.length >= 2) {
    score += 22;
    reasons.push("repeated rejected claims");
  }
  const complaints = reports.filter((entry) => entry.targetId === user?.id || entry.targetId === claim?.id);
  if (complaints.length) {
    score += Math.min(22, complaints.length * 8);
    reasons.push("related complaints exist");
  }
  if (item?.status === "returned" || item?.status === "expired") {
    score += 10;
    reasons.push(`item is already ${item.status}`);
  }

  const capped = Math.min(100, score);
  return {
    score: capped,
    level: capped >= 70 ? "high" : capped >= 40 ? "medium" : "low",
    reasons: reasons.length ? reasons : ["no strong fraud signals"],
    recommendation: capped >= 70 ? "manual review required" : capped >= 40 ? "request extra proof" : "normal verification flow",
  };
}

export function buildHeatmap(items = []) {
  const byLocation = new Map();
  items.forEach((item) => {
    const key = item.location || "Unknown";
    const existing = byLocation.get(key) || {
      location: key,
      total: 0,
      lost: 0,
      found: 0,
      returned: 0,
      categories: {},
      latestReportAt: item.createdAt || item.date,
    };
    existing.total += 1;
    existing[item.type] = (existing[item.type] || 0) + 1;
    if (item.status === "returned") existing.returned += 1;
    existing.categories[item.category] = (existing.categories[item.category] || 0) + 1;
    existing.latestReportAt = [existing.latestReportAt, item.createdAt || item.date].filter(Boolean).sort().at(-1);
    byLocation.set(key, existing);
  });
  return [...byLocation.values()]
    .map((entry) => ({
      ...entry,
      intensity: Math.min(1, Number((entry.total / Math.max(1, items.length)).toFixed(2))),
      topCategory: Object.entries(entry.categories).sort((a, b) => b[1] - a[1])[0]?.[0] || "",
    }))
    .sort((a, b) => b.total - a.total);
}

export function predictLostLocation({ route = [], description = "", category = "", items = [] }) {
  const routeList = Array.isArray(route)
    ? route
    : String(route || "").split(/[,>;-]+/).map((entry) => entry.trim()).filter(Boolean);
  const heatmap = buildHeatmap(items);
  const scores = routeList.map((location) => {
    const heat = heatmap.find((entry) => clean(entry.location) === clean(location));
    const textScore = textSimilarity(`${description} ${category}`, `${location} ${heat?.topCategory || ""}`);
    return {
      location,
      probability: Math.min(0.94, 0.25 + (heat?.intensity || 0) * 0.45 + textScore * 0.3),
      signals: compact([
        heat ? `${heat.total} reports in this area` : "route location provided by user",
        heat?.topCategory ? `common category: ${heat.topCategory}` : "",
        textScore > 0 ? "description overlaps with area/category history" : "",
      ]),
    };
  });
  const fallback = heatmap.slice(0, 3).map((entry) => ({
    location: entry.location,
    probability: Math.min(0.9, 0.2 + entry.intensity * 0.5),
    signals: [`${entry.total} total reports`, entry.topCategory ? `common category: ${entry.topCategory}` : ""].filter(Boolean),
  }));
  return (scores.length ? scores : fallback).sort((a, b) => b.probability - a.probability);
}

export function translateText(text = "", targetLanguage = "bn") {
  const dictionary = {
    bn: {
      "lost item": "হারানো জিনিস",
      "found item": "পাওয়া জিনিস",
      "claim": "দাবি",
      "library": "লাইব্রেরি",
      "student": "শিক্ষার্থী",
      "wallet": "ওয়ালেট",
      "phone": "ফোন",
      "bag": "ব্যাগ",
    },
    en: {
      "হারানো জিনিস": "lost item",
      "পাওয়া জিনিস": "found item",
      "দাবি": "claim",
      "লাইব্রেরি": "library",
      "শিক্ষার্থী": "student",
      "ওয়ালেট": "wallet",
      "ফোন": "phone",
      "ব্যাগ": "bag",
    },
  };
  const table = dictionary[targetLanguage] || {};
  let translated = String(text || "");
  Object.entries(table).forEach(([source, target]) => {
    translated = translated.replace(new RegExp(source, "gi"), target);
  });
  return {
    provider: "local-demo-translation",
    sourceText: text,
    targetLanguage,
    translatedText: translated,
    confidence: translated === text ? 0.45 : 0.82,
  };
}

export function chatbotReply(message = "") {
  const text = clean(message);
  if (!text) {
    return { intent: "unknown", reply: "Tell me what you lost or found, where it happened, and when." };
  }
  if (/(claim|owner|proof|verify)/.test(text)) {
    return {
      intent: "claim_help",
      reply: "Open the item, submit a claim, add your UIU ID and ownership proof, then wait for admin verification.",
      suggestedActions: ["submit_claim", "upload_proof", "contact_admin"],
    };
  }
  if (/(lost|missing)/.test(text)) {
    return {
      intent: "report_lost",
      reply: "Create a lost report with category, color, brand, exact campus location, date, and a photo if you have one.",
      suggestedActions: ["create_lost_report", "search_found_items"],
    };
  }
  if (/(found|return|finder)/.test(text)) {
    return {
      intent: "report_found",
      reply: "Create a found report and avoid sharing sensitive details publicly. Admin can verify the owner before return.",
      suggestedActions: ["create_found_report", "generate_qr_tag"],
    };
  }
  if (/(admin|security|urgent|passport|card|id)/.test(text)) {
    return {
      intent: "emergency",
      reply: "For sensitive documents, mark the report as emergency so security staff can review it first.",
      suggestedActions: ["create_emergency_case", "notify_security"],
    };
  }
  return {
    intent: "general_search",
    reply: "Search by item name, color, category, location, and date. UniFind will also suggest possible matches automatically.",
    suggestedActions: ["search_items", "view_matches"],
  };
}

export function trustScore(user, state) {
  const items = state.items || [];
  const claims = state.claims || [];
  const reports = state.reports || [];
  let score = 50;

  if (user?.emailVerified) score += 8;
  if (user?.phoneVerified) score += 7;
  score += Math.min(12, items.filter((item) => item.reporterId === user?.id && item.status === "returned").length * 4);
  score += Math.min(12, claims.filter((claim) => claim.claimantId === user?.id && claim.status === "returned").length * 4);
  score -= Math.min(20, claims.filter((claim) => claim.claimantId === user?.id && claim.status === "rejected").length * 5);
  score -= Math.min(15, reports.filter((report) => report.targetId === user?.id && report.status !== "closed").length * 5);

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: finalScore,
    level: finalScore >= 80 ? "excellent" : finalScore >= 60 ? "trusted" : finalScore >= 40 ? "new" : "needs-review",
    badges: [
      user?.emailVerified ? "verified-email" : "",
      user?.phoneVerified ? "verified-phone" : "",
      finalScore >= 80 ? "trusted-finder" : "",
    ].filter(Boolean),
  };
}

export function analyticsSnapshot(state) {
  const items = state.items || [];
  const byCategory = items.reduce((acc, item) => ({ ...acc, [item.category]: (acc[item.category] || 0) + 1 }), {});
  const byMonth = items.reduce((acc, item) => {
    const month = String(item.date || item.createdAt || "").slice(0, 7) || "unknown";
    return { ...acc, [month]: (acc[month] || 0) + 1 };
  }, {});
  const byHour = items.reduce((acc, item) => {
    const hour = String(item.createdAt || "T12").split("T")[1]?.slice(0, 2) || "12";
    return { ...acc, [hour]: (acc[hour] || 0) + 1 };
  }, {});
  const heatmap = buildHeatmap(items);
  const mostCommonCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const peakHour = Object.entries(byHour).sort((a, b) => b[1] - a[1])[0]?.[0] || "12";

  return {
    totals: {
      items: items.length,
      lost: items.filter((item) => item.type === "lost").length,
      found: items.filter((item) => item.type === "found").length,
      returned: items.filter((item) => item.status === "returned").length,
      emergency: (state.emergencyCases || []).filter((entry) => entry.status !== "closed").length,
    },
    byCategory,
    byMonth,
    heatmap,
    predictions: {
      mostCommonCategory,
      highRiskAreas: heatmap.slice(0, 5),
      peakLossTime: `${peakHour}:00`,
      nextFocus: mostCommonCategory ? `Prepare extra checks for ${mostCommonCategory} near ${heatmap[0]?.location || "busy areas"}.` : "Collect more reports to improve predictions.",
    },
  };
}

export function createLedgerEntry(previousHash, payload) {
  const timestamp = new Date().toISOString();
  const body = { timestamp, payload };
  const hash = crypto
    .createHash("sha256")
    .update(`${previousHash || "genesis"}:${JSON.stringify(body)}`)
    .digest("hex");
  return { ...body, previousHash: previousHash || "genesis", hash };
}

export function fingerprintHash(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function generateRecoveryCode(prefix = "UF") {
  return `${prefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export function parseVoiceReport(transcript = "") {
  const payload = { transcript };
  const text = clean(transcript);
  const type = /(found|picked|saw)/.test(text) ? "found" : "lost";
  const locationMatch = text.match(/\b(?:near|at|inside|in|from)\s+([a-z0-9\s]+?)(?:\s+(?:on|at|with|yesterday|today)|$)/i);
  return {
    type,
    category: detectObjectType(payload),
    title: `${type === "lost" ? "Lost" : "Found"} ${detectObjectType(payload)}`,
    description: transcript,
    color: detectColor(payload),
    brand: detectBrand(payload),
    location: locationMatch?.[1]?.trim() || "",
  };
}
