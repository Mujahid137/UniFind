function normalize(value) {
  return String(value || "").toLowerCase();
}

function locationScore(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const xFirst = x.split(",")[0].trim();
  const yFirst = y.split(",")[0].trim();
  return xFirst && xFirst === yFirst ? 0.75 : 0;
}

function keywordOverlap(a, b) {
  const stop = new Set(["the", "and", "with", "item", "lost", "found", "has", "near"]);
  const setA = new Set(normalize(a).split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !stop.has(word)));
  const setB = new Set(normalize(b).split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !stop.has(word)));
  if (!setA.size || !setB.size) return 0;
  let common = 0;
  setA.forEach((word) => {
    if (setB.has(word)) common += 1;
  });
  return common / Math.max(setA.size, setB.size);
}

export function scorePair(lost, found) {
  let score = 0;
  if (normalize(lost.categoryId || lost.category) === normalize(found.categoryId || found.category)) score += 0.25;
  if (normalize(lost.color) && normalize(lost.color) === normalize(found.color)) score += 0.18;
  if (normalize(lost.brand) && normalize(lost.brand) === normalize(found.brand)) score += 0.12;
  score += locationScore(lost.location, found.location) * 0.2;
  score += keywordOverlap(`${lost.title} ${lost.description}`, `${found.title} ${found.description}`) * 0.25;
  return Math.round(score * 100);
}

export function buildMatches(items, minimumScore = 55) {
  const inactive = new Set(["returned", "rejected", "expired"]);
  const lostItems = items.filter((item) => item.type === "lost" && !inactive.has(item.status));
  const foundItems = items.filter((item) => item.type === "found" && !inactive.has(item.status));
  const matches = [];
  lostItems.forEach((lost) => {
    foundItems.forEach((found) => {
      const score = scorePair(lost, found);
      if (score >= minimumScore) {
        matches.push({
          id: `${lost.id}-${found.id}`,
          lostItemId: lost.id,
          foundItemId: found.id,
          score,
          status: "suggested",
          createdAt: new Date().toISOString(),
        });
      }
    });
  });
  return matches.sort((a, b) => b.score - a.score);
}
