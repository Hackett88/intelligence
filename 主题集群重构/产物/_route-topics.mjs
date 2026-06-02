import fs from 'fs';

const ROOT = 'C:/Users/lxpfo/Desktop/WESLAMIC/WESLAMIC SEO Intelligence APP/代码/主题集群重构';
const seg = JSON.parse(fs.readFileSync(`${ROOT}/产物/segmentation.json`, 'utf8'));
const all = JSON.parse(fs.readFileSync(`${ROOT}/data/keywords-all.json`, 'utf8'));

// enrichment map by id (real keyword/market/sv/kd/intent/behaviorIntent/pageType/layer)
const enr = new Map();
for (const r of all) enr.set(r.id, r);

// ---- collect every "in-segmentation-scope" keyword occurrence ----
// Each occurrence carries (id, cellKey) so we know which grid it came from.
// We dedupe by id at the END (one keyword = one topic). For dedupe we keep
// the first routed occurrence; routing rules are id+text based so any
// occurrence of the same id routes identically anyway.

const occurrences = []; // {id, cellKey}
for (const c of seg.cells) {
  const cellKey = `${c.themeId}×${c.scenarioId}`;
  for (const k of c.keywords) occurrences.push({ id: k.id, cellKey });
}
for (const p of seg.pillars) {
  const cellKey = `pillar:${p.themeId}`;
  for (const k of p.keywords) occurrences.push({ id: k.id, cellKey });
}
// unassigned: per task, brand words (weslamic*) → brand; smart-watch → defer (non-sold).
for (const u of seg.unassigned) occurrences.push({ id: u.id, cellKey: 'unassigned' });

// helper to read text
const kwText = (id) => (enr.get(id)?.keyword || '').toLowerCase();

// ---------- classification predicates ----------
const reSalatulTasbih = /\b(salatul tasbih|salat tasbeeh|sholat tasbih|solat tasbih|solat sunat tasbih|shalat tasbih|sholat tasbih|tata cara sholat tasbih|salatul tasbih padhne|tasbih prayer|berapa rakaat shalat tasbih|kapan sholat tasbih|kapan waktu sholat tasbih|apa itu sholat tasbih|apa itu shalat tasbih|do a sholat tasbih)\b/;
// note: "tasbih prayer" (id 212) = salatul tasbih prayer name

const isSalatulTasbih = (t) =>
  reSalatulTasbih.test(t) ||
  (/tasbih/.test(t) && /(prayer|pray|perform|read|rakat|rakaat|niyyah|how to|tata cara|kapan|berapa rakaat|padhne)/.test(t) && !/counter|beads|bead|digital|electronic|misbaha/.test(t));

// azan/adhan TIMING queries are prayer-time, not adhkar
const isAzanTiming = (t) => /\b(when is azan|what time .*azan|azan time|azan in london)\b/.test(t);

// dhikr / adhkar recitation words
const isDhikrAdhkar = (t) =>
  !isAzanTiming(t) && (
    /\b(dhikr|dzikir|zikr|adhkar|azkar)\b/.test(t) && !/ring|counter|tasbih ring/.test(t) ||
    /\b(after (salah|namaz|prayer)|azan ke baad ki dua|adhan|azan)\b/.test(t) && !/clock|nicole|salah leaving|mo salah/.test(t) ||
    /\b(subhanallah|alhamdulillah|allahu akbar|ayatul kursi|ayat al kursi)\b/.test(t) ||
    /how to do dhikr|how to do zikr/.test(t)
  );

// qibla
const isQibla = (t) => /\b(qibla|qiblah|qiblah|kaaba|kaba|kaaba direction|mecca|qiblat)\b/.test(t) && !/mansa musa|why did/.test(t);
// (also captured because they came from qibla-finder cell)

// slow living
const isSlowLiving = (t) => /\b(slow living|mindful|meditate|meditation|night routine)\b/.test(t);

// zikr ring
const isZikrRing = (t) => /zikr ring|خاتم ذكي|الخاتم الذكي|smart ring/.test(t) || (/ring/.test(t) && /zikr|dhikr/.test(t));

// digital counter
const isDigitalCounter = (t) =>
  /\b(tasbih counter|tasbeeh counter|tasbih digital counter|digital tasbih|digital tasbeeh|tasbeh|electronic tasbih|counter app|zikr ring counter)\b/.test(t) ||
  (/counter/.test(t) && /(tasbih|tasbeeh|tasbeh|zikr|dhikr)/.test(t)) ||
  /\btasbeh\b/.test(t);

// tasbih / prayer beads (physical beads)
const isTasbihBeads = (t) =>
  /\b(tasbih beads|tasbeeh beads|prayer beads|misbaha|misbahah|99 beads|tasbi|tesbih|tespih)\b/.test(t) ||
  /\bhow to make tasbih\b/.test(t) ||
  /\bhow to use (muslim )?prayer beads\b/.test(t) ||
  /\b(what is|what's) a? ?tasbih\b/.test(t) ||
  /\bapa itu tasbih\b/.test(t) ||
  /\bapa (arti|bacaan) tasbih\b/.test(t) ||
  /\bberapa (jumlah|kali membaca) tasbih\b/.test(t) ||
  /\bbagaimana (bacaan|bunyi) (kalimat |)tasbih\b/.test(t) ||
  /\bapa itu bertasbih\b/.test(t) ||
  /\bkapan kalimat tasbih\b/.test(t) ||
  /\b(what are|do muslims (use|have)) prayer beads\b/.test(t) ||
  (/\btasbih\b/.test(t) && !isSalatulTasbih(t) && !isDigitalCounter(t)) ||
  (/\btasbeeh\b/.test(t) && !isDigitalCounter(t));

// islamic jewelry
const isIslamicJewelry = (t) =>
  /\b(islamic jewelry|islamic jewellery|faith jewelry|aqeeq ring|aqeeq stone|spinner ring|fidget ring|fidget rings)\b/.test(t) ||
  /jewelry in islam|jewelry can a man wear|jewellery in islam/.test(t) ||
  /how to make a spinner ring/.test(t);

// name necklace (product)
const isNameNecklace = (t) => /name necklace/.test(t); // gold/arabic name necklace

// brand
const isBrand = (t) => /\bweslamic\b/.test(t) || /weslamic\.com/.test(t);

// ---------- DEFERRED predicates (out of scope) ----------
const isRamadanCalendar = (t) =>
  /\bwhen (is|does|will) (ramadan|hajj|umrah)\b/.test(t) ||
  /ramadan start|ramadan \d{4}|days (until|till|left|to) ramadan|how long until ramadan|berapa hari lagi ramadan|when is hajj|hajj \d{4}|how many days to ramadan|how to apply for hajj|how to perform hajj|how many pilgrims|how many hajj pilgrims|when will umrah start|mansa musa/.test(t);

const isHowToPrayGeneric = (t) =>
  (/\bhow to pray\b/.test(t) && !isSalatulTasbih(t)) ||
  /\bhow to (do|make|perform|offer) (wudu|ablution)\b/.test(t) ||
  /\bhow (do you|make) (do |make )?wudu\b/.test(t) ||
  /\bwhat (is|breaks) wudu\b/.test(t) ||
  /\b(does|do) .*break(s)? wudu\b/.test(t) ||
  /\b(do you need wudu|does sleeping break wudu|does burping|does vaping|does bleeding|does smoking)\b/.test(t) ||
  /\bhow many rakat(s)?\b/.test(t) ||
  /\bhow to (pray|perform) (eid|janazah|salah|fajr|isha|maghrib)\b/.test(t) ||
  /\bhow to make istikhara\b/.test(t) ||
  /\bhow to perform salah\b/.test(t) ||
  /\bwhat is salah\b/.test(t) ||
  /\bdoes praying in your head count\b/.test(t) ||
  /\bwhat (is|do you say in) (a )?adhan/.test(t) === false && false; // placeholder

const isPrayerTimes = (t) =>
  /\bprayer time(s)?\b/.test(t) ||
  /\b(maghrib|fajr|isha|asr|dhuhr) (prayer|azan)\b/.test(t) ||
  /\bwhat time (salah|is salah|prayer|is maghrib)\b/.test(t) ||
  /\bwhen is (the )?(maghrib|fajr|isha|azan)\b/.test(t) ||
  /what is maghrib prayer time|what is the prayer time/.test(t);

// non-sold physical gift goods
const isNonSoldGood = (t) =>
  /\b(prayer mat|prayer rug|azan clock|islamic wall clock|islamic toys|smart watch)\b/.test(t) ||
  /prayer mat praying/.test(t);

// ---------- main router ----------
const topicsDef = [
  { id: 'dhikr-adhkar', name: 'Dhikr & Adhkar', domain: 'dhikr-knowledge', band: 'T1' },
  { id: 'salatul-tasbih', name: 'Salatul Tasbih', domain: 'dhikr-knowledge', band: 'T2' },
  { id: 'qibla', name: 'Qibla & Prayer Direction', domain: 'dhikr-knowledge', band: 'T2' },
  { id: 'slow-living', name: 'Slow Living & Mindful Dhikr', domain: 'dhikr-knowledge', band: 'T3' },
  { id: 'zikr-ring', name: 'Zikr Ring', domain: 'zikr-ring', band: 'T1' },
  { id: 'digital-counter', name: 'Digital Tasbih Counters', domain: 'tasbih', band: 'T2' },
  { id: 'tasbih-beads', name: 'Tasbih / Prayer Beads', domain: 'tasbih', band: 'T1' },
  { id: 'islamic-jewelry', name: 'Islamic Jewelry', domain: 'islamic-jewelry', band: 'T2' },
  { id: 'name-necklace', name: 'Name Necklace', domain: 'name-necklace', band: 'T2' },
  { id: 'gifts', name: 'Islamic Gifts', domain: 'islamic-jewelry', band: 'T2' },
  { id: 'brand', name: 'Weslamic Brand', domain: 'zikr-ring', band: 'T1' },
];
const topics = new Map(topicsDef.map((t) => [t.id, { ...t, keywords: [] }]));
const deferred = [];
const seen = new Set(); // id dedupe
const warnings = [];

function enrich(id) {
  const e = enr.get(id) || {};
  return {
    id,
    keyword: e.keyword ?? null,
    market: e.market ?? null,
    sv: e.sv ?? null,
    kd: e.kd ?? null,
    intent: e.intent ?? null,
    behaviorIntent: e.behaviorIntent ?? null,
    pageType: e.pagePlanningIntent ?? null,
    layer: e.layer ?? null,
  };
}

function route(id, cellKey) {
  const t = kwText(id);
  if (!t) { warnings.push(`id ${id} has no keyword text in keywords-all.json`); }

  // ---- DEFERRED checks first (out of scope), but protect T1/T2 keepers ----
  // keepers: salatul tasbih (T2), dhikr after salah/namaz (T1)
  const keepDhikr = isDhikrAdhkar(t);
  const keepSalatul = isSalatulTasbih(t);

  // Brand
  if (isBrand(t)) return { kind: 'topic', topic: 'brand' };

  // Zikr ring (before generic ring / counter)
  if (isZikrRing(t) && !isDigitalCounter(t)) return { kind: 'topic', topic: 'zikr-ring' };

  // Name necklace product
  if (isNameNecklace(t)) return { kind: 'topic', topic: 'name-necklace' };

  // Qibla (came from qibla-finder cell or text match)
  if (cellKey === 'dhikr-knowledge×qibla-finder' || isQibla(t)) return { kind: 'topic', topic: 'qibla' };

  // Slow living
  if (cellKey === 'dhikr-knowledge×slow-living' || isSlowLiving(t)) return { kind: 'topic', topic: 'slow-living' };

  // Islamic jewelry
  if (isIslamicJewelry(t)) return { kind: 'topic', topic: 'islamic-jewelry' };

  // Digital counters
  if (isDigitalCounter(t)) return { kind: 'topic', topic: 'digital-counter' };

  // Salatul tasbih (keep, T2)
  if (keepSalatul) return { kind: 'topic', topic: 'salatul-tasbih' };

  // Dhikr & adhkar (keep, T1) — recitation/after-salah
  if (keepDhikr) return { kind: 'topic', topic: 'dhikr-adhkar' };

  // ---- GIFTS cell (islamic-jewelry×muslim-gifts) ----
  if (cellKey === 'islamic-jewelry×muslim-gifts') {
    if (isNonSoldGood(t)) return { kind: 'defer', reason: '不卖的实物礼品（prayer mat/rug / azan clock / islamic toys / wall clock）' };
    return { kind: 'topic', topic: 'gifts' };
  }

  // ---- Tasbih beads (physical) ----
  if (isTasbihBeads(t)) return { kind: 'topic', topic: 'tasbih-beads' };

  // ---- Out of scope: calendar / generic how-to-pray / prayer times / non-sold goods ----
  if (isRamadanCalendar(t)) return { kind: 'defer', reason: '斋月与历法（when is ramadan/hajj、days until ramadan 等）' };
  if (isHowToPrayGeneric(t)) return { kind: 'defer', reason: '礼拜实践通用（how to pray / wudu / rakats / janazah/eid/istikhara prayer 等）' };
  if (isPrayerTimes(t)) return { kind: 'defer', reason: '祈祷时间（maghrib/fajr/isha prayer time 等）' };
  if (isNonSoldGood(t)) return { kind: 'defer', reason: '不卖的实物礼品' };

  // ---- residual fallbacks by cell ----
  if (cellKey === 'dhikr-knowledge×knowledge-dhikr') {
    // leftover knowledge-dhikr that isn't dhikr/salatul/beads → likely adhan or generic practice
    if (/adhan|azan/.test(t)) return { kind: 'topic', topic: 'dhikr-adhkar' };
    return { kind: 'defer', reason: '礼拜实践通用（knowledge-dhikr 残留实践词）' };
  }
  if (cellKey === 'tasbih×itasbih-tools' || cellKey === 'zikr-ring×itasbih-tools') return { kind: 'topic', topic: 'digital-counter' };
  if (cellKey === 'tasbih×knowledge-dhikr' || cellKey === 'pillar:tasbih') return { kind: 'topic', topic: 'tasbih-beads' };
  if (cellKey === 'zikr-ring×knowledge-dhikr' || cellKey === 'pillar:zikr-ring') return { kind: 'topic', topic: 'zikr-ring' };
  if (cellKey === 'islamic-jewelry×islamic-jewelry' || cellKey === 'pillar:islamic-jewelry') return { kind: 'topic', topic: 'islamic-jewelry' };
  if (cellKey === 'pillar:dhikr-knowledge') return { kind: 'topic', topic: 'dhikr-adhkar' };
  if (cellKey === 'pillar:name-necklace' || cellKey === 'name-necklace×muslim-gifts') return { kind: 'topic', topic: 'name-necklace' };
  if (cellKey === 'dhikr-knowledge×prayer-times') return { kind: 'defer', reason: '祈祷时间（maghrib/fajr/isha prayer time 等）' };
  if (cellKey === 'unassigned') {
    if (/smart watch/.test(t)) return { kind: 'defer', reason: '不卖的实物（smart watch for kids，非自家品类）' };
    return { kind: 'defer', reason: '未匹配任何主题（unassigned 兜底搁置）' };
  }

  warnings.push(`id ${id} ("${t}") from cell ${cellKey} fell through to deferred (no rule matched)`);
  return { kind: 'defer', reason: '未匹配任何主题（兜底搁置）' };
}

for (const occ of occurrences) {
  if (seen.has(occ.id)) continue;
  seen.add(occ.id);
  const r = route(occ.id, occ.cellKey);
  if (r.kind === 'topic') {
    topics.get(r.topic).keywords.push(enrich(occ.id));
  } else {
    const e = enr.get(occ.id) || {};
    deferred.push({ id: occ.id, keyword: e.keyword ?? null, sv: e.sv ?? null, reason: r.reason });
  }
}

// sort each topic's keywords by sv desc
for (const t of topics.values()) t.keywords.sort((a, b) => (b.sv ?? 0) - (a.sv ?? 0));
deferred.sort((a, b) => (b.sv ?? 0) - (a.sv ?? 0));

const topicsArr = topicsDef.map((d) => topics.get(d.id));
const routedCount = topicsArr.reduce((s, t) => s + t.keywords.length, 0);

const out = {
  topics: topicsArr,
  deferred,
  stats: {
    totalInScopeOccurrences: occurrences.length,
    uniqueIds: seen.size,
    routedCount,
    deferredCount: deferred.length,
    topicCount: topicsArr.length,
    perTopic: Object.fromEntries(topicsArr.map((t) => [t.id, t.keywords.length])),
    warnings: warnings.length,
  },
};

fs.writeFileSync(`${ROOT}/产物/topics.json`, JSON.stringify(out, null, 2), 'utf8');

// console diagnostics
console.log('routed:', routedCount, 'deferred:', deferred.length, 'uniqueIds:', seen.size);
console.log('perTopic:', JSON.stringify(out.stats.perTopic));
console.log('warnings:', warnings.length);
warnings.forEach((w) => console.log('  WARN', w));
// print deferred breakdown by reason
const byReason = {};
for (const d of deferred) byReason[d.reason] = (byReason[d.reason] || 0) + 1;
console.log('deferred by reason:', JSON.stringify(byReason, null, 2));
