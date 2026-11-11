/* ============================================================
 * 校门口小卖部 —— 游戏逻辑（js/game.js）
 * 数据全部来自 data.js；这里只写规则、流程与界面渲染。
 * 流程骨架：startDay 生成当日访客队列 → nextVisitor 逐个接待
 * → endDay 收摊结算 → 次日循环。
 * ============================================================ */

/* ---------------- 工具函数 ---------------- */
const $ = (sel) => document.querySelector(sel);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const itemById = (id) => ITEMS.find((i) => i.id === id) || WHOLESALE.find((i) => i.id === id) || GRILL.foods.find((i) => i.id === id);
const regularById = (id) => REGULARS.find((r) => r.id === id);
let uidSeq = 1;
const nextUid = () => Date.now() * 100 + (uidSeq++ % 100);

/* ---------------- 游戏状态 ---------------- */
let state = null;
let currentTab = 'shelf';
let tradeOpen = false;
let inspectionFace = 0;
let inspectedPart = null;
let noticeTimer;
let viewedShelfUid = null;

function newState() {
  return {
    day: 1,
    economyVersion: 1,
    retailVersion: 1,
    progress: { sales: 0, days: 0, kept: [] },
    serviceTurns: 0,
    repVisits: 0,
    dailyRepLoss: 0,
    neighborSeen: {},
    neighborTalk: null,
    grill: { owned: false, supplies: {}, slots: [], studentDay: 0 },
    displaySlots: [],
    promoDay: 0,
    started: false,
    shopOpen: false,
    visitsToday: 0,
    clockServed: 0,
    guide: true,
    seenTutorials: [],
    openingMoney: CONFIG.startMoney,
    settlement: null,
    money: CONFIG.startMoney,
    rep: CONFIG.startRep,
    won: false,
    shelf: [],            // {uid,itemId,variant,value,cost}
    strategy: 'mid',
    wholesaleOrders: [],
    queue: [],            // 今日待接待访客
    current: null,        // 当前访客（运行时数据，可存档）
    daySales: [],         // 白天柜台成交 [{label,revenue,profit}]
    pendingComplaints: 0, // 白天卖出山寨货待结算的投诉数
    poke: { active: false, holesLeft: 0, holesOpened: 0, grandId: null, grandPos: -1, grandTaken: true },
    sticker: { on: false, rare: 0, grumble: 0, badge: false },
    ledger: [],           // {id,regularId,whoName,amount,due,done,result}
    collection: {},       // itemId -> {real,bad,fake}
    specialCards: { pokeGrand: false, jinlong: false },
    regulars: {},         // id -> {favor, visits}
    log: [],
  };
}

/* ---------------- 存档 ---------------- */
function save() {
  try { localStorage.setItem(CONFIG.saveKey, JSON.stringify(state)); } catch (e) { /* 忽略存档异常 */ }
}
function load() {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s.day !== 'number' || !Array.isArray(s.shelf)) return null;
    if (!s.economyVersion) {
      s.rep = clamp(s.rep - 50, -200, 200);
      for (const stock of s.shelf) if (FOOD_LIFE[stock.itemId]) stock.stockedDay = s.day;
      if (s.current && s.current.type === 'buyer') {
        const stock = s.shelf.find(entry => entry.uid === s.current.targetUid);
        s.current.wanted = stock ? itemCategory(itemById(stock.itemId)) : '食品';
        s.current.age = 'adult';
      }
    }
    if (!s.progress) {
      const kept = [];
      if (s.poke?.active || s.specialCards?.pokeGrand) kept.push('poke');
      if (s.sticker?.on || s.specialCards?.jinlong) kept.push('sticker');
      if (s.ledger?.length) kept.push('ledger');
      if (s.shelf.some(stock => !stock.wholesale)) kept.push('receiving');
      if (s.shelf.some(stock => !stock.wholesale && itemById(stock.itemId)?.base?.[1] > CONFIG.standardTradeMax)) kept.push('premium');
      s.progress = { sales: 0, days: s.day - (s.settlement ? 0 : 1), kept };
    }
    if (s.poke && !Array.isArray(s.poke.opened)) {
      s.poke.opened = Array.from({ length: s.poke.holesOpened || 0 }, (_, i) => i);
      s.poke.dayOpened = 0;
    }
    if (s.poke && s.poke.dayLimit == null) {
      s.poke.dayLimit = POKE.basePokes + (s.poke.grandTaken ? 0 : POKE.grandTraffic);
    }
    if (!s.retailVersion) {
      // 旧店继续营业，移除新阶段尚未开放的收货访客。
      const allowed = guest => guest.type !== 'seller' ||
        (s.progress.kept.includes('receiving') && (s.progress.kept.includes('premium') ||
          (itemById(guest.itemId)?.base?.[1] <= CONFIG.standardTradeMax && guest.ask <= CONFIG.standardTradeMax)));
      s.queue = (s.queue || []).filter(allowed);
      if (s.current && !allowed(s.current)) s.current = s.queue.shift() || null;
      if (s.current?.type === 'buyer' && s.current.cap) {
        if (!s.progress.kept.includes('premium')) s.current.cap = Math.min(s.current.cap, CONFIG.standardTradeMax);
        const stock = s.shelf.find(entry => entry.uid === s.current.targetUid &&
          (s.progress.kept.includes('premium') || entry.wholesale || itemById(entry.itemId)?.base?.[1] <= CONFIG.standardTradeMax));
        s.current.receipt = stock ? [{ uid: stock.uid, price: s.current.offer }] : [];
      }
    }
    if (!s.progress.kept.includes('receiving') && s.progress.sales < MILESTONES.receiving[0]) {
      s.queue = (s.queue || []).filter(guest => guest.type !== 'seller');
      if (s.current?.type === 'seller') s.current = null;
    }
    if (typeof s.shopOpen !== 'boolean') {
      s.shopOpen = !!(s.settlement || s.current || s.queue?.length || s.wholesaleOrders?.length || s.daySales?.length);
    }
    if (!s.seenTutorials && (s.day > 1 || s.shopOpen)) s.seenTutorials = ['opening'];
    return Object.assign(newState(), { started: true, guide: false }, s); // 用默认值兜底新字段，保证老存档可续
  } catch (e) { return null; }
}

/* 柜台定价、库存成色、社区客流。存档中的货品保留原始真伪。 */
function changeReputation(delta) {
  const rules = CONFIG.reputation;
  if (delta < 0) {
    const loss = Math.min(-delta, rules.dailyLossLimit - state.dailyRepLoss);
    state.dailyRepLoss += loss;
    delta = -loss;
  }
  const previous = state.rep;
  state.rep = clamp(state.rep + delta, rules.min, rules.max);
  return state.rep - previous;
}

function countGoodVisit(points = 1) {
  const threshold = CONFIG.reputation.visitsPerPoint;
  state.repVisits += points;
  const gained = Math.floor(state.repVisits / threshold);
  state.repVisits %= threshold;
  if (gained) changeReputation(gained);
}

function itemCategory(item) {
  return FOOD_LIFE[item.id] ? '食品' : item.cat || '文具';
}

function wholesaleQuote(product) {
  const index = WHOLESALE.indexOf(product);
  const market = WHOLESALE_MARKET;
  const slot = state.day - 1 + index * 2;
  return {
    cost: Math.max(1, product.cost + market.priceSteps[slot % market.priceSteps.length]),
    soldOut: state.day >= market.shortageFromDay && slot % market.shortageCycle === market.shortageCycle - 1,
  };
}

function stockCondition(stock) {
  const life = FOOD_LIFE[stock.itemId];
  if (life) {
    const age = Math.max(0, state.day - (stock.stockedDay || state.day));
    if (age >= life + 2) return 'spoiled';
    if (age >= life) return 'expired';
    if (age >= life - 2) return 'near';
    return age === 0 ? 'fresh' : 'normal';
  }
  return stock.condition || (stock.wholesale ? 'mint' : stock.variant === 'bad' ? 'defective' : 'used');
}

function uniqueStock(entries) {
  const byKind = new Map();
  for (const entry of entries) {
    const condition = entry.grilled ? grillStage(entry).key : stockCondition(entry);
    const key = [entry.itemId, condition, entry.variant, !!entry.relabelled, counterPrice(entry)].join('/');
    if (!byKind.has(key)) byKind.set(key, entry);
  }
  return [...byKind.values()];
}

function conditionBadge(stock) {
  if (stock.grilled) return '<span class="condition condition-gold">' + grillStage(stock).name + '</span>';
  const condition = CONDITION[stockCondition(stock)];
  return '<span class="condition condition-' + condition.color + '">' + condition.name + '</span>';
}

function stockValue(stock) {
  if (!FOOD_LIFE[stock.itemId]) return stock.value;
  return Math.max(1, Math.round(stock.value * CONDITION[stockCondition(stock)].factor));
}

function retailPrice(stock) {
  const base = stock.relabelled && stock.variant === 'fake' ? Math.round(stock.value / CONFIG.variantMult.fake) : stockValue(stock);
  return Math.max(1, Math.round(base * STRATEGIES[state.strategy].mult));
}

function changeLabel(uid) {
  const stock = state.shelf.find(entry => entry.uid === uid && entry.variant === 'fake');
  if (!stock || state.settlement) return;
  stock.relabelled = !stock.relabelled;
  save();
  renderAll();
  if ($('#item-viewer').open) viewStock(uid);
}

function neighborTraffic() {
  const friends = REGULARS.filter(person => getRegular(person.id).favor >= 5).length;
  return clamp(Math.trunc(state.rep / 65) + Math.min(2, friends), -2, 4);
}

function serviceAvailable(key) {
  const milestone = MILESTONES[key];
  return !milestone || state.progress.kept.includes(key) ||
    (state.progress.sales >= milestone[0] && state.progress.days >= milestone[1]);
}

function recruitShoppers() {
  if (!serviceAvailable('organizer') || state.settlement || state.promoDay === state.day) return;
  const { cost, extraBuyers } = NEIGHBORS.organizer;
  if (state.money < cost) return notifyCashShortage(cost);
  state.money -= cost;
  state.promoDay = state.day;
  for (let i = 0; i < extraBuyers; i++) state.queue.push({ type: 'buyer' });
  notifyPlayer('社区宣传已安排，今天多来 ' + extraBuyers + ' 位买家。');
  closeNeighborhood();
  if (state.shopOpen && !state.current) nextVisitor();
  else { renderAll(); save(); }
}

function buyerObjection(guest, stock) {
  if (stock.grilled) {
    const stage = grillStage(stock);
    return stage.checkChance && Math.random() < stage.checkChance ? '这串还没熟，我先不买了。' : '';
  }
  const category = itemCategory(itemById(stock.itemId));
  const condition = stockCondition(stock);
  if ((condition === 'expired' || condition === 'spoiled') && Math.random() < .5) {
    return '我看了保质期，这个已经过期了。';
  }
  if (stock.variant !== 'fake') return '';
  const specialty = (guest.age === 'older' && ['收藏', '日用'].includes(category)) ||
    (guest.age === 'young' && ['玩具', '卡牌', '电器'].includes(category));
  const chance = specialty ? .65 : .25;
  if (Math.random() >= chance) return '';
  return stock.relabelled ? '标签写的是真品，可这件是仿的。' : '我认得这件，这是赝品。';
}

function renderNeighborhood() {
  const role = state.neighborTalk;
  $('#shop-organizer').classList.toggle('hidden', !serviceAvailable('organizer'));
  $('#shop-npc').setAttribute('aria-expanded', String(role === 'mentor'));
  $('#shop-organizer').setAttribute('aria-expanded', String(role === 'organizer'));
  $('#neighborhood').classList.toggle('hidden', !role);
  if (!role) return;
  const person = NEIGHBORS[role];
  $('#neighborhood-portrait').dataset.npc = role;
  $('#neighborhood-name').textContent = person.name;
  const rent = CONFIG.rentBase + (state.day / CONFIG.rentCycle - 1) * CONFIG.rentStep;
  $('#neighborhood-line').textContent = role === 'mentor' && state.day % CONFIG.rentCycle === 0
    ? '今天收摊要交房租 ¥' + rent + '，记得留够钱。' : person.line;
  const promote = $('#promote-shop');
  promote.classList.toggle('hidden', role !== 'organizer' || !!state.settlement);
  promote.textContent = '请帮忙宣传 ¥' + NEIGHBORS.organizer.cost;
  promote.disabled = state.promoDay === state.day;
}

function openNeighborhood(role) {
  if (!NEIGHBORS[role]) return;
  state.neighborTalk = role;
  state.neighborSeen[role] = true;
  renderNeighborhood(); save();
}

function closeNeighborhood() {
  state.neighborTalk = null;
  showNewNeighbor();
  renderNeighborhood(); save();
}

function showNewNeighbor() {
  if (!state.started || state.neighborTalk) return;
  if (!state.neighborSeen.mentor) openNeighborhood('mentor');
  else if (serviceAvailable('organizer') && !state.neighborSeen.organizer) openNeighborhood('organizer');
}

/* ---------------- 日志 ---------------- */
function addLog(text) {
  state.log.unshift(`第${state.day}天｜${text}`);
  state.log = state.log.slice(0, 60);
}

/* ---------------- 图鉴 ---------------- */
function markCollection(itemId, variant) {
  if (!state.collection[itemId]) state.collection[itemId] = { real: false, bad: false, fake: false };
  if (variant) state.collection[itemId][variant] = true;
}

/* ---------------- 熟客好感 ---------------- */
function getRegular(id) {
  if (!state.regulars[id]) state.regulars[id] = { favor: 0, visits: 0 };
  return state.regulars[id];
}
function addFavor(id, delta) {
  const r = getRegular(id);
  r.favor = clamp(r.favor + delta, 0, 99);
}

/* ============================================================
 * 每日访客生成
 * ============================================================ */
function rollVariant(regular) {
  // 基础概率；熟客货源倾向与高好感会修正真品率
  let { real, bad, fake } = CONFIG.variantOdds;
  real += state.rep / 1000; fake -= state.rep / 1600;
  if (regular) {
    fake += regular.fakeBias * 0.15;
    real -= regular.fakeBias * 0.15;
    if (getRegular(regular.id).favor >= CONFIG.favorGoodOddsAt) { real += 0.15; fake -= 0.15; }
  }
  real = clamp(real, 0.05, 0.9); fake = clamp(fake, 0.02, 0.8); bad = clamp(1 - real - fake, 0.02, 0.9);
  const sum = real + bad + fake; real /= sum; bad /= sum; fake /= sum;
  const r = Math.random();
  if (r < real) return 'real';
  if (r < real + bad) return 'bad';
  return 'fake';
}

function makeSeller() {
  const useRegular = Math.random() < 0.35;
  const reg = useRegular ? pick(REGULARS) : null;
  const person = reg || pick(SELLERS);
  // 熟客优先带来偏好物品，好感≥6 时保真好货
  const earlyTrade = !serviceAvailable('premium');
  const pool = earlyTrade ? ITEMS.filter(item => item.base[1] <= CONFIG.standardTradeMax) : ITEMS;
  const favorites = reg ? pool.filter(item => reg.favItems.includes(item.id)) : [];
  const item = pick(favorites.length && Math.random() < 0.6 ? favorites : pool);
  let variant = rollVariant(reg);
  if (reg && getRegular(reg.id).favor >= CONFIG.favorSpecialAt && Math.random() < 0.3) variant = 'real';
  const base = randInt(item.base[0], item.base[1]);
  const condition = variant === 'bad' ? pick(['broken', 'defective']) : Math.random() < clamp(.20 + state.rep / 1000, .05, .42) ? 'mint' : 'used';
  const factor = variant === 'fake' ? CONFIG.variantMult.fake : CONDITION[condition].factor;
  const value = Math.max(1, Math.round(base * factor));
  const requested = variant === 'bad'
    ? Math.max(2, Math.round(base * rand(CONFIG.sellerAskBad[0], CONFIG.sellerAskBad[1])))
    : Math.max(2, Math.round(base * rand(CONFIG.sellerAskReal[0], CONFIG.sellerAskReal[1])));
  const ask = earlyTrade ? Math.min(requested, CONFIG.standardTradeMax) : requested;
  const bottom = clamp(Math.round(value * rand(CONFIG.sellerBottom[0], CONFIG.sellerBottom[1])), 1, ask);
  return {
    type: 'seller', name: reg ? person.name : /学生|女生/.test(person.name) ? '年轻卖家' : '路过的卖家',
    portraitName: person.name, avatar: person.avatar,
    regularId: reg ? reg.id : null,
    line: reg ? reg.lines.sell : person.line,
    itemId: item.id, variant, condition, base, value, ask, bottom,
    checksUsed: 0, checked: [], hintUsed: false,
  };
}

function makeBuyer(student = false) {
  const rules = CONFIG.retail;
  const stock = counterInventory().filter(retailAvailable);
  const useRegular = !student && Math.random() < .35;
  const person = student ? { name: pick(GRILL.studentNames), avatar: '🎒' } : useRegular ? pick(REGULARS) : pick(BUYERS);
  const age = /老|爷|叔/.test(person.name) ? 'older' : /学生|豆包|年轻/.test(person.name) ? 'young' : 'adult';
  const selfPick = stock.length > 0 && Math.random() < rules.selfPickChance;
  const hot = student ? stock.filter(entry => entry.grilled) : [];
  const pool = hot.length ? hot : stock;
  const anchor = pool.length ? pick(uniqueStock(pool)) : null;
  const product = anchor ? itemById(anchor.itemId) : null;
  const premium = product && product.base?.[1] > CONFIG.standardTradeMax && serviceAvailable('premium');
  const range = student ? rules.everydayBudget : premium ? rules.premiumBudget
    : anchor && !anchor.wholesale ? rules.specialtyBudget : rules.everydayBudget;
  const favor = useRegular ? getRegular(person.id).favor : 0;
  const budget = Math.max(3, Math.round(randInt(...range) * (1 + state.rep / 400 + favor * .025)));
  const cap = !serviceAvailable('premium') ? Math.min(budget, CONFIG.standardTradeMax) : budget;
  const wantedItem = !selfPick && product && Math.random() < rules.specificChance ? product.id : null;
  const wantedCondition = wantedItem && !anchor.grilled && Math.random() < rules.conditionChance ? stockCondition(anchor) : null;
  const guest = {
    type: 'buyer', name: student ? person.name : useRegular ? person.name : age === 'young' ? '年轻顾客' : age === 'older' ? '路过的街坊' : '路过的顾客',
    portraitName: person.name, avatar: person.avatar, age, cap, selfPick, wantedItem, wantedCondition,
    regularId: useRegular ? person.id : null, receipt: [],
    creditAsk: serviceAvailable('ledger') && useRegular && Math.random() < CONFIG.creditChance,
  };
  const condition = wantedCondition ? CONDITION[wantedCondition].name + '的' : '';
  guest.line = (wantedItem ? '帮我拿一件' + condition + product.name + '。'
    : student ? '有热食吗？也可以帮我挑点别的。' : '帮我挑几样合适的吧。') + '我带了 ¥' + cap + '。';
  if (selfPick) fillSelfPickedReceipt(guest, pool);
  return guest;
}

function fillSelfPickedReceipt(guest, stock) {
  let remaining = guest.cap;
  const count = randInt(...CONFIG.retail.selfPickCount);
  const selected = new Set();
  for (let i = 0; i < count; i++) {
    const affordable = stock.filter(entry => !selected.has(entry.uid) && counterPrice(entry) <= remaining);
    if (!affordable.length) break;
    const entry = pick(affordable);
    const price = counterPrice(entry);
    guest.receipt.push({ uid: entry.uid, price });
    selected.add(entry.uid);
    remaining -= price;
  }
  guest.line = guest.receipt.length ? '我挑好了这些，你帮我结一下。预算 ¥' + guest.cap + '。'
    : '我带了 ¥' + guest.cap + '，能帮我挑几样吗？';
  guest.selfPick = guest.receipt.length > 0;
}

function enqueueBuyers() {
  const count = clamp(CONFIG.buyersGuaranteed + STRATEGIES[state.strategy].buyers + neighborTraffic(), ...CONFIG.retail.buyerCount);
  for (let i = 0; i < count; i++) state.queue.push({ type: 'buyer' });
}

function prepareDay() {
  state.shopOpen = false;
  state.visitsToday = 0;
  state.clockServed = 0;
  state.current = null;
  tradeOpen = false;
  state.openingMoney = state.money;
  state.wholesaleOrders = [];
  state.settlement = null;
  state.daySales = [];
  state.pendingComplaints = 0;
  state.dailyRepLoss = 0;
  state.poke.dayOpened = 0;
  state.poke.dayLimit = POKE.basePokes + (state.poke.grandTaken ? 0 : POKE.grandTraffic);
  state.queue = [];
}

function startDay() {
  if (state.shopOpen || state.settlement) return;
  state.shopOpen = true;
  if (serviceAvailable('receiving')) {
    const count = CONFIG.sellersPerDay + (state.rep >= 65 ? 1 : 0);
    for (let i = 0; i < count; i++) state.queue.push(makeSeller());
  }
  enqueueBuyers();
  for (let i = state.queue.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
  }
  enqueueStudents();
  addLog(`开店啦，今天有 ${state.queue.length} 位顾客排队。`);
  nextVisitor();
  $(state.current ? '#guest-call' : '#btn-endday').focus();
}

function finishVisit() {
  if (state.current?.type === 'buyer') customerPokes();
  state.serviceTurns++;
  state.visitsToday++;
  nextVisitor();
}

function nextVisitor() {
  const returnFocus = tradeOpen;
  tradeOpen = false;
  inspectionFace = 0;
  inspectedPart = null;
  state.current = null;
  while (!state.current && state.queue.length) {
    const visitor = state.queue.shift();
    // 买家到柜台时按当前库存选货并报价。
    state.current = visitor.type === 'buyer' ? makeBuyer(visitor.student) : visitor;
    if (!state.current) addLog('有买家探头看了一眼：货架空了，先走了。');
  }
  if (state.current && state.current.regularId) getRegular(state.current.regularId).visits++;
  showNewNeighbor();
  renderAll(); save();
  if (returnFocus) $(state.current ? '#guest-call' : '#btn-endday').focus();
}

/* ============================================================
 * 柜台接待：卖家（鉴定 + 砍价）
 * ============================================================ */
function doCheck(idx) {
  const c = state.current;
  if (!c || c.type !== 'seller' || c.checked.includes(idx) || c.checksUsed >= CONFIG.maxChecks) return;
  c.checked.push(idx); c.checksUsed++;
  markCollection(c.itemId); // 鉴定时记录物品，收购后才记录成色
  renderAll(); save();
}

/* 鉴定提示：正式版接激励视频的广告点位，原型免费，准确率 80% */
function doHint() {
  const c = state.current;
  if (!c || c.type !== 'seller' || c.hintUsed) return;
  c.hintUsed = true;
  const correct = Math.random() < 0.8;
  const shown = correct ? c.variant : pick(['real', 'bad', 'fake'].filter((v) => v !== c.variant));
  c.hintText = shown === 'real' ? '老主顾悄悄说：这货八成是真品。'
    : shown === 'fake' ? '老主顾悄悄说：这货味儿不对，怕是山寨。'
    : '老主顾悄悄说：东西是真的，就是有毛病。';
  renderAll(); save();
}

function notifyPlayer(message, important = false) {
  addLog(message);
  renderLog();
  if (important) {
    const dialog = $('#event-dialog');
    $('#event-message').textContent = message;
    if (!dialog.open) dialog.showModal();
    return;
  }
  save();
  const notice = $('#shop-notice');
  notice.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 4200);
}

function notifyCashShortage(cost) {
  notifyPlayer(`现金不足：需要 ¥${cost}，手头有 ¥${state.money}。`);
}

function resolveBid(bid) {
  const c = state.current;
  if (!c || c.type !== 'seller') return;
  const minimum = c.openingBid ? c.openingBid + 1 : 1;
  if (!Number.isInteger(bid) || bid < minimum || bid > c.ask) {
    return notifyPlayer(`请输入 ¥${minimum} 至 ¥${c.ask} 之间的整数。`);
  }
  if (bid > state.money) return notifyCashShortage(bid);
  if (bid >= c.bottom) return buyFromSeller(bid);
  if (c.openingBid) {
    const loss = -changeReputation(-CONFIG.reputation.failedBidLoss);
    if (c.regularId) addFavor(c.regularId, -1);
    notifyPlayer(`${c.name} 没接受最后的 ¥${bid}，带着东西走了。${loss ? '口碑 −' + loss + '。' : ''}`, true);
    return finishVisit();
  }
  c.openingBid = bid;
  c.lastWords = `¥${bid} 太低了。你可以再报一次，合适我就卖。`;
  renderAll(); save();
}

function buyFromSeller(price) {
  const c = state.current;
  const item = itemById(c.itemId);
  state.money -= price;
  state.shelf.push({ uid: nextUid(), itemId: c.itemId, variant: c.variant, condition: c.condition, value: c.value, cost: price, stockedDay: state.day });
  countGoodVisit();
  markCollection(c.itemId, c.variant);
  if (c.regularId) addFavor(c.regularId, +1);
  notifyPlayer(`以 ¥${price} 收下${item.name}。鉴定结果：${CONFIG.variantName[c.variant]}。`, true);
  finishVisit();
}

function refuseSeller() {
  const c = state.current;
  if (!c) return;
  addLog(`你摆摆手，${c.name} 拿着东西走了。`);
  if (c.regularId) addFavor(c.regularId, -1);
  finishVisit();
}

/* ============================================================
 * 柜台接待：买家（成交 / 抬价 / 不卖 / 赊账）
 * ============================================================ */
function retailAvailable(stock) {
  if (stock.grilled) return grillStage(stock).factor > 0;
  return stock.displayed !== false && (serviceAvailable('premium') || stock.wholesale ||
    itemById(stock.itemId).base[1] <= CONFIG.standardTradeMax);
}

function counterPrice(stock) {
  if (stock.grilled) return Math.max(1, Math.round(stock.value * grillStage(stock).factor));
  const price = retailPrice(stock);
  return serviceAvailable('clearance') && stockCondition(stock) === 'near'
    ? Math.max(1, Math.round(price * CONFIG.retail.clearanceMultiplier)) : price;
}

function receiptLines(guest) {
  return guest.receipt.flatMap(row => {
    const stock = counterInventory().find(entry => entry.uid === row.uid);
    return stock ? [{ row, stock, item: itemById(stock.itemId) }] : [];
  });
}

function receiptTotal(guest) {
  return guest.receipt.reduce((sum, row) => sum + row.price, 0);
}

function receiptQuote(guest) {
  const rules = CONFIG.retail;
  const subtotal = receiptTotal(guest);
  const discounted = guest.discounted ? Math.round(subtotal * rules.receiptDiscount) : subtotal;
  const discount = subtotal - discounted;
  const budget = guest.cap + (discount ? rules.discountBudgetBoost : 0);
  const roundOff = discounted - budget === rules.roundOffAmount ? rules.roundOffAmount : 0;
  return { subtotal, discount, budget, roundOff, total: discounted - roundOff };
}

function buyerReply(guest, quote) {
  const replies = [];
  if (guest.upsellReply) replies.push(guest.upsellReply);
  if (quote.discount) replies.push('整单打九折呀！我再拿 ¥' + CONFIG.retail.discountBudgetBoost + '，预算一共 ¥' + quote.budget + '。');
  if (quote.roundOff) replies.push('就差 ¥' + quote.roundOff + '，能帮我抹个零吗？');
  return replies.join(' ');
}

function updateReceipt(guest) {
  const quote = receiptQuote(guest);
  const reply = buyerReply(guest, quote);
  $('#receipt-total').textContent = '¥' + quote.total;
  $('#receipt-savings').textContent = [
    quote.discount ? '原价 ¥' + quote.subtotal + ' · 整单优惠 −¥' + quote.discount : '',
    quote.roundOff ? '抹零 −¥' + quote.roundOff : '',
  ].filter(Boolean).join(' · ');
  const over = quote.total > quote.budget;
  $('#receipt-budget').textContent = over ? '超出预算 ¥' + (quote.total - quote.budget) : '预算余 ¥' + (quote.budget - quote.total);
  $('#receipt-budget').classList.toggle('over-budget', over);
  $('#receipt-discount').disabled = !guest.discounted && Math.round(quote.subtotal * CONFIG.retail.receiptDiscount) === quote.subtotal;
  $('#buyer-reply').textContent = reply;
  $('#buyer-reply').classList.toggle('hidden', !reply);
  renderDialogue(guest, guest.regularId ? '熟客 · 买家' : '买家', [guest.line, reply].filter(Boolean));
}

function toggleReceiptDiscount() {
  const guest = state.current;
  if (guest?.type !== 'buyer' || !guest.receipt.length) return;
  guest.discounted = !guest.discounted;
  $('#receipt-discount').textContent = guest.discounted ? '取消九折' : '整单 −10%';
  $('#receipt-discount').setAttribute('aria-pressed', String(guest.discounted));
  updateReceipt(guest);
  save();
}

function editReceipt(uid, action) {
  const guest = state.current;
  if (guest?.type !== 'buyer' || state.settlement) return;
  const row = guest.receipt.find(entry => entry.uid === uid);
  const stock = counterInventory().find(entry => entry.uid === uid);
  if (action === 'add' && !guest.selfPick && stock && retailAvailable(stock) && !row) {
    if (guest.wantedItem && (!matchesBuyerRequest(guest, stock) || guest.receipt.length)) return;
    guest.receipt.push({ uid, price: counterPrice(stock) });
  } else if (action === 'remove' && row) {
    guest.receipt = guest.receipt.filter(entry => entry !== row);
  } else if (action === 'label' && row && stock && !stock.grilled) {
    row.upgraded = !row.upgraded;
  }
  renderVisitor(); save();
}

function canRecommend(guest) {
  return guest.selfPick && !guest.upsold && guest.regularId &&
    getRegular(guest.regularId).favor >= CONFIG.retail.upsellFavor;
}

function recommendStock(uid) {
  const guest = state.current;
  if (guest?.type !== 'buyer' || state.settlement || !canRecommend(guest)) return;
  const stock = counterInventory().find(entry => entry.uid === uid);
  if (!stock || !retailAvailable(stock) || guest.receipt.some(row => row.uid === uid)) return;
  const row = { uid, price: counterPrice(stock) };
  const quote = receiptQuote({ ...guest, receipt: [...guest.receipt, row] });
  if (quote.total > quote.budget) {
    guest.upsellReply = '这件先不加啦，钱不够。';
  } else {
    guest.upsellReply = '好，再帮我加一件' + itemById(stock.itemId).name + '。';
    guest.upsold = true;
    guest.receipt.push(row);
  }
  renderVisitor(); save();
}

function allocateReceipt(lines, quote) {
  let running = 0;
  let allocated = 0;
  return lines.map(line => {
    running += line.row.price;
    const share = quote.subtotal ? Math.round(quote.total * running / quote.subtotal) : 0;
    const revenue = share - allocated;
    allocated = share;
    return { ...line, revenue };
  });
}

function acceptablePrice(stock) {
  const tolerance = CONFIG.retail.priceTolerance;
  const quality = stock.grilled ? grillStage(stock).key : stockCondition(stock);
  const multiplier = stock.variant === 'real' ? tolerance[quality] || tolerance.standard : tolerance.standard;
  return Math.floor(counterPrice(stock) * multiplier);
}

function editReceiptPrice(uid, input) {
  const guest = state.current;
  const row = guest?.receipt?.find(entry => entry.uid === uid);
  if (!row) return;
  const price = Number(input.value);
  const valid = input.value !== '' && Number.isInteger(price) && price >= 0 && price <= CONFIG.retail.maxUnitPrice;
  if (valid) {
    row.price = price;
    updateReceipt(guest);
    save();
  }
}

function matchesBuyerRequest(guest, stock, upgraded = false) {
  return stock.itemId === guest.wantedItem && (!guest.wantedCondition ||
    (upgraded ? betterLabel(stock) : stockCondition(stock)) === guest.wantedCondition);
}

function receiptObjection(guest, lines) {
  if (!guest.wantedItem) return '';
  if (lines.length !== 1 || !matchesBuyerRequest(guest, lines[0].stock, lines[0].row.upgraded)) {
    return '我只要刚才点的那一件，能帮我改下小票吗？';
  }
  return '';
}

function betterLabel(stock) {
  return FOOD_LIFE[stock.itemId] ? 'fresh' : 'mint';
}

function settleBuyerSale(onCredit = false) {
  const guest = state.current;
  if (guest?.type !== 'buyer' || state.settlement || !guest.receipt.length) return;
  if (onCredit && (!guest.creditAsk || !serviceAvailable('ledger'))) return;
  const quote = receiptQuote(guest);
  const lines = allocateReceipt(receiptLines(guest), quote);
  if (lines.length !== guest.receipt.length || lines.some(({ stock }) => !retailAvailable(stock))) return notifyPlayer('小票里的库存有变动，请重新选货。');
  const { total } = quote;
  if (onCredit && total === 0) return notifyPlayer('小票合计为零，可以直接结账。');
  if (total > quote.budget) return notifyPlayer('小票超过顾客预算，可以打折、减价或删掉商品。');
  const mismatch = receiptObjection(guest, lines);
  if (mismatch) return notifyPlayer(guest.name + '：' + mismatch);
  const overpriced = lines.find(({ stock, revenue }) => revenue > acceptablePrice(stock));
  if (overpriced) return notifyPlayer(guest.name + '：' + overpriced.item.name + '这个价有点高，能便宜些吗？');
  for (const { row, stock, item } of lines) {
    const relabelled = row.upgraded || stock.relabelled;
    const caught = row.upgraded && Math.random() < CONFIG.retail.conditionCheckChance;
    const objection = caught ? item.name + '的品质和标签对不上。' : buyerObjection(guest, stock);
    if (objection) {
      const penalty = relabelled ? CONFIG.retail.conditionPenalty : -CONFIG.fakeComplaintRep;
      const loss = -changeReputation(-penalty);
      if (guest.regularId) addFavor(guest.regularId, -1);
      notifyPlayer(guest.name + '：' + objection + (loss ? ' 口碑 −' + loss + '。' : ''), true);
      return finishVisit();
    }
  }
  const sold = new Set(lines.map(({ stock }) => stock.uid));
  state.shelf = state.shelf.filter(stock => !sold.has(stock.uid));
  state.grill.slots = state.grill.slots.filter(stock => !sold.has(stock.uid));
  const label = guest.name + ' 买走 ' + lines.length + ' 件商品';
  if (onCredit) {
    const due = state.day + randInt(...CONFIG.creditDueDays);
    state.ledger.push({ id: nextUid(), regularId: guest.regularId, whoName: guest.name, amount: total, due, done: false, result: null });
    notifyPlayer(`${label}，赊账 ¥${total}，第 ${due} 天到期。`, true);
  } else {
    state.money += total;
    if (total > 0) state.progress.sales++;
    for (const { stock, item, revenue } of lines) {
      state.daySales.push({ itemId: item.id, label: guest.name + ' 买走' + item.name, revenue, profit: revenue - stock.cost });
    }
    addLog(`${label}，实收 ¥${total}。`);
  }
  const discount = total < lines.reduce((sum, { stock }) => sum + counterPrice(stock), 0);
  const fresh = lines.some(({ stock, revenue }) => revenue > 0 && stockCondition(stock) === 'fresh');
  const courtesy = quote.discount || quote.roundOff;
  if (total > 0) countGoodVisit(1 + (fresh ? CONFIG.retail.freshSaleRepProgress : 0) + (courtesy ? CONFIG.retail.courtesyRepProgress : 0));
  const bonus = (courtesy ? CONFIG.retail.courtesyFavor : 0) + (fresh ? CONFIG.retail.freshSaleFavor : 0);
  if (guest.regularId) addFavor(guest.regularId, (discount ? 2 : 1) + bonus);
  if (courtesy) {
    finishVisit();
    notifyPlayer(guest.name + (quote.roundOff ? '：谢谢你帮我抹零！' : '：谢谢你给我打折！'));
    return;
  }
  finishVisit();
}

function buyerRefuse() {
  const c = state.current;
  if (!c) return;
  addLog(`你把东西放回货架，${c.name} 恋恋不舍地走了。`);
  finishVisit();
}

/* ============================================================
 * 支线系统操作
 * ============================================================ */
function orderWholesale(id) {
  const product = WHOLESALE.find(item => item.id === id);
  if (!product || !serviceAvailable(product.unlock) || state.settlement || state.wholesaleOrders.includes(id)) return;
  const { cost, soldOut } = wholesaleQuote(product);
  if (soldOut) return;
  const total = cost * product.pack;
  if (state.money < total) return notifyCashShortage(total);

  const firstOrder = state.wholesaleOrders.length === 0;
  state.money -= total;
  state.wholesaleOrders.push(id);
  for (let i = 0; i < product.pack; i++) {
    state.shelf.push({
      uid: nextUid(), itemId: id, variant: 'real',
      cost, value: product.value, wholesale: true, stockedDay: state.day,
    });
  }
  addLog(`供货商送来 ${product.name} ×${product.pack}，进货支出 ¥${total}。`);

  if (state.shopOpen && firstOrder && (!state.current || state.current.type !== 'buyer') && !state.queue.some(visitor => visitor.type === 'buyer')) {
    enqueueBuyers();
    if (!state.current) return nextVisitor();
  }
  renderAll(); save();
}

function setStrategy(key) {
  state.strategy = key;
  addLog(`定价策略改为「${STRATEGIES[key].name}」。`);
  renderAll(); save();
}

/* 戳戳乐进货：grandItemId 为选定的大奖物品 */
function pokeStock(grandItemId) {
  if (!serviceAvailable('poke') || state.settlement || state.poke.active) return;
  const g = POKE.grands.find((x) => x.itemId === grandItemId);
  if (!g || !pokePrizeAvailable(g)) return;
  const total = POKE.boardCost + g.cost;
  if (state.money < total) return notifyCashShortage(total);
  state.money -= total;
  state.poke = { active: true, holesLeft: POKE.holes, opened: [], dayOpened: 0,
    dayLimit: POKE.basePokes + POKE.grandTraffic,
    grandId: grandItemId, grandPos: randInt(0, POKE.holes - 1), grandTaken: false };
  state.specialCards.pokeGrand = true;
  addLog(`戳戳乐进货上架！大奖是${itemById(grandItemId).name}，一共花了 ¥${total}。`);
  renderAll(); save();
}

function pokePrizeAvailable(prize) {
  return prize.cost <= CONFIG.standardTradeMax || serviceAvailable('premium');
}

function pokeDemand() {
  const pk = state.poke;
  return Math.max(0, Math.min(pk.holesLeft, pk.dayLimit - pk.dayOpened));
}

function openPokeHole(index) {
  const pk = state.poke;
  if (!pk.active || state.settlement || !pokeDemand() || !Number.isInteger(index) ||
      index < 0 || index >= POKE.holes || pk.opened.includes(index)) return false;
  pk.opened.push(index);
  pk.dayOpened++;
  pk.holesLeft--;
  if (index === pk.grandPos) {
    pk.grandTaken = true;
    addLog('戳戳乐开出了大奖 ' + itemById(pk.grandId).name + '！');
  }
  return true;
}

function customerPokes() {
  const pk = state.poke;
  if (!pk.active || !pokeDemand()) return;
  const unopened = Array.from({ length: POKE.holes }, (_, index) => index)
    .filter(index => !pk.opened.includes(index));
  return openPokeHole(pick(unopened));
}

function settlePoke(others) {
  const pk = state.poke;
  if (!pk.active) return;
  while (customerPokes()) { /* 结算当天剩下的戳戳乐顾客 */ }
  const net = pk.dayOpened * (POKE.price - POKE.smallPrizeCost);
  state.money += net;
  if (pk.dayOpened) others.push({ label: '顾客戳戳乐 ×' + pk.dayOpened, amount: net });
  if (!pk.holesLeft) {
    pk.active = false;
    addLog('戳戳乐板子戳完了，该重新进货了。');
  }
}

function stickerToggle() {
  if (!serviceAvailable('sticker') || state.settlement) return;
  state.sticker.on = !state.sticker.on;
  addLog(state.sticker.on ? '集贴纸换 ¥100 活动开启了！' : '集贴纸活动先撤了下来。');
  renderAll(); save();
}
function stickerSetRare(v) {
  if (!serviceAvailable('sticker') || state.settlement) return;
  state.sticker.rare = clamp(parseInt(v, 10) || 0, 0, STICKER.rareMax);
  if (state.sticker.rare > 0) state.specialCards.jinlong = true;
  renderAll(); save();
}

/* 烤肠机按送走顾客的次数计时，备货和查看界面不推进。 */
function counterInventory() {
  return [...state.shelf, ...state.grill.slots];
}

function grillStage(stock) {
  const age = state.serviceTurns - stock.placedAt;
  return GRILL.stages.reduce((current, stage) => age >= stage.turns ? stage : current, GRILL.stages[0]);
}

function enqueueStudents() {
  if (!state.grill.owned || state.grill.studentDay === state.day) return;
  state.grill.studentDay = state.day;
  for (let i = 0; i < GRILL.extraStudents; i++) state.queue.push({ type: 'buyer', student: true });
}

function buyGrill() {
  if (!serviceAvailable('grill') || state.grill.owned || state.settlement) return;
  if (state.money < GRILL.cost) return notifyCashShortage(GRILL.cost);
  state.money -= GRILL.cost;
  state.grill.owned = true;
  addLog('烤肠机到货，放学时会多来几位学生。');
  if (state.shopOpen) {
    enqueueStudents();
    if (!state.current) return nextVisitor();
  }
  renderAll(); save();
}

function orderGrillFood(id) {
  const food = GRILL.foods.find(item => item.id === id);
  if (!food || !state.grill.owned || state.settlement || state.wholesaleOrders.includes(id)) return;
  const total = food.cost * food.pack;
  if (state.money < total) return notifyCashShortage(total);
  state.money -= total;
  state.wholesaleOrders.push(id);
  state.grill.supplies[id] = (state.grill.supplies[id] || 0) + food.pack;
  addLog('进货 ' + food.name + ' ×' + food.pack + '，支出 ¥' + total + '。');
  renderAll(); save();
}

function placeGrillFood(id) {
  const food = GRILL.foods.find(item => item.id === id);
  if (!food || !state.grill.owned || state.settlement ||
      !state.grill.supplies[id] || state.grill.slots.length >= GRILL.capacity) return;
  state.grill.supplies[id]--;
  state.grill.slots.push({
    uid: nextUid(), itemId: id, cost: food.cost, value: food.value, variant: 'real',
    grilled: true, placedAt: state.serviceTurns,
  });
  renderAll(); save();
}

function discardGrillFood(uid) {
  if (state.settlement) return;
  const stock = state.grill.slots.find(entry => entry.uid === uid);
  if (!stock) return;
  state.grill.slots = state.grill.slots.filter(entry => entry !== stock);
  if (state.current?.type === 'buyer') {
    state.current.receipt = state.current.receipt.filter(row => row.uid !== uid);
  }
  addLog('从烤肠机上撤下了' + itemById(stock.itemId).name + '。');
  renderAll(); save();
}

/* ============================================================
 * 收摊结算
 * ============================================================ */
function endDay() {
  if (state.settlement) return showSettlement(state.settlement);
  if (!state.shopOpen) return;
  if (state.current || state.queue.length) return notifyPlayer('还有顾客在等，先接待完再收摊。');
  const strat = STRATEGIES[state.strategy];
  const cashBeforeClosing = state.money;
  const autoList = [];
  const others = [];
  let complaintCount = state.pendingComplaints;

  // 1) 收摊自动售卖
  const remain = [];
  for (const s of state.shelf) {
    if (retailAvailable(s) && Math.random() < strat.autoRate) {
      const price = Math.max(1, Math.round(stockValue(s) * strat.autoMult));
      state.money += price;
      autoList.push({ itemId: s.itemId, label: `自动售出 ${itemById(s.itemId).name}`, revenue: price, profit: price - s.cost });
      if (buyerObjection({ age: 'adult' }, s)) complaintCount++;
    } else remain.push(s);
  }
  state.shelf = remain;

  // 2) 山寨货投诉（白天 + 收摊合计）
  if (complaintCount > 0) {
    const fine = complaintCount * CONFIG.fakeComplaintFine;
    state.money -= fine;
    changeReputation(complaintCount * CONFIG.fakeComplaintRep);
    others.push({ label: `😤 商品被投诉 ×${complaintCount}（罚款+口碑下降）`, amount: -fine });
  }

  // 3) 赊账到期
  for (const e of state.ledger) {
    if (e.done || e.due > state.day) continue;
    e.done = true;
    const reg = e.regularId ? regularById(e.regularId) : null;
    const repayChance = 1 - (1 - CONFIG.creditRepayChance) * (reg ? reg.risk : 1);
    if (Math.random() < repayChance) {
      e.result = 'repaid';
      state.money += e.amount;
      countGoodVisit();
      if (e.regularId) addFavor(e.regularId, +1);
      others.push({ label: `💵 ${e.whoName} 来还赊账`, amount: e.amount });
    } else {
      e.result = 'default';
      if (e.regularId) addFavor(e.regularId, -2);
      others.push({ label: `🏃 ${e.whoName} 的赊账赖掉了`, amount: 0 });
    }
  }

  // 4) 戳戳乐日结
  settlePoke(others);

  // 5) 集贴纸日结
  const st = state.sticker;
  if (st.on) {
    const income = randInt(STICKER.snackIncome[0], STICKER.snackIncome[1]);
    state.money += income;
    others.push({ label: '🍬 集贴纸活动带来的零食收入', amount: income });
    st.grumble += st.rare > 0 ? randInt(STICKER.grumbleHas[0], STICKER.grumbleHas[1]) : randInt(STICKER.grumbleZero[0], STICKER.grumbleZero[1]);
    if (st.rare > 0 && Math.random() < st.rare * STICKER.redeemChancePerRare) {
      state.money -= STICKER.redeemPay;
      changeReputation(STICKER.redeemRep);
      st.rare--; st.grumble = 0; st.badge = true; state.specialCards.jinlong = true;
      others.push({ label: '🏆 有孩子集满贴纸！兑付 ¥100，赢得「良心小卖部」名声', amount: -STICKER.redeemPay });
      addLog('有孩子集满了贴纸！你含泪兑付 ¥100，街坊都夸你是良心小卖部。');
    } else if (st.grumble >= STICKER.grumbleLimit) {
      state.money -= STICKER.complaintFine;
      changeReputation(STICKER.complaintRep);
      st.grumble = STICKER.grumbleAfterComplaint;
      others.push({ label: '😤 家长投诉：集了这么久，金龙贴纸到底有没有？！', amount: -STICKER.complaintFine });
      addLog('嘀咕值爆表，家长找上门投诉了……');
    }
  }

  // 6) 房租
  if (state.day % CONFIG.rentCycle === 0) {
    const week = state.day / CONFIG.rentCycle;
    const rent = CONFIG.rentBase + (week - 1) * CONFIG.rentStep;
    state.money -= rent;
    others.push({ label: `🏠 房东周叔 · 第 ${week} 周房租`, amount: -rent });
  }

  // 7) 胜利判定
  if (!state.won && state.money >= CONFIG.goalMoney) {
    state.won = true;
    addLog('🎉 攒够 ¥3000，正式盘下小卖部！');
  }

  const sum = (list) => list.reduce((a, x) => a + x.revenue, 0);
  const dayTotal = sum(state.daySales), autoTotal = sum(autoList);
  const otherTotal = others.reduce((a, x) => a + x.amount, 0);
  for (const { label, amount } of others) {
    addLog(`${label}${amount ? `（${amount > 0 ? '+' : '−'}¥${Math.abs(amount)}）` : ''}`);
  }
  state.progress.days++;
  if (state.grill.slots.length) {
    addLog('收摊关机，清掉烤肠机上剩下的热食。');
    state.grill.slots = [];
  }
  state.settlement = {
    dayList: state.daySales, dayTotal, autoList, autoTotal, others, otherTotal,
    daytimeSpend: dayTotal + state.openingMoney - cashBeforeClosing,
    net: state.money - state.openingMoney,
  };
  save();
  renderAll();
  showSettlement(state.settlement);
}

function nextDay() {
  if (!state.settlement) return;
  $('#modal-mask').classList.add('hidden');
  if (state.day === 1) state.guide = false;
  state.day++;
  prepareDay();
  renderAll(); save();
  if (state.day % CONFIG.rentCycle === 0) openNeighborhood('mentor');
  $('#btn-openday').focus();
}

/* ============================================================
 * 渲染
 * ============================================================ */
function renderAll() {
  renderTop();
  renderNeighborhood();
  renderGuide();
  renderTutorials();
  renderVisitor();
  renderWindow();
  renderTabs();
  renderLog();
}

function renderTutorials() {
  const panel = $('#unlock-guide');
  const pending = TUTORIALS.filter(entry => serviceAvailable(entry.unlock) && !state.seenTutorials.includes(entry.id));
  panel.classList.toggle('hidden', !pending.length || !state.started || !!state.settlement);
  panel.innerHTML = pending.map((lesson, index) => `<details ${index === 0 ? 'open' : ''}>
    <summary>${lesson.title}</summary><p>${lesson.text}</p><div class="trade-actions">
      ${lesson.tab ? `<button class="btn small gold" onclick="acknowledgeTutorial('${lesson.id}', true)">${lesson.action}</button>` : ''}
      <button class="btn small" onclick="acknowledgeTutorial('${lesson.id}')">知道了</button>
    </div></details>`).join('');
}

function acknowledgeTutorial(id, openTab = false) {
  const lesson = TUTORIALS.find(entry => entry.id === id);
  if (!lesson || !serviceAvailable(lesson.unlock)) return;
  if (!state.seenTutorials.includes(id)) state.seenTutorials.push(id);
  save();
  renderTutorials();
  if (openTab && lesson.tab) openManagement(lesson.tab);
}

function renderGuide() {
  const panel = $('#guide');
  panel.classList.toggle('hidden', !state.guide);
  const tradeGuide = $('#trade-guide');
  tradeGuide.classList.toggle('hidden', !state.guide || !state.current);
  if (!state.guide) return;

  const guest = state.current;
  const hasOrdered = state.wholesaleOrders.length > 0;
  let text;
  if (state.settlement) text = '看完今天的流水，点「进入明天」。';
  else if (!state.shopOpen) text = '可以先点「进货」备货，准备好后点「开店」。';
  else if (guest && guest.type === 'buyer') text = '点窗前的顾客，按他的需求准备商品并开小票。';
  else if (!hasOrdered && (state.shelf.length || !guest) && state.money >= WHOLESALE[0].cost * WHOLESALE[0].pack) {
    text = '试试从供货商补货。点窗台的「进货」，订一批干脆面。';
  } else if (guest) text = '点窗前的顾客，看看他带来了什么。';
  else text = '顾客接待完了，点「收摊结算」看看今天的流水。';
  $('#guide-text').textContent = text;
  tradeGuide.textContent = !guest ? ''
    : guest.type === 'buyer' ? '小票可以添减商品和改价。合计要在顾客预算内。'
    : !guest.checksUsed ? '先点一个部位验货。每件货最多检查三次。'
    : '看完线索后报一个起价。卖家若嫌低，你还可以再报一次。';
}

function openTitle() {
  $('#start-game').textContent = state.started ? '继续营业' : '开始营业';
  $('#btn-reset').classList.toggle('hidden', !state.started);
  if (!$('#title-screen').open) $('#title-screen').showModal();
}

function enterShop(showGuide) {
  if (showGuide) state.guide = true;
  const firstOpening = !state.started;
  state.started = true;
  $('#title-screen').close();
  renderAll();
  save();
  if (firstOpening || !state.neighborSeen.mentor) showNewNeighbor();
}

function itemArtwork(id) {
  const art = ITEM_ART[id];
  if (id === 'youxiji') return '<span class="item-art item-art-handheld" aria-hidden="true"></span>';
  if (!art) return GRILL.foods.find(food => food.id === id)?.emoji || '';
  return `<span class="item-art item-sheet-${art.sheet}" style="--item-x:${art.col * 100 / 3}%;--item-y:${art.row * 100 / 3}%" aria-hidden="true"></span>`;
}

function itemPreviewButton(id, wholesale = false) {
  const name = id === 'jinlong' ? '金龙贴纸' : itemById(id).name;
  return `<button type="button" class="item-preview" onclick="viewItem('${id}', undefined, ${wholesale})" aria-label="查看${name}">${itemArtwork(id)}</button>`;
}

function viewItem(id, uid, wholesale = false) {
  const item = id === 'jinlong'
    ? { name: '金龙贴纸', flavor: '集贴纸活动里的稀有贴纸。' }
    : wholesale ? WHOLESALE.find(product => product.id === id) : itemById(id);
  if (!item) return;
  const stock = state.shelf.find(entry => entry.uid === uid && entry.itemId === id);
  viewedShelfUid = stock ? stock.uid : null;
  $('#item-viewer-name').textContent = item.name;
  $('#item-viewer-description').textContent = stock
    ? CONDITION[stockCondition(stock)].name + ' · ' + (stock.variant === 'fake' ? (stock.relabelled ? '标为真品，实际是赝品 · ' : '赝品 · ') : '') + '成本 ¥' + stock.cost + ' · 标价 ¥' + retailPrice(stock)
    : GRILL.foods.includes(item) ? '烤肠机热食，随火候变化。'
    : item.pack ? '每批 ' + item.pack + ' 件 · 今日单件进价 ¥' + wholesaleQuote(item).cost : item.flavor;
  const life = stock && FOOD_LIFE[id];
  $('#item-viewer-dates').textContent = !stock ? '' : !stock.stockedDay
    ? '入货日期未记录'
    : `第 ${stock.stockedDay} 天入货${life ? ` · 第 ${stock.stockedDay + life} 天起过期` : ''}`;
  const zoom = $('#zoom-item');
  zoom.innerHTML = itemArtwork(id);
  zoom.setAttribute('aria-pressed', 'false');
  zoom.setAttribute('aria-label', '放大' + item.name);
  const relabel = $('#viewer-label');
  relabel.classList.toggle('hidden', !stock || stock.variant !== 'fake' || !!state.settlement);
  relabel.textContent = stock && stock.relabelled ? '恢复赝品标签' : '改标为真品';
  if (!$('#item-viewer').open) $('#item-viewer').showModal();
}

function viewStock(uid) {
  const stock = counterInventory().find(entry => entry.uid === uid);
  if (stock) viewItem(stock.itemId, uid);
}

function renderShopClock() {
  const remaining = state.queue.length + Number(!!state.current);
  const total = state.visitsToday + remaining;
  const served = state.settlement ? 1 : !state.shopOpen ? 0 : remaining ? state.visitsToday / total : 1;
  state.clockServed = Math.max(state.clockServed, served);
  const schedule = CONFIG.openingHours;
  const index = schedule.findIndex(point => point.served > state.clockServed);
  const earlier = index < 0 ? schedule[schedule.length - 1] : schedule[index - 1];
  const later = index < 0 ? earlier : schedule[index];
  const fraction = index < 0 ? 0 : (state.clockServed - earlier.served) / (later.served - earlier.served);
  const minutes = Math.round((earlier.hour + (later.hour - earlier.hour) * fraction) * 60);
  const time = String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  $('#shop-clock').textContent = time;
  $('#shop-clock').setAttribute('datetime', time);
  $('.street').dataset.light = earlier.light;
}

function renderWindow() {
  const guest = state.current;
  const call = $('#guest-call');
  call.classList.toggle('hidden', !guest);
  const trading = !!guest && tradeOpen;
  $('#counter').classList.toggle('hidden', !trading);
  $('#counter').classList.toggle('seller-stage', guest?.type === 'seller');
  $('#trade-dialogue').classList.toggle('hidden', !trading);
  call.setAttribute('aria-expanded', String(trading));
  call.setAttribute('aria-label', guest ? guest.name + (trading ? '，收起交易' : '，接待') : '');
  $('#guest-label').textContent = guest
    ? guest.name + (guest.type === 'seller' ? ' · 来卖货' : ' · 来买货') + (tradeOpen ? '　收起交易' : '　接待')
    : '';
  renderShopClock();
  $('#btn-openday').classList.toggle('hidden', state.shopOpen || !!state.settlement);
  $('#btn-endday').classList.toggle('hidden', !state.shopOpen && !state.settlement);
  $('#street-status strong').textContent = guest ? '营业中' : state.settlement ? '已打烊' : state.shopOpen ? '可收摊' : '待开店';
  $('#street-status small').textContent = guest
    ? '等候 ' + state.queue.length + ' 位'
    : state.settlement ? '明天见' : state.shopOpen ? '等候 0 位' : '可先备货';
  renderCounterSlots();
  $('#open-poke').classList.toggle('hidden', !serviceAvailable('poke'));
  $('#open-grill').classList.toggle('hidden', !state.grill.owned);
  $('#counter-poke-holes').innerHTML = Array.from({ length: POKE.holes }, (_, index) =>
    `<i class="${state.poke.opened?.includes(index) ? 'open' : ''}"></i>`).join('');
}

function displayProductIds() {
  return [...new Set(state.shelf.filter(retailAvailable).map(stock => stock.itemId))];
}

function renderCounterSlots() {
  const products = displayProductIds();
  const unassigned = products.filter(id => !state.displaySlots.includes(id));
  $('#counter-stock').innerHTML = Array.from({ length: CONFIG.counterSlots }, (_, index) => {
    const selected = state.displaySlots[index];
    const id = selected == null ? unassigned.shift() : selected;
    const item = products.includes(id) ? itemById(id) : null;
    return `<button type="button" id="display-slot-${index}" class="display-slot" aria-haspopup="dialog"
      onclick="openDisplaySlot(${index})" aria-label="第 ${index + 1} 格，${item ? item.name : '空位'}"
      title="${item ? item.name : '摆放商品'}">${item ? itemArtwork(id) : '<span aria-hidden="true">+</span>'}</button>`;
  }).join('');
}

function openDisplaySlot(index) {
  const picker = $('#display-picker');
  const products = displayProductIds().filter(id =>
    !state.displaySlots.some((selected, slot) => selected === id && slot !== index));
  const select = $('#display-product');
  picker.dataset.slot = index;
  $('#display-picker-title').textContent = '货架 · 第 ' + (index + 1) + ' 格';
  select.innerHTML = '<option value="auto">自动陈列</option><option value="">留空</option>' +
    products.map(id => `<option value="${id}">${itemById(id).name}</option>`).join('');
  const selected = state.displaySlots[index];
  select.value = selected == null ? 'auto' : products.includes(selected) ? selected : '';
  picker.showModal();
}

function placeDisplayProduct() {
  const picker = $('#display-picker');
  const index = Number(picker.dataset.slot);
  const selected = $('#display-product').value;
  state.displaySlots[index] = selected === 'auto' ? null : selected;
  picker.close();
  renderCounterSlots();
  save();
  $('#display-slot-' + index).focus();
}

function renderTop() {
  $('#stat-day').textContent = `第 ${state.day} 天`;
  $('#stat-money').textContent = `💰 ¥${state.money}`;
  $('#stat-rep').textContent = `口碑 ${state.rep}`;
  $('#stat-rep').title = '口碑进度 ' + state.repVisits + ' / ' + CONFIG.reputation.visitsPerPoint;
  $('#stat-goal').textContent = state.won ? '🎯 已盘下店面！' : `🎯 盘下店面 ¥${state.money} / ¥${CONFIG.goalMoney}`;
  $('#win-banner').classList.toggle('hidden', !(state.won && !state.winSeen));
}

function esc(t) { return String(t); } // 文案均为自创可信文本，不做额外转义

function renderVisitor() {
  const area = $('#visitor-area'), act = $('#action-area');
  const c = state.current;
  if (!c) {
    for (const section of [area, act, $('#portrait-frame'), $('#trade-dialogue')]) section.innerHTML = '';
    return;
  }
  if (c.type === 'seller') return renderSeller(c, area, act);
  return renderBuyer(c, area, act);
}

function renderDialogue(guest, role, lines) {
  const frame = $('#portrait-frame');
  const identity = guest.portraitName || guest.name;
  const portrait = identity === '快递小哥' ? 'courier' : PORTRAITS[identity];
  frame.dataset.portrait = portrait == null ? 'fallback' : String(portrait);
  frame.textContent = portrait == null ? guest.avatar : '';
  $('#trade-dialogue').innerHTML = `<header><strong>${esc(guest.name)}</strong><span>${role}</span></header>
    ${lines.map(line => '<p>' + esc(line) + '</p>').join('')}`;
}

function flipInspection() {
  inspectionFace = 1 - inspectionFace;
  renderVisitor();
  $('#flip-inspection').focus();
}

function inspectPart(index) {
  const guest = state.current;
  if (!guest || guest.type !== 'seller' || !Number.isInteger(index) || !itemById(guest.itemId).checks[index]) return;
  if (!guest.checked.includes(index) && guest.checksUsed >= CONFIG.maxChecks) return;
  inspectedPart = index;
  if (guest.checked.includes(index)) renderVisitor();
  else doCheck(index);
  $('#inspection-part-' + index).focus();
}

function renderInspection(guest, item) {
  const handheld = item.id === 'youxiji';
  const points = handheld ? HANDHELD_INSPECTION[inspectionFace]
    : ITEM_INSPECTION[item.id].map(([x, y], index) => ({ index, x, y }));
  const markers = points.map(({ index, x, y }) => {
    const name = item.checks[index][0];
    const visited = guest.checked.includes(index);
    const locked = !visited && guest.checksUsed >= CONFIG.maxChecks;
    return `<button type="button" id="inspection-part-${index}" class="inspection-marker"
      style="--x:${x}%;--y:${y}%" aria-label="查${name}" title="${name}" aria-pressed="${inspectedPart === index}"
      onclick="inspectPart(${index})" ${locked ? 'disabled' : ''}>${visited ? '✓' : index + 1}<span class="inspection-label">${name}</span></button>`;
  }).join('');
  const checked = guest.checked;
  const recent = checked.includes(inspectedPart) ? inspectedPart : checked[checked.length - 1];
  const clue = recent === undefined ? '点物品上的标记检查部位。' : inspectionClue(guest, item, recent);
  const flip = handheld ? `<div class="inspection-controls">
      <span>${inspectionFace ? '背面' : '正面'}</span>
      <button type="button" id="flip-inspection" class="btn small" onclick="flipInspection()">翻到${inspectionFace ? '正' : '背'}面</button>
    </div>` : '';
  return `${flip}
    <div class="inspection-object ${handheld ? 'inspection-handheld' : ''}" data-face="${inspectionFace}">${handheld ? '' : itemArtwork(item.id)}${markers}</div>
    <div class="inspection-result" aria-live="polite">${clue}</div>`;
}

function inspectionClue(guest, item, index) {
  const check = item.checks[index];
  const text = guest.variant === 'real' ? check[1] : guest.variant === 'fake' ? check[2] : check[3];
  return `<div class="clue"><b>${check[0]}：</b>${esc(text)}</div>`;
}

function renderSeller(c, area, act) {
  const item = itemById(c.itemId);
  renderDialogue(c, c.regularId ? '熟客 · 卖家' : '卖家', c.lastWords ? [c.lastWords] : [c.line, pickCachedPitch(c)]);
  area.innerHTML = '';
  const draft = tradeOpen ? $('#bidInput')?.value : '';
  const minimum = c.openingBid ? c.openingBid + 1 : 1;
  const prices = c.openingBid
    ? []
    : [Math.max(1, Math.round(c.ask * .55)), Math.max(1, Math.round(c.ask * .75)), c.ask];
  const shortcuts = [...new Set(prices.map(price => Math.max(minimum, price)))].map(price =>
    `<button type="button" class="btn small" onclick="$('#bidInput').value = ${price}; $('#bidInput').focus()">¥${price}</button>`).join('');
  act.innerHTML = `
    <section class="trade-group seller-inspection">
      <h3>${item.name} · 剩余 ${CONFIG.maxChecks - c.checksUsed} 次验货</h3>
      ${renderInspection(c, item)}
      <button class="btn small" onclick="doHint()" ${c.hintUsed ? 'disabled' : ''}>鉴定提示</button>
      ${c.hintText ? `<div class="hint">${esc(c.hintText)}</div>` : ''}
    </section>
    <form class="trade-group seller-bid" onsubmit="event.preventDefault(); customBid()">
      <h3>卖家要价 ¥${c.ask}</h3>
      <p>${c.openingBid ? `起价 ¥${c.openingBid} 没谈成。请自己判断最后要出多少。` : '先报你愿意出的最低价。卖家接受就成交。'}</p>
      ${shortcuts ? `<div class="trade-actions" aria-label="快捷填价">${shortcuts}</div>` : ''}
      <div class="trade-actions">
        <label for="bidInput">${c.openingBid ? '最后报价' : '起价'}（元）</label>
        <input id="bidInput" class="bid-input" type="number" inputmode="numeric" min="${minimum}" max="${c.ask}" step="1" required>
        <button type="submit" class="btn small gold">确认出价</button>
        <button type="button" class="btn small" onclick="refuseSeller()">不收</button>
      </div>
    </form>`;
  const amount = $('#bidInput');
  if (draft && Number(draft) >= minimum && Number(draft) <= c.ask) amount.value = draft;
}

/* 卖家推销词在访客生成时定下，避免每次渲染乱跳 */
function pickCachedPitch(c) {
  if (!c.pitch) c.pitch = pick(SELLER_PITCH).replace('{item}', itemById(c.itemId).name);
  return c.pitch;
}

function customBid() {
  resolveBid(Number($('#bidInput').value));
}

function renderBuyer(guest, area, act) {
  area.innerHTML = '';
  const lines = receiptLines(guest);
  const reserved = new Set(guest.receipt.map(row => row.uid));
  const available = uniqueStock(counterInventory().filter(stock =>
    retailAvailable(stock) && !reserved.has(stock.uid) &&
    (!guest.wantedItem || (!guest.receipt.length && matchesBuyerRequest(guest, stock)))));
  const clearance = available.filter(stock => serviceAvailable('clearance') && stockCondition(stock) === 'near');
  const grilled = available.filter(stock => stock.grilled);
  const regular = available.filter(stock => !stock.grilled && !clearance.includes(stock));
  act.innerHTML = `<div class="checkout">
    <div class="checkout-stock">
      <p class="buyer-request">${guest.line}</p>
      <p id="buyer-reply" class="buyer-request hidden"></p>
      ${guest.wantedItem && guest.receipt.length ? '' : guest.selfPick
        ? canRecommend(guest) ? renderBuyerOptions('推荐加购', available, guest) : ''
        : renderBuyerOptions('货架', regular, guest) +
          (clearance.length ? renderBuyerOptions('临期促销区', clearance, guest) : '') +
          (grilled.length ? renderBuyerOptions('现烤热食', grilled, guest) : '')}
      <button type="button" class="btn small" onclick="buyerRefuse()">结束接待</button>
    </div>
    <form class="receipt" onsubmit="event.preventDefault(); settleBuyerSale()">
      <header><strong>购物小票</strong><small>第 ${state.day} 天 · ${guest.selfPick ? '顾客自选' : '店主配货'}</small></header>
      ${lines.map(renderReceiptLine).join('') || '<p class="receipt-empty">小票里没有商品</p>'}
      <div class="receipt-totals"><span>合计</span><strong id="receipt-total"></strong>
        <small id="receipt-savings"></small><small id="receipt-budget"></small></div>
      <div class="trade-actions">
        <button class="btn gold" ${lines.length ? '' : 'disabled'}>确认结账</button>
        <button id="receipt-discount" type="button" class="btn receipt-discount" aria-pressed="${!!guest.discounted}" onclick="toggleReceiptDiscount()">${guest.discounted ? '取消九折' : '整单 −10%'}</button>
        ${guest.creditAsk && lines.length ? '<button class="btn" type="submit" formaction="#" onclick="event.preventDefault(); if (this.form.reportValidity()) settleBuyerSale(true)">记赊账</button>' : ''}
      </div>
    </form>
  </div>`;
  updateReceipt(guest);
}

function renderBuyerOptions(title, stocks, guest) {
  const action = guest.selfPick ? '推荐' : '添加';
  const tiles = stocks.map(stock => {
    const product = itemById(stock.itemId);
    const wanted = stock.itemId === guest.wantedItem;
    const handler = guest.selfPick ? `recommendStock(${stock.uid})` : `editReceipt(${stock.uid},'add')`;
    return `<button type="button" class="stock-tile" onclick="${handler}" aria-label="${action}${product.name}，${(stock.grilled ? grillStage(stock) : CONDITION[stockCondition(stock)]).name}，¥${counterPrice(stock)}">
      ${itemArtwork(product.id)}<span>${product.name}${wanted ? ' · 点名' : ''}</span>
      ${conditionBadge(stock)}<small>+ ¥${counterPrice(stock)}</small></button>`;
  }).join('');
  return `<section class="checkout-options"><h3>${title}</h3>${tiles ? '<div class="buyer-options">' + tiles + '</div>' : '<p>暂无可添加的商品</p>'}</section>`;
}

function renderReceiptLine({ row, stock, item }) {
  const canRelabel = !stock.grilled && (stock.variant === 'fake' || stockCondition(stock) !== betterLabel(stock));
  const label = stock.grilled ? grillStage(stock).name : CONDITION[row.upgraded ? betterLabel(stock) : stockCondition(stock)].name;
  return `<div class="receipt-line">
    <div><strong>${item.name}</strong><small>${label}${row.upgraded ? ' · 已改签' : ''}</small></div>
    <label>¥ <input type="number" min="0" max="${CONFIG.retail.maxUnitPrice}" step="1" required
      inputmode="numeric" value="${row.price}" aria-label="${item.name}单价" oninput="editReceiptPrice(${row.uid},this)"></label>
    <button type="button" class="receipt-remove" onclick="editReceipt(${row.uid},'remove')" aria-label="移除${item.name}">×</button>
    ${canRelabel ? `<button type="button" class="receipt-label" onclick="editReceipt(${row.uid},'label')">${row.upgraded ? '恢复原签' : '悄悄改成' + CONDITION[betterLabel(stock)].name}</button>` : ''}
  </div>`;
}

function renderTabs() {
  if (!serviceAvailable(currentTab) || currentTab === 'grill' && !state.grill.owned) currentTab = 'shelf';
  document.querySelectorAll('#tabs .tab').forEach(b => {
    b.classList.toggle('hidden', !serviceAvailable(b.dataset.tab) || b.dataset.tab === 'grill' && !state.grill.owned);
    b.classList.toggle('active', b.dataset.tab === currentTab);
  });
  const page = $('#tab-pages');
  if (currentTab === 'shelf') page.innerHTML = tabShelf();
  else if (currentTab === 'wholesale') page.innerHTML = tabWholesale();
  else if (currentTab === 'poke') page.innerHTML = tabPoke();
  else if (currentTab === 'sticker') page.innerHTML = tabSticker();
  else if (currentTab === 'ledger') page.innerHTML = tabLedger();
  else if (currentTab === 'grill') page.innerHTML = tabGrill();
  else if (currentTab === 'collection') page.innerHTML = tabCollection();
  else page.innerHTML = tabRegulars();
}

function tabWholesale() {
  const products = WHOLESALE.filter(product => serviceAvailable(product.unlock)).map(product => {
    const { cost, soldOut } = wholesaleQuote(product);
    const total = cost * product.pack;
    const change = cost > product.cost ? ' · 今日涨价' : cost < product.cost ? ' · 今日降价' : '';
    const label = state.settlement ? '已打烊'
      : state.wholesaleOrders.includes(product.id) ? '今日已订'
      : soldOut ? '今日缺货' : '进货 ¥' + total;
    const disabled = state.settlement || soldOut || state.wholesaleOrders.includes(product.id);
    return `<div class="card">
      <div class="row"><span>${itemPreviewButton(product.id, true)} <b>${product.name}</b></span><span>每批 ${product.pack} 件</span></div>
      <div class="mut">进价 ¥${cost} / 件 · 参考零售价 ¥${product.value} / 件${change}</div>
      <button class="btn small gold display-toggle" onclick="orderWholesale('${product.id}')" ${disabled ? 'disabled' : ''}>${label}</button>
    </div>`;
  }).join('');
  const equipment = !serviceAvailable('grill') ? '' : state.grill.owned
    ? GRILL.foods.map(food => `<div class="card">
      <b>${food.name}</b> · 每批 ${food.pack} 串 · 冷冻库存 ${state.grill.supplies[food.id] || 0}
      <button class="btn small gold" onclick="orderGrillFood('${food.id}')" ${state.settlement || state.wholesaleOrders.includes(food.id) ? 'disabled' : ''}>进货 ¥${food.cost * food.pack}</button></div>`).join('')
    : `<div class="card"><b>烤肠机</b> · ${GRILL.capacity} 个烤位
      <button class="btn gold" onclick="buyGrill()" ${state.settlement ? 'disabled' : ''}>购置 ¥${GRILL.cost}</button></div>`;
  return '<p class="mut">每种商品每天限订一批，立即到货。</p>' + products + equipment;
}

function tabShelf() {
  const groups = new Map();
  for (const stock of state.shelf) {
    const key = [stock.itemId, stockCondition(stock), stock.variant, !!stock.relabelled, stock.stockedDay, stock.cost, retailPrice(stock)].join('/');
    if (!groups.has(key)) groups.set(key, { stock, count: 0 });
    groups.get(key).count++;
  }
  const tiles = Array.from(groups.values(), ({ stock, count }) => {
    const item = itemById(stock.itemId);
    return `<button type="button" class="stock-tile" id="shelf-${stock.uid}" onclick="viewStock(${stock.uid})"
      aria-label="查看${item.name}">${itemArtwork(item.id)}${count > 1 ? '<small class="stock-count">×' + count + '</small>' : ''}
      <span>${item.name}</span>${conditionBadge(stock)}</button>`;
  }).join('');
  const strategies = Object.entries(STRATEGIES).map(([key, rule]) =>
    `<button class="btn small" aria-pressed="${state.strategy === key}" onclick="setStrategy('${key}')">${rule.name}</button>`).join('');
  return `<div class="wood-shelves">${tiles || '<p>还没有商品，先去进货或收货。</p>'}</div>
    <details class="shelf-strategy"><summary>定价策略</summary><div class="trade-actions">${strategies}</div></details>
    ${renderMilestones()}`;
}

function renderMilestones() {
  const rows = Object.entries(MILESTONES).map(([key, [sales, days]]) =>
    `<li>${SERVICE_NAMES[key]} · ${serviceAvailable(key) ? '已开放' : '付现小票 ' + sales + ' 张，收摊 ' + days + ' 次'}</li>`).join('');
  const tutorials = TUTORIALS.filter(lesson => serviceAvailable(lesson.unlock))
    .map(lesson => `<li><strong>${lesson.title}</strong> · ${lesson.text}</li>`).join('');
  return `<details class="milestones"><summary>经营进度 · 付现小票 ${state.progress.sales} 张 / 收摊 ${state.progress.days} 次</summary><ul>${rows}</ul></details>
    <details class="milestones"><summary>玩法教学</summary><ul>${tutorials}</ul></details>`;
}

function tabPoke() {
  const pk = state.poke;
  if (!pk.active) {
    const opts = POKE.grands.filter(pokePrizeAvailable).map(grand => {
      const total = POKE.boardCost + grand.cost;
      return `<div class="card"><div class="row"><span>${itemPreviewButton(grand.itemId)} <b>${itemById(grand.itemId).name}</b></span><span>整板 ¥${total}</span></div>
        <button class="btn small gold" onclick="pokeStock('${grand.itemId}')" ${state.settlement ? 'disabled' : ''}>挂上新板</button></div>`;
    }).join('');
    return `<p>一板 ${POKE.holes} 个洞，顾客每开一洞付 ¥${POKE.price}。</p>${opts}`;
  }
  const demand = pokeDemand();
  const holes = Array.from({ length: POKE.holes }, (_, index) => {
    const opened = pk.opened.includes(index);
    const prize = index === pk.grandPos;
    return `<span role="img" class="poke-hole${opened ? ' open' : ''}"
      aria-label="第 ${index + 1} 洞${opened ? prize ? '，已开出大奖' : '，已开' : '，未开'}">${opened ? prize ? '★' : '·' : '?'}</span>`;
  }).join('');
  return `<div class="poke-board">
    <div class="row"><b>戳戳乐</b><span>剩 ${pk.holesLeft} 洞 · 今天顾客已戳 ${pk.dayOpened} 洞</span></div>
    <div class="poke-grid">${holes}</div>
    <p>大奖 ${itemById(pk.grandId).name} · ${pk.grandTaken ? '已开出' : '还在板上'}</p>
    <small>顾客自己选洞，收入在收摊时入账。${!state.settlement && demand ? ' 今天预计还有 ' + demand + ' 位顾客来戳。' : ''}</small>
  </div>`;
}

function tabGrill() {
  const cooking = state.grill.slots.map(stock => {
    const food = itemById(stock.itemId);
    const stage = grillStage(stock);
    return `<article class="grill-slot" data-stage="${stage.key}">
      <span class="grill-food-icon" aria-hidden="true">${food.emoji}</span>
      <strong>${food.name}</strong><small>${stage.name}</small>
      <button type="button" class="btn small" onclick="discardGrillFood(${stock.uid})" ${state.settlement ? 'disabled' : ''}>撤下</button>
    </article>`;
  }).join('');
  const empty = '<div class="grill-slot"><span>空烤位</span></div>'.repeat(GRILL.capacity - state.grill.slots.length);
  const controls = GRILL.foods.map(food => {
    const amount = state.grill.supplies[food.id] || 0;
    return `<button class="btn small gold" onclick="placeGrillFood('${food.id}')" ${!amount || state.grill.slots.length >= GRILL.capacity || state.settlement ? 'disabled' : ''}>放上${food.name} · 冷冻库存 ${amount}</button>`;
  }).join('');
  return `<section class="grill-panel">
    <p>送走一位顾客，火候才推进一次。熟了或开花时可以在小票添加，未熟可能被顾客拒绝。</p>
    <div class="grill-rack">${cooking}${empty}</div>
    <div class="trade-actions">${controls}<button class="btn small" onclick="openManagement('wholesale')">向供货商补货</button></div>
  </section>`;
}

function tabSticker() {
  const st = state.sticker;
  return `<div class="card"><div class="row"><span>🧧 集贴纸换 ¥100 活动</span><span>${st.on ? '进行中' : '未开启'}</span></div>
    <div class="mut">买零食集贴纸，集满一套兑 ¥100。全民都记得的那张「金龙」——到底存不存在，你说了算。</div>
    <div style="margin-top:8px;">稀有「金龙」投放量：<b>${st.rare}</b> 张
      <input type="range" min="0" max="${STICKER.rareMax}" step="1" value="${st.rare}" onchange="stickerSetRare(this.value)">
      <span class="mut">（0 张利润最高，但嘀咕值涨得快）</span></div>
    <div class="mut" style="margin-top:6px;">嘀咕值：${st.grumble} / ${STICKER.grumbleLimit} ${st.badge ? '｜🏆 已赢得「良心小卖部」' : ''}</div>
    <button class="btn small ${st.on ? '' : 'primary'}" onclick="stickerToggle()" style="margin-top:8px;">${st.on ? '撤下活动' : '开启活动'}</button></div>`;
}

function tabLedger() {
  if (!state.ledger.length) return '<div class="card mut">赊账本还是空的。熟客买东西时可能会提出「先记账上」。</div>';
  return state.ledger.slice().reverse().map((e) => `<div class="card"><div class="row">
    <span>📒 ${esc(e.whoName)} 赊账 <b>¥${e.amount}</b></span>
    <span>${e.done ? (e.result === 'repaid' ? '✅ 已还' : '🏃 赖账了') : `⏳ 第 ${e.due} 天到期`}</span></div></div>`).join('');
}

function tabCollection() {
  const got = Object.keys(state.collection).length;
  const cells = ITEMS.map((it) => {
    const c = state.collection[it.id];
    if (!c) return `<div class="col-cell locked"><span class="emo">❔</span>${it.name}<br><span class="mut">未遭遇</span></div>`;
    const marks = ['real', 'bad', 'fake'].map((v) => c[v] ? `<span class="pill ${v}">${CONFIG.variantName[v]}</span>` : '').join('');
    return `<div class="col-cell got">${itemPreviewButton(it.id)}${it.name}<br>${marks}<br><span class="mut">${esc(it.flavor)}</span></div>`;
  }).join('');
  const sp = `<div class="col-cell ${state.specialCards.pokeGrand ? 'got' : 'locked'}"><span class="emo">🎯</span>戳戳乐大奖<br><span class="mut">${state.specialCards.pokeGrand ? '已上架过' : '进货戳戳乐解锁'}</span></div>
    <div class="col-cell ${state.specialCards.jinlong ? 'got' : 'locked'}">${state.specialCards.jinlong ? itemPreviewButton('jinlong') : '<span class="emo">❔</span>'}金龙贴纸<br><span class="mut">${state.specialCards.jinlong ? '真的存在过！' : '投放量>0 或有人兑付时解锁'}</span></div>`;
  return `<div class="card">📖 收集进度：<b>${got} / ${ITEMS.length}</b> 种物品（成色分开点亮）</div><div class="collection-grid">${cells}${sp}</div>`;
}

function tabRegulars() {
  return REGULARS.map((r) => {
    const s = getRegular(r.id);
    const unlock = s.favor >= CONFIG.favorSpecialAt ? '已解锁专属好货' : s.favor >= CONFIG.favorGoodOddsAt ? '货源成色变好' : '继续成交涨好感';
    return `<div class="card"><div class="row"><span>${r.avatar} <b>${r.name}</b>（${r.role}）</span><span>❤️ 好感 ${s.favor}｜来访 ${s.visits} 次</span></div>
      <div class="mut">${unlock}｜拿手货：${r.favItems.map((id) => itemById(id).name).join('、')}</div></div>`;
  }).join('');
}

function renderLog() {
  $('#log').innerHTML = state.log.map((l) => `<li>${esc(l)}</li>`).join('');
}

/* ---------------- 结算弹窗 ---------------- */
function showSettlement(s) {
  const amount = value => (value > 0 ? '+' : value < 0 ? '−' : '') + '¥' + Math.abs(value);
  const row = (label, value) => `<tr><td>${esc(label)}</td><td class="${value >= 0 ? 'plus' : 'minus'}">${amount(value)}</td></tr>`;
  const sales = list => {
    const groups = new Map();
    for (const entry of list) {
      const name = (entry.itemId && itemById(entry.itemId)?.name) || entry.label;
      const group = groups.get(name) || { count: 0, revenue: 0 };
      group.count++;
      group.revenue += entry.revenue;
      groups.set(name, group);
    }
    return [...groups].map(([name, group]) => row(name + ' ×' + group.count, group.revenue)).join('');
  };
  const detail = (title, rows) => rows ? `<details><summary>${title}</summary><table>${rows}</table></details>` : '';
  $('#modal').innerHTML = `<h3>第 ${state.day} 天收摊</h3>
    <p class="settlement-total">今日净变化 <b class="${s.net >= 0 ? 'plus' : 'minus'}">${amount(s.net)}</b></p>
    <p class="mut">余额 ¥${state.money} · 口碑 ${state.rep}</p>
    <table aria-label="今日收支">
      ${row('柜台销售 · ' + s.dayList.length + ' 件', s.dayTotal)}
      ${row('收摊售卖 · ' + s.autoList.length + ' 件', s.autoTotal)}
      ${row('白天支出', -s.daytimeSpend)}
      ${row('其他收支', s.otherTotal)}
    </table>
    <button class="btn primary" onclick="nextDay()">进入明天</button>
    <div class="settlement-details">
      ${detail('柜台销售明细', sales(s.dayList))}
      ${detail('收摊售卖明细', sales(s.autoList))}
      ${detail('其他收支明细', s.others.map(entry => row(entry.label, entry.amount)).join(''))}
    </div>`;
  $('#modal-mask').classList.remove('hidden');
}

/* ---------------- 初始化与全局绑定 ---------------- */
function resetGame() {
  if (!confirm('确定要清空存档、重新开店吗？')) return;
  localStorage.removeItem(CONFIG.saveKey);
  state = newState();
  addLog('新店开业！口袋里有 ¥250，目标是攒够 ¥3000 盘下店面。');
  prepareDay();
  renderAll(); save();
}

document.querySelectorAll('#tabs .tab').forEach((b) =>
  b.addEventListener('click', () => { currentTab = b.dataset.tab; renderTabs(); }));
$('#btn-openday').addEventListener('click', startDay);
$('#btn-endday').addEventListener('click', endDay);
$('#guest-call').addEventListener('click', () => {
  if (!state.current || state.settlement) return;
  tradeOpen = !tradeOpen;
  renderWindow();
});
function openManagement(tab) {
  currentTab = tab;
  $('#side').open = true;
  renderTabs();
  const button = $(`#tabs [data-tab="${tab}"]`);
  button.focus({ preventScroll: true });
  $('#side').scrollIntoView({ block: 'start' });
}

$('#display-picker form').addEventListener('submit', event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  placeDisplayProduct();
});
$('#viewer-label').addEventListener('click', () => changeLabel(viewedShelfUid));
$('#shop-npc').addEventListener('click', () => openNeighborhood('mentor'));
$('#shop-organizer').addEventListener('click', () => openNeighborhood('organizer'));
$('#close-neighborhood').addEventListener('click', closeNeighborhood);
$('#promote-shop').addEventListener('click', recruitShoppers);
$('#music-toggle').addEventListener('click', toggleMusic);
$('#music-volume').addEventListener('input', setMusicVolume);
$('#event-dialog').addEventListener('close', () => $(state.current ? '#guest-call' : '#btn-endday').focus());
$('#close-item-viewer').addEventListener('click', () => $('#item-viewer').close());
$('#zoom-item').addEventListener('click', () => {
  const zoom = $('#zoom-item');
  const enlarged = zoom.getAttribute('aria-pressed') !== 'true';
  zoom.setAttribute('aria-pressed', String(enlarged));
  zoom.setAttribute('aria-label', (enlarged ? '缩小' : '放大') + $('#item-viewer-name').textContent);
});
$('#viewer-shelf').addEventListener('click', () => {
  $('#item-viewer').close();
  openManagement('shelf');
});
$('#open-log').addEventListener('click', () => $('#log-book').showModal());
$('#close-log').addEventListener('click', () => $('#log-book').close());
$('#open-wholesale').addEventListener('click', () => openManagement('wholesale'));
$('#open-poke').addEventListener('click', () => openManagement('poke'));
$('#open-grill').addEventListener('click', () => openManagement('grill'));
$('#btn-reset').addEventListener('click', () => {
  resetGame();
  openTitle();
});
$('#open-title').addEventListener('click', openTitle);
$('#start-game').addEventListener('click', () => enterShop(false));
$('#guide-start').addEventListener('click', () => enterShop(true));
$('#hide-guide').addEventListener('click', () => {
  state.guide = false;
  renderGuide();
  save();
});
$('#title-screen').addEventListener('cancel', event => event.preventDefault());
$('#btn-win-close').addEventListener('click', () => { state.winSeen = true; renderTop(); save(); });

state = load();
if (!state) {
  state = newState();
  addLog('新店开业！口袋里有 ¥250，目标是攒够 ¥3000 盘下店面。');
  prepareDay();
}
if (state.shopOpen && !state.settlement && (!state.current && state.queue.length || state.current?.type === 'buyer' && !state.current.receipt)) {
  if (state.current?.type === 'buyer') state.queue.unshift({ type: 'buyer' });
  nextVisitor();
}
renderAll();
if (state.settlement) showSettlement(state.settlement);
openTitle();
