// Disambiguation + dedup + gap-fill + cell aggregation builder.
// Reads 5 claim files + the 441-row feed, emits segmentation.json.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const PROD = path.join(ROOT, '产物');
const DATA = path.join(ROOT, 'data');

const feed = JSON.parse(fs.readFileSync(path.join(DATA, 'keywords-all.json'), 'utf8'));
const feedById = new Map(feed.map(r => [r.id, r]));

const themeFiles = ['zikr-ring', 'tasbih', 'name-necklace', 'islamic-jewelry', 'dhikr-knowledge'];
const claimsRaw = {};
for (const f of themeFiles) {
  claimsRaw[f] = JSON.parse(fs.readFileSync(path.join(PROD, `seg-${f}.json`), 'utf8'));
}

// ---- 1. Collect all claims + noise -------------------------------------
// claim record: {id, themeId, target, intent, pageType, keyword}
const allClaims = [];
const noiseMap = new Map(); // id -> {id, keyword, reason}
for (const f of themeFiles) {
  const j = claimsRaw[f];
  for (const a of (j.assignments || [])) {
    allClaims.push({ id: a.id, themeId: j.themeId, target: a.target, intent: a.intent, pageType: a.pageType, keyword: a.keyword });
  }
  for (const n of (j.noise || [])) {
    if (!noiseMap.has(n.id)) noiseMap.set(n.id, { id: n.id, keyword: n.keyword, reason: n.reason });
  }
}

// ---- 2. Disambiguation rules for overlaps (id claimed by >1) -----------
// Group claims by id.
const claimsById = new Map();
for (const c of allClaims) {
  if (!claimsById.has(c.id)) claimsById.set(c.id, []);
  claimsById.get(c.id).push(c);
}

// Preferred owner theme when a "prayer beads / tasbih-prayer" word is claimed
// by both tasbih and dhikr-knowledge with identical target=knowledge-dhikr:
// the subject is the dhikr *practice*, so dhikr-knowledge owns it.
const PREFER_THEME_ON_TIE = 'dhikr-knowledge';

function pickClaim(claims) {
  if (claims.length === 1) return claims[0];
  // All identical target? keep preferred theme.
  const targets = [...new Set(claims.map(c => c.target))];
  if (targets.length === 1) {
    const pref = claims.find(c => c.themeId === PREFER_THEME_ON_TIE);
    return pref || claims[0];
  }
  // Different targets: keep the most specific (non-pillar) scenario claim,
  // else first. (No such case in current data, but defensive.)
  const nonPillar = claims.find(c => c.target !== 'pillar');
  return nonPillar || claims[0];
}

// ---- 3. Claim-vs-noise conflict resolution -----------------------------
// A substantive positive claim beats a noise-mark from another theme.
// So: if an id is both claimed and noised, the claim wins (remove from noise).
const resolved = new Map(); // id -> winning claim
for (const [id, claims] of claimsById) {
  resolved.set(id, pickClaim(claims));
  if (noiseMap.has(id)) noiseMap.delete(id); // claim wins over noise
}

// ---- 4. Gap-fill: route unassigned feed rows ---------------------------
const claimedIds = new Set(resolved.keys());
const noisedIds = new Set(noiseMap.keys());
const unassignedRows = feed.filter(r => !claimedIds.has(r.id) && !noisedIds.has(r.id));

const kw = r => (r.keyword || '').toLowerCase();
const has = (r, ...subs) => subs.some(s => kw(r).includes(s));

// Returns {themeId, target, intent, pageType} or null (truly unassignable).
function route(r) {
  const k = kw(r);
  const ar = r.keyword || '';

  // Brand navigation -> not a topical cell.
  if (has(r, 'weslamic') || ar === "aisha's charms") return null;

  // Tasbih spelling variants (object) -> tasbih pillar.
  if (['tesbih', 'tespih', 'tasbi', 'tasbih', 'tasbeeh', 'tasbeh'].includes(k.trim())) {
    return { themeId: 'tasbih', target: 'pillar', intent: '信息型', pageType: '知识深度页' };
  }

  // Qibla / Kaaba direction & finder tools -> qibla-finder scenario.
  if (has(r, 'qibla', 'qiblah', 'kaaba compass', 'kaaba direction', 'kaba direction', 'which way is mecca')) {
    return { themeId: 'dhikr-knowledge', target: 'qibla-finder', intent: '信息型', pageType: '工具生态页' };
  }

  // Prayer-time / azan-time / salah-time tools & knowledge -> prayer-times scenario.
  if (has(r, 'prayer time', 'maghrib prayer', 'maghrib azan', 'what time salah', 'salah today',
      'prayer in riyadh', 'prayer time in riyadh', 'when is azan', 'when is maghrib', 'what time is salah')) {
    return { themeId: 'dhikr-knowledge', target: 'prayer-times', intent: '信息型', pageType: '工具生态页' };
  }

  // Ramadan / Hajj / Eid date & countdown knowledge -> knowledge-dhikr.
  if (has(r, 'when is ramadan', 'when does ramadan', 'days until ramadan', 'days till ramadan',
      'days to ramadan', 'days left till ramadan', 'how long until ramadan', 'berapa hari lagi ramadan',
      'when is hajj', 'when is azan', 'when is eid', 'how to perform hajj', 'how to apply for hajj',
      'how many pilgrims', 'how many hajj pilgrims', 'mansa musa', 'when will umrah')) {
    return { themeId: 'dhikr-knowledge', target: 'knowledge-dhikr', intent: '信息型', pageType: '知识深度页' };
  }

  // Gift-etiquette knowledge questions -> muslim-gifts (informational).
  if (has(r, 'gift') && has(r, 'do you give', 'do muslims give', 'do muslims exchange', 'can you give',
      'can a non muslim', 'can muslims accept', 'do people give', 'are gifts', 'what do you call a gift',
      'what gift', "what's the best gift", 'what is a good gift', 'what is an appropriate', 'what gifts do you',
      'do you give gifts', 'what is ramadan eid gift')) {
    return { themeId: 'islamic-jewelry', target: 'muslim-gifts', intent: '信息型', pageType: '知识深度页' };
  }

  // Gift product / occasion words (ramadan/eid/umrah/hajj gifts, boxes, sets) -> muslim-gifts.
  if (has(r, 'gift', 'gifts', 'presents', 'present', 'occasions') &&
      has(r, 'ramadan', 'eid', 'umrah', 'hajj', 'islamic', 'islam', 'salam', 'al fitr', 'al adha', 'for her', 'for kids')) {
    return { themeId: 'islamic-jewelry', target: 'muslim-gifts', intent: '交易型', pageType: '场景使用页' };
  }
  // bare "eid gifts"/"eid presents"/"ramadan gifts"/"umrah gifts" handled above; catch remaining gift+occasion.
  if (has(r, 'gift', 'gifts', 'presents') && has(r, 'ramadan', 'eid', 'umrah', 'hajj')) {
    return { themeId: 'islamic-jewelry', target: 'muslim-gifts', intent: '交易型', pageType: '场景使用页' };
  }

  // Prayer mat / prayer rug -> physical Islamic product, route to muslim-gifts catalog
  // (closest existing product/gift scenario; they are buyable Islamic items).
  if (has(r, 'prayer mat', 'prayer rug')) {
    return { themeId: 'islamic-jewelry', target: 'muslim-gifts', intent: '交易型', pageType: '品类聚合页' };
  }

  // Azan clock / islamic wall clock -> Islamic home product -> muslim-gifts catalog.
  if (has(r, 'azan clock', 'islamic wall clock')) {
    return { themeId: 'islamic-jewelry', target: 'muslim-gifts', intent: '交易型', pageType: '品类聚合页' };
  }

  // Gift-in-islam pure knowledge.
  if (has(r, 'gift in islam')) {
    return { themeId: 'islamic-jewelry', target: 'muslim-gifts', intent: '信息型', pageType: '知识深度页' };
  }

  return null; // unassignable
}

const unassigned = [];
let gapFilled = 0;
for (const r of unassignedRows) {
  const dec = route(r);
  if (!dec) {
    unassigned.push({ id: r.id, keyword: r.keyword, market: r.market, sv: r.sv, reason: brandOrOther(r) });
    continue;
  }
  resolved.set(r.id, { id: r.id, themeId: dec.themeId, target: dec.target, intent: dec.intent, pageType: dec.pageType, keyword: r.keyword });
  gapFilled++;
}

function brandOrOther(r) {
  const k = kw(r);
  if (k.includes('weslamic') || k === "aisha's charms") return '品牌/竞品导航词，非主题集群格子（属品牌主页，不进选题格子）';
  return '无法就近归入任何主题格子';
}

// ---- 5. Aggregate into cells (themeId, scenarioId) + pillars -----------
function enrich(id) {
  const r = feedById.get(id);
  const c = resolved.get(id);
  return {
    id,
    keyword: r ? r.keyword : c.keyword,
    market: r ? r.market : null,
    sv: r ? r.sv : null,
    intent: c.intent,
    pageType: c.pageType,
  };
}

const cellMap = new Map();   // key `${themeId}||${target}` (target != pillar)
const pillarMap = new Map(); // themeId -> []
for (const [id, c] of resolved) {
  if (c.target === 'pillar') {
    (pillarMap.get(c.themeId) || pillarMap.set(c.themeId, []).get(c.themeId)).push(enrich(id));
  } else {
    const key = `${c.themeId}||${c.target}`;
    (cellMap.get(key) || cellMap.set(key, []).get(key)).push(enrich(id));
  }
}

function dominantIntent(items) {
  const cnt = {};
  for (const it of items) cnt[it.intent] = (cnt[it.intent] || 0) + 1;
  return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
const topKw = items => [...items].sort((a, b) => (b.sv || 0) - (a.sv || 0)).slice(0, 5).map(i => i.keyword);

const cells = [...cellMap.entries()].map(([key, items]) => {
  const [themeId, scenarioId] = key.split('||');
  return { themeId, scenarioId, dominantIntent: dominantIntent(items), keywords: [...items].sort((a, b) => (b.sv || 0) - (a.sv || 0)) };
}).sort((a, b) => b.keywords.length - a.keywords.length);

const pillars = [...pillarMap.entries()].map(([themeId, items]) => ({
  themeId,
  keywords: [...items].sort((a, b) => (b.sv || 0) - (a.sv || 0)),
})).sort((a, b) => b.keywords.length - a.keywords.length);

const noise = [...noiseMap.values()].sort((a, b) => a.id - b.id);

const totalAssigned = resolved.size;
const noiseCount = noise.length;
const unassignedCount = unassigned.length;

const out = {
  stats: {
    feedTotal: feed.length,
    totalAssigned,
    noiseCount,
    unassignedCount,
    sum: totalAssigned + noiseCount + unassignedCount,
    gapFilled,
    cellCount: cells.length,
    pillarCount: pillars.length,
  },
  cells,
  pillars,
  noise,
  unassigned: unassigned.sort((a, b) => (b.sv || 0) - (a.sv || 0)),
};

fs.writeFileSync(path.join(PROD, 'segmentation.json'), JSON.stringify(out, null, 2), 'utf8');

// ---- console summary ----
console.log('feedTotal', feed.length, '| assigned', totalAssigned, '| noise', noiseCount, '| unassigned', unassignedCount, '| SUM', totalAssigned + noiseCount + unassignedCount);
console.log('gapFilled', gapFilled, '| cells', cells.length, '| pillars', pillars.length);
console.log('--- CELLS ---');
for (const c of cells) console.log(`${c.themeId} / ${c.scenarioId} : ${c.keywords.length}  [${c.dominantIntent}]  top: ${topKw(c.keywords).join(' | ')}`);
console.log('--- PILLARS ---');
for (const p of pillars) console.log(`${p.themeId} : ${p.keywords.length}  head: ${topKw(p.keywords).join(' | ')}`);
console.log('--- UNASSIGNED (' + unassigned.length + ') ---');
for (const u of out.unassigned) console.log(u.id, '| sv=' + u.sv, '|', u.keyword, '=>', u.reason);
