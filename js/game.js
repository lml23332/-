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
const regularById = (id) => REGULARS.find((r) => r.id === id) || NEW_CUSTOMERS.find(person => person.id === id && NEW_REGULAR_ROLES[id]);
let uidSeq = 1;
const nextUid = () => Date.now() * 100 + (uidSeq++ % 100);
// 正式发布前改为 false；开发测试入口与强制事件会整体关闭。
const DEV_MODE = true;

/* ---------------- 游戏状态 ---------------- */
let state = null;
let shelfDrag = null;
let currentTab = 'shelf';
let tradeOpen = false;
let inspectionFace = 0;
let inspectedPart = null;
let noticeTimer;
let viewedShelfUid = null;
let guideFrame = null;
let guideTarget = null;
let guideKey = '';
let cashFeedbackTimer;
let receiptZoom = 1;
let receiptCollapsed = false;

function newState() {
  return {
    day: 1,
    shelfLayout: { version: 1, rows: SHELF_GRID.rows, placements: [] },
    shopName: '',
    delivery: null,
    customers: {},
    theftKnown: false,
    economyVersion: 1,
    retailVersion: 1,
    progress: { sales: 0, days: 0, kept: [] },
    serviceTurns: 0,
    repVisits: 0,
    dailyRepLoss: 0,
    neighborSeen: {},
    neighborTalk: null,
    grill: { owned: false, supplies: {}, slots: [], tray: [], studentDay: 0 },
    displaySlots: [],
    promoDay: 0,
    started: false,
    shopOpen: false,
    visitsToday: 0,
    clockServed: 0,
    guide: true,
    seenTutorials: [],
    guidedLessons: [],
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
  pruneShelfLayout();
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
    if (!s.guidedLessons) {
      // 旧档只为更新之后新开放的功能显示箭头。
      s.guidedLessons = TUTORIALS.filter(({ unlock }) => {
        const milestone = MILESTONES[unlock];
        return milestone && (s.progress.kept.includes(unlock) ||
          (s.progress.sales >= milestone[0] && s.progress.days >= milestone[1]));
      }).map(lesson => lesson.id);
    }
    if (s.current?.type === 'buyer') prepareBuyerState(s.current);
    if (s.started && !s.shopName) s.shopName = SHOP_SIGN.defaultName;
    if (s.grill) s.grill.tray ||= [];
    if (s.customers) delete s.customers.mother;
    if (s.current?.customerId === 'mother') {
      (s.queue ||= []).unshift({ type: 'buyer' });
      s.current = null;
    }
    return Object.assign(newState(), { started: true, guide: false }, s, { shelfLayout: s.shelfLayout || migrateShelfLayout(s.shelf) }); // 用默认值兜底新字段，保证老存档可续
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

function shopCategory(item) {
  const fine = itemCategory(item);
  return SHOP_CATEGORIES.find(category => category.cats.includes(fine)) || SHOP_CATEGORIES[2];
}

function buyerProfileId(person = {}) {
  const regular = regularById(person.regularId);
  if (regular?.profile) return regular.profile;
  if (person.profile && BUYER_PROFILES[person.profile]) return person.profile;
  const name = person.portraitName || person.name || '';
  if (/小学生|豆包/.test(name)) return 'child';
  if (/阿姨|婶|大姐|妈妈|妈$/.test(name)) return 'auntie';
  if (/年轻|强子/.test(name)) return 'youngMan';
  if (/学生|女生/.test(name)) return 'student';
  if (/老|爷|叔/.test(name)) return 'elder';
  return 'adult';
}

function prepareBuyerState(guest) {
  if (!guest || guest.type !== 'buyer') return guest;
  guest.profile = buyerProfileId(guest);
  const profile = BUYER_PROFILES[guest.profile];
  if (!Number.isInteger(guest.maxHaggleRounds)) guest.maxHaggleRounds = randInt(...profile.rounds);
  if (typeof guest.bargainTarget !== 'number') guest.bargainTarget = rand(profile.target[0], profile.target[1]);
  if (typeof guest.willHaggle !== 'boolean') guest.willHaggle = Math.random() < profile.haggleChance;
  if (!Number.isInteger(guest.haggleRound)) guest.haggleRound = 0;
  if (!guest.categoryFilter) guest.categoryFilter = guest.wantedCategory || 'all';
  return guest;
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
  return Math.max(1, Math.round(base * STRATEGIES[state.strategy].mult * calendarPrice(itemById(stock.itemId))));
}

function calendarDay(day) {
  return (day - 1) % SHOP_CALENDAR.cycleDays + 1;
}

function calendarEvent(day = state.day) {
  return SHOP_CALENDAR.events.find(event => event.day === calendarDay(day));
}

function calendarPrice(item) {
  return calendarEvent()?.prices[shopCategory(item).id] ?? 1;
}

function openCalendar() {
  const { cycleDays, weekdays } = SHOP_CALENDAR;
  const today = calendarDay(state.day);
  const cycle = Math.floor((state.day - 1) / cycleDays) + 1;
  const start = state.day - today + 1;
  const cells = Array.from({ length: cycleDays }, (_, index) => {
    const day = index + 1;
    const event = calendarEvent(start + index);
    return `<li ${day === today ? 'aria-current="date"' : ''} class="${event ? 'calendar-event' : ''}">
      <b>${day}</b>${event ? '<small>' + event.name + '</small>' : ''}</li>`;
  }).join('');
  const events = SHOP_CALENDAR.events.map(event => {
    const changes = Object.entries(event.prices).map(([id, multiplier]) => {
      const category = SHOP_CATEGORIES.find(entry => entry.id === id);
      const percent = Math.round((multiplier - 1) * 100);
      return category.name + ' ' + (percent > 0 ? '+' : '') + percent + '%';
    });
    const traffic = event.buyers ? '买家 ' + (event.buyers > 0 ? '+' : '') + event.buyers + ' 位' : '';
    return `<li><strong>${event.day} 日 · ${event.name}</strong><small>${[traffic, ...changes].filter(Boolean).join(' · ')}</small>
      <p>${event.description}</p></li>`;
  }).join('');
  $('#calendar-content').innerHTML = `<p>第 ${cycle} 期 · 今天是 ${today} 日</p>
    <div class="calendar-week" aria-hidden="true">${weekdays.map(day => '<span>' + day + '</span>').join('')}</div>
    <ol class="calendar-grid">${cells}</ol><ul class="calendar-events">${events}</ul>`;
  $('#calendar-dialog').showModal();
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

function deliveryStock() {
  return state.shelf.filter(stock => retailAvailable(stock) && stock.wholesale &&
    !['expired', 'spoiled'].includes(stockCondition(stock)));
}

function openDelivery() {
  if (!serviceAvailable('delivery')) return;
  const content = $('#shop-service-content');
  const order = state.delivery;
  let message = '营业后可查看订单。';
  if (state.shopOpen && !state.settlement) {
    if (!order) {
      const available = deliveryStock();
      const stock = available.find(entry => available.filter(other => other.itemId === entry.itemId).length >= DELIVERY.count);
      message = stock ? `<p>顾客要 ${itemById(stock.itemId).name} ×${DELIVERY.count}，另付 ¥${DELIVERY.fee} 服务费。</p>
        <button class="btn gold" onclick="acceptDelivery('${stock.itemId}')">接单</button>` : '货架上没有足够的库存可接单。';
    } else if (order.status === 'accepted') {
      message = `<p>待配货 · ${itemById(order.itemId).name} ×${DELIVERY.count} · 剩 ${order.deadline - state.serviceTurns} 位顾客</p>
        <button class="btn gold" onclick="packDelivery()">配好货</button>`;
    } else {
      message = { packed: '已配好，等骑手来取。', delivered: '骑手已取货，货款和服务费已入账。', expired: '订单已超时。' }[order.status];
    }
  }
  content.innerHTML = '<h2 id="shop-service-title">外卖</h2>' + message;
  if (!$('#shop-service').open) $('#shop-service').showModal();
}

function acceptDelivery(id) {
  if (!serviceAvailable('delivery') || state.delivery || !state.shopOpen || state.settlement) return;
  if (deliveryStock().filter(stock => stock.itemId === id).length < DELIVERY.count) return;
  state.delivery = { itemId: id, status: 'accepted', deadline: state.serviceTurns + DELIVERY.packTurns };
  save(); openDelivery();
}

function packDelivery() {
  const order = state.delivery;
  if (order?.status !== 'accepted' || state.settlement || state.serviceTurns >= order.deadline) return;
  const reserved = new Set(state.current?.receipt?.map(row => row.uid));
  const stock = deliveryStock().filter(entry => entry.itemId === order.itemId && !reserved.has(entry.uid)).slice(0, DELIVERY.count);
  if (stock.length < DELIVERY.count) {
    $('#shop-service-content').insertAdjacentHTML('beforeend', '<p>库存不足，柜台小票里的商品需要先结算或移除。</p>');
    return;
  }
  const packed = new Set(stock.map(entry => entry.uid));
  state.shelf = state.shelf.filter(entry => !packed.has(entry.uid));
  order.total = stock.reduce((sum, entry) => sum + counterPrice(entry), DELIVERY.fee);
  order.cost = stock.reduce((sum, entry) => sum + entry.cost, 0);
  order.status = 'packed';
  order.pickupAt = state.serviceTurns + DELIVERY.pickupTurns;
  renderAll(); save(); openDelivery();
}

function advanceDelivery(closing = false) {
  const order = state.delivery;
  if (order?.status === 'accepted' && (closing || state.serviceTurns >= order.deadline)) {
    order.status = 'expired';
    addLog('外卖订单超时。');
  }
  if (order?.status !== 'packed' || (!closing && state.serviceTurns < order.pickupAt)) return;
  order.status = 'delivered';
  state.money += order.total;
  state.daySales.push({ label: '外卖 · ' + itemById(order.itemId).name, revenue: order.total, profit: order.total - order.cost });
  countGoodVisit(DELIVERY.repProgress);
  addLog('骑手取走外卖，实收 ¥' + order.total + '。');
}

function renderNeighborhood() {
  const role = state.neighborTalk;
  $('#open-delivery').classList.toggle('hidden', !serviceAvailable('delivery'));
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
  // 街坊说明让位给正式接待；队列清空后再提示尚未见过的新街坊。
  if (state.current) state.neighborTalk = null;
  else showNewNeighbor();
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

function makeBuyer(student = false, forcedProfile = '', customerId = '') {
  const rules = CONFIG.retail;
  const stock = counterInventory().filter(retailAvailable);
  const forcedPeople = forcedProfile ? BUYERS.filter(person => person.profile === forcedProfile) : [];
  const special = NEW_CUSTOMERS.find(person => person.id === customerId) ||
    (!student && !forcedProfile && Math.random() < CUSTOMER_RULES.newChance ? pick(NEW_CUSTOMERS) : null);
  const useRegular = !special && !student && !forcedProfile && Math.random() < .35;
  const person = special || (student ? { name: pick(GRILL.studentNames), avatar: '🎒', profile: 'child' }
    : forcedPeople.length ? pick(forcedPeople) : useRegular ? pick(REGULARS) : pick(BUYERS));
  const profileId = forcedProfile || buyerProfileId(person);
  const profile = BUYER_PROFILES[profileId];
  const age = profileId === 'elder' ? 'older' : ['child', 'student', 'youngMan'].includes(profileId) ? 'young' : 'adult';
  const selfPick = stock.length > 0 && Math.random() < rules.selfPickChance;
  const hot = student ? stock.filter(entry => entry.grilled) : [];
  const likedItems = [...(special?.likes || []), ...(EXTRA_GOOD_PREFERENCES[person.id] || [])];
  const preferred = stock.filter(entry => likedItems.includes(entry.itemId));
  const pool = hot.length ? hot : preferred.length ? preferred : stock;
  const anchor = pool.length ? pick(uniqueStock(pool)) : null;
  const product = anchor ? itemById(anchor.itemId) : null;
  const premium = product && product.base?.[1] > CONFIG.standardTradeMax && serviceAvailable('premium');
  const lowBudget = student || profileId === 'child' || profileId === 'student';
  const range = lowBudget ? rules.everydayBudget : premium ? rules.premiumBudget
    : anchor && !anchor.wholesale ? rules.specialtyBudget : rules.everydayBudget;
  const regular = useRegular || !!NEW_REGULAR_ROLES[person.id];
  const favor = regular ? getRegular(person.id).favor : 0;
  const budget = Math.max(3, Math.round(randInt(...range) * profile.budgetMult * (1 + state.rep / 400 + favor * .025)));
  const cap = !serviceAvailable('premium') ? Math.min(budget, CONFIG.standardTradeMax) : budget;
  const wantedItem = !selfPick && product && counterPrice(anchor) <= cap && Math.random() < rules.specificChance ? product.id : null;
  const wantedCategory = !selfPick && !wantedItem && product && Math.random() < rules.categoryChance
    ? shopCategory(product).id : null;
  const wantedCondition = wantedItem && !anchor.grilled && Math.random() < rules.conditionChance ? stockCondition(anchor) : null;
  const guest = {
    type: 'buyer', name: special ? special.name : student ? person.name : useRegular ? person.name : age === 'young' ? '年轻顾客' : age === 'older' ? '路过的街坊' : '路过的顾客',
    customerId: special?.id, encounter: special?.event,
    portraitName: person.name, avatar: person.avatar || '👤', age, profile: profileId, cap, selfPick, wantedItem, wantedCategory, wantedCondition,
    regularId: regular ? person.id : null, receipt: [], priceStrategy: 'listed',
    creditAsk: serviceAvailable('ledger') && regular && Math.random() < CONFIG.creditChance,
    maxHaggleRounds: randInt(...profile.rounds), bargainTarget: rand(profile.target[0], profile.target[1]),
    willHaggle: Math.random() < profile.haggleChance, haggleRound: 0,
    categoryFilter: wantedCategory || 'all',
  };
  const condition = wantedCondition ? CONDITION[wantedCondition].name + '的' : '';
  guest.line = (wantedItem ? '帮我拿一件' + condition + product.name + '。'
    : wantedCategory ? '我想买点' + SHOP_CATEGORIES.find(category => category.id === wantedCategory).name + '，帮我挑挑。'
    : student ? '有热食吗？也可以帮我挑点别的。' : '帮我挑几样合适的吧。') + '我带了 ¥' + cap + '。';
  if (selfPick) fillSelfPickedReceipt(guest, pool);
  if (guest.encounter === 'help') guest.line = '今天还没吃东西，能给我一点吃的吗？';
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
  const adjustment = calendarEvent()?.buyers ?? 0;
  const count = clamp(CONFIG.buyersGuaranteed + STRATEGIES[state.strategy].buyers + neighborTraffic() + adjustment, ...CONFIG.retail.buyerCount);
  for (let i = 0; i < count; i++) state.queue.push({ type: 'buyer' });
}

function prepareDay() {
  state.delivery = null;
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
  $(state.current ? '#action-area' : '#btn-endday').focus({ preventScroll: true });
}

function finishVisit() {
  const guest = state.current;
  if (guest?.type === 'buyer' && !guest.finishedTrade) {
    resolveTheft(guest);
    if (guest.regularId && !guest.turnedAway && state.poke.active && pokeDemand()) {
      guest.finishedTrade = true;
      renderAll(); save();
      return;
    }
  }
  state.serviceTurns++;
  advanceDelivery();
  state.visitsToday++;
  nextVisitor();
}

function recordCustomerVisit(guest) {
  if (!guest) return;
  if (guest.regularId) getRegular(guest.regularId).visits++;
  const id = guest.customerId || guest.regularId || guest.portraitName || guest.name;
  const card = state.customers[id] ||= { name: guest.name, visits: 0, chapters: [] };
  card.name = guest.portraitName || guest.name;
  card.visits++;
  const story = REGULAR_STORIES[id] || NEW_CUSTOMERS.find(person => person.id === id)?.story;
  const chapter = card.chapters.length;
  const relevantItems = STORY_ITEMS[id] || [];
  const matchesStory = guest.type === 'buyer' && (guest.wantedItem
    ? relevantItems.includes(guest.wantedItem)
    : guest.selfPick && receiptLines(guest).some(({ stock }) => relevantItems.includes(stock.itemId)));
  if (matchesStory && story?.[chapter] && card.visits >= CUSTOMER_RULES.storyVisits[chapter]) {
    guest.storyLine = story[chapter];
    card.chapters.push(guest.storyLine);
  }
}

function resolveTheft(guest) {
  if (guest.encounter !== 'theft' || guest.turnedAway) return;
  if (!(DEV_MODE && guest.devForceTheft) && Math.random() >= CUSTOMER_RULES.theftChance) return;
  const candidates = state.shelf.filter(retailAvailable);
  if (!candidates.length) return;
  const stock = pick(candidates);
  state.shelf = state.shelf.filter(entry => entry !== stock);
  state.theftKnown = true;
  notifyPlayer('顾客走后，你发现少了一件' + itemById(stock.itemId).name + '。记住了灰夹克顾客的样子。', true);
}

function resolveCustomerEvent(choice, uid) {
  const guest = state.current;
  if (!guest || state.settlement) return;
  if (guest.finishedTrade) {
    if (choice === 'play' && !guest.pokeResult && customerPokes()) {
      guest.pokeResult = state.poke.opened.at(-1) === state.poke.grandPos
        ? '戳中大奖了！谢谢老板！' : '我选了第 ' + (state.poke.opened.at(-1) + 1) + ' 洞，拿到小奖啦。';
      renderAll(); save();
      return;
    }
    if (choice === 'leave') finishVisit();
    return;
  }
  if (guest.encounter === 'help') {
    if (choice === 'give') {
      const stock = state.shelf.find(entry => entry.uid === uid && donationAvailable(entry));
      if (!stock) return;
      state.shelf = state.shelf.filter(entry => entry !== stock);
      if (Math.random() < CUSTOMER_RULES.helpRepChance) countGoodVisit(CUSTOMER_RULES.helpRepProgress);
      addLog('送给求助的街坊一份' + itemById(stock.itemId).name + '。');
    } else if (choice !== 'leave') return;
    return finishVisit();
  }
  if (guest.encounter !== 'theft' || !state.theftKnown || guest.allowedIn) return;
  if (choice === 'allow') {
    guest.allowedIn = true;
    renderAll(); save();
  } else if (choice === 'leave') {
    guest.turnedAway = true;
    finishVisit();
  }
}

function donationAvailable(stock) {
  return FOOD_LIFE[stock.itemId] && !['expired', 'spoiled'].includes(stockCondition(stock));
}

function renderCustomerEvent(guest, area, act) {
  area.innerHTML = '';
  let line = guest.line;
  let actions = '';
  if (guest.finishedTrade) {
    line = guest.pokeResult || '老板，我能花钱戳一个洞吗？';
    if (!guest.pokeResult && pokeDemand()) actions = '<button class="btn gold" onclick="resolveCustomerEvent(\'play\')">让顾客选洞</button>';
    actions += '<button class="btn" onclick="resolveCustomerEvent(\'leave\')">' + (guest.pokeResult ? '送走顾客' : '这次先不玩') + '</button>';
  } else if (guest.encounter === 'help') {
    actions = uniqueStock(state.shelf.filter(donationAvailable)).map(stock =>
      `<button class="btn gold" onclick="resolveCustomerEvent('give', ${stock.uid})">送一份${itemById(stock.itemId).name}</button>`).join('');
    actions += '<button class="btn" onclick="resolveCustomerEvent(\'leave\')">这次帮不上</button>';
  } else {
    line = '你认出了上次顺走商品的灰夹克顾客。';
    actions = '<button class="btn" onclick="resolveCustomerEvent(\'leave\')">请他离开</button><button class="btn gold" onclick="resolveCustomerEvent(\'allow\')">继续接待</button>';
  }
  renderDialogue(guest, guest.finishedTrade ? '熟客 · 戳戳乐' : '街坊来访', [guest.storyLine, line].filter(Boolean));
  act.innerHTML = `<div class="trade-actions">${actions}</div>`;
}

function nextVisitor() {
  const returnFocus = tradeOpen;
  tradeOpen = false;
  inspectionFace = 0;
  inspectedPart = null;
  receiptCollapsed = false;
  state.current = null;
  while (!state.current && state.queue.length) {
    const visitor = state.queue.shift();
    // 买家到柜台时按当前库存选货并报价。
    state.current = visitor.type === 'buyer' ? makeBuyer(visitor.student) : visitor;
    if (!state.current) addLog('有买家探头看了一眼：货架空了，先走了。');
  }
  recordCustomerVisit(state.current);
  // 顾客走到柜台就开始接待，避免再点一次人物才显示对白与交易面板。
  tradeOpen = !!state.current;
  // 街坊说明让位给正式接待；队列清空后再提示尚未见过的新街坊。
  if (state.current) state.neighborTalk = null;
  else showNewNeighbor();
  renderAll(); save();
  if (state.current) playCustomerArrival();
  if (returnFocus) $(state.current ? '#action-area' : '#btn-endday').focus({ preventScroll: true });
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

function showCashFeedback(total, profit) {
  const panel = $('#cash-feedback');
  panel.innerHTML = `<span>收款成功</span><strong>+¥${total}</strong><small>${profit >= 0 ? '这单赚了 ¥' + profit : '这单亏了 ¥' + Math.abs(profit)}</small>`;
  panel.classList.remove('show');
  void panel.offsetWidth;
  panel.classList.add('show');
  clearTimeout(cashFeedbackTimer);
  cashFeedbackTimer = setTimeout(() => panel.classList.remove('show'), 1200);
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
  if (stock.grilled) return (!stock.trayStage || stock.trayDay === state.day) && grillStage(stock).factor > 0;
  return state.shelfLayout.placements.some(slot => slot.uids.includes(stock.uid)) && (serviceAvailable('premium') || stock.wholesale ||
    itemById(stock.itemId).base[1] <= CONFIG.standardTradeMax);
}

function counterPrice(stock) {
  if (stock.grilled) return Math.max(1, Math.round(stock.value * grillStage(stock).factor * calendarPrice(itemById(stock.itemId))));
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

function receiptDealStatus(guest, quote) {
  const lines = receiptLines(guest);
  if (!lines.length) return { tone: 'idle', icon: '…', title: '等待配货', text: '把商品放进小票后再谈价格。', ready: false };
  if (guest.dealSignal) return guest.dealSignal;
  return {
    tone: 'idle', icon: '?', title: '等待顾客回应',
    text: `当前报价 ¥${quote.total}。点击报价后，顾客才会接受、还价或拒绝。`, ready: true,
  };
}

function updateReceipt(guest) {
  const quote = receiptQuote(guest);
  const status = receiptDealStatus(guest, quote);
  const lines = receiptLines(guest);
  $('#receipt-total').textContent = '¥' + quote.total;
  $('#receipt-savings').textContent = [
    quote.discount ? '原价 ¥' + quote.subtotal + ' · 整单优惠 −¥' + quote.discount : '',
    quote.roundOff ? '抹零 −¥' + quote.roundOff : '',
  ].filter(Boolean).join(' · ');
  const over = quote.total > quote.budget;
  $('#receipt-budget').textContent = over ? '超出预算 ¥' + (quote.total - quote.budget) : '预算余 ¥' + (quote.budget - quote.total);
  $('#receipt-budget').classList.toggle('over-budget', over);
  const signal = $('#deal-signal');
  signal.dataset.tone = status.tone;
  signal.innerHTML = `<strong>${status.icon}</strong><b>${status.title}</b><span>${status.text}</span>`;
  const confirm = $('#receipt-confirm');
  confirm.disabled = !lines.length || guest.awaitingRecommendation;
  confirm.textContent = guest.awaitingRecommendation ? '先选择是否推荐'
    : guest.haggleRound ? `再次报价 ¥${quote.total}` : `向顾客报价 ¥${quote.total}`;
  renderDialogue(guest, guest.regularId ? '熟客 · 买家' : '买家', [guest.storyLine, guest.line, guest.lastWords].filter(Boolean));
}

function adjustReceiptZoom(change) {
  receiptZoom = clamp(Math.round((receiptZoom + change) * 10) / 10, .8, 1.2);
  const receipt = $('.receipt');
  if (!receipt) return;
  receipt.style.setProperty('--receipt-scale', receiptZoom);
  $('#receipt-zoom-level').textContent = Math.round(receiptZoom * 100) + '%';
  $('#receipt-zoom-out').disabled = receiptZoom <= .8;
  $('#receipt-zoom-in').disabled = receiptZoom >= 1.2;
}

function toggleReceiptCollapsed() {
  receiptCollapsed = !receiptCollapsed;
  const receipt = $('.receipt');
  if (!receipt) return;
  receipt.classList.toggle('collapsed', receiptCollapsed);
  const button = $('#receipt-collapse');
  button.textContent = receiptCollapsed ? '展开' : '收起';
  button.setAttribute('aria-expanded', String(!receiptCollapsed));
}

function clearBuyerDraftResponse(guest) {
  guest.dealSignal = null;
}

function resetBuyerNegotiation(guest) {
  guest.haggleRound = 0;
  guest.counterOffer = null;
  guest.haggleResolved = false;
  guest.haggleOnCredit = false;
  guest.dealSignal = null;
  guest.lastWords = '';
  guest.awaitingRecommendation = false;
  guest.recommendationOffered = false;
}

function applyReceiptStrategy(strategy) {
  const guest = state.current;
  if (guest?.type !== 'buyer' || !guest.receipt.length) return;
  guest.priceStrategy = strategy;
  guest.discounted = strategy === 'friendly';
  clearBuyerDraftResponse(guest);
  for (const row of guest.receipt) {
    const stock = counterInventory().find(entry => entry.uid === row.uid);
    if (!stock) continue;
    const listed = counterPrice(stock);
    row.price = strategy === 'markup'
      ? Math.max(listed + 1, Math.round(listed * CONFIG.retail.priceStrategyMarkup))
      : listed;
  }
  renderVisitor(); save();
}

function editReceipt(uid, action) {
  const guest = state.current;
  if (guest?.type !== 'buyer' || state.settlement) return;
  const row = guest.receipt.find(entry => entry.uid === uid);
  const stock = counterInventory().find(entry => entry.uid === uid);
  if (action === 'add' && !guest.selfPick && stock && retailAvailable(stock) && !row) {
    if (guest.wantedItem && (!matchesBuyerRequest(guest, stock) || guest.receipt.length)) return;
    if (guest.wantedCategory && !matchesBuyerRequest(guest, stock)) return;
    const listed = counterPrice(stock);
    const price = guest.priceStrategy === 'markup'
      ? Math.max(listed + 1, Math.round(listed * CONFIG.retail.priceStrategyMarkup)) : listed;
    guest.receipt.push({ uid, price });
    resetBuyerNegotiation(guest);
  } else if (action === 'remove' && row) {
    guest.receipt = guest.receipt.filter(entry => entry !== row);
    resetBuyerNegotiation(guest);
  } else if (action === 'label' && row && stock && !stock.grilled) {
    row.upgraded = !row.upgraded;
    resetBuyerNegotiation(guest);
  }
  renderVisitor(); save();
}

function canRecommend(guest) {
  return !!guest.awaitingRecommendation && !guest.upsold;
}

function recommendStock(uid) {
  const guest = state.current;
  if (guest?.type !== 'buyer' || state.settlement || !canRecommend(guest)) return;
  const stock = counterInventory().find(entry => entry.uid === uid);
  if (!stock || !retailAvailable(stock) || guest.receipt.some(row => row.uid === uid)) return;
  const candidates = recommendationCandidates(guest);
  if (!candidates.some(entry => entry.uid === uid)) return;
  guest.receipt.push({ uid, price: counterPrice(stock) });
  guest.upsold = true;
  guest.awaitingRecommendation = false;
  guest.lastWords = '行，把' + itemById(stock.itemId).name + '也加上。';
  guest.dealSignal = { tone: 'good', icon: '+', title: '推荐成功', text: '加购商品已放入小票，准备一起收款。', ready: true };
  settleBuyerSale(!!guest.pendingCredit, true);
}

function skipRecommendation() {
  const guest = state.current;
  if (guest?.type !== 'buyer' || !guest.awaitingRecommendation) return;
  guest.awaitingRecommendation = false;
  guest.lastWords = '不用再加了，就这些，结账吧。';
  settleBuyerSale(!!guest.pendingCredit, true);
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
    guest.priceStrategy = 'custom';
    guest.discounted = false;
    row.price = price;
    clearBuyerDraftResponse(guest);
    updateReceipt(guest);
    save();
  }
}

function setReceiptPrice(uid, price, focusKey = '') {
  const guest = state.current;
  const row = guest?.receipt?.find(entry => entry.uid === uid);
  if (!row) return;
  guest.priceStrategy = 'custom';
  guest.discounted = false;
  row.price = clamp(Math.round(price), 0, CONFIG.retail.maxUnitPrice);
  clearBuyerDraftResponse(guest);
  renderVisitor();
  save();
  requestAnimationFrame(() => {
    const target = focusKey && $(`[data-price-action="${focusKey}-${uid}"]`);
    target?.focus({ preventScroll: true });
  });
}

function adjustReceiptPrice(uid, change) {
  const row = state.current?.receipt?.find(entry => entry.uid === uid);
  if (row) setReceiptPrice(uid, row.price + change, change < 0 ? 'minus' : 'plus');
}

function matchesBuyerRequest(guest, stock, upgraded = false) {
  if (guest.wantedItem) return stock.itemId === guest.wantedItem && (!guest.wantedCondition ||
    (upgraded ? betterLabel(stock) : stockCondition(stock)) === guest.wantedCondition);
  if (guest.wantedCategory) return shopCategory(itemById(stock.itemId)).id === guest.wantedCategory;
  return true;
}

function receiptObjection(guest, lines) {
  if (guest.wantedItem && (lines.length !== 1 || !matchesBuyerRequest(guest, lines[0].stock, lines[0].row.upgraded))) {
    return '我只要刚才点的那一件，能帮我改下小票吗？';
  }
  if (guest.wantedCategory && (!lines.length || lines.some(line => !matchesBuyerRequest(guest, line.stock, line.row.upgraded)))) {
    const category = SHOP_CATEGORIES.find(entry => entry.id === guest.wantedCategory);
    return '我今天只想买' + category.name + '，其他的先不要。';
  }
  return '';
}

function betterLabel(stock) {
  return FOOD_LIFE[stock.itemId] ? 'fresh' : 'mint';
}

function buyerResponds(guest, words, signal) {
  guest.lastWords = words;
  guest.dealSignal = signal;
  renderVisitor();
  save();
}

function recommendationCandidates(guest, quote = receiptQuote(guest)) {
  const remaining = Math.max(0, quote.budget - quote.total);
  const reserved = new Set(guest.receipt.map(row => row.uid));
  return uniqueStock(counterInventory().filter(stock => retailAvailable(stock) &&
    !reserved.has(stock.uid) && counterPrice(stock) <= remaining))
    .sort((a, b) => counterPrice(a) - counterPrice(b));
}

function maybeOfferRecommendation(guest, quote, onCredit) {
  if (guest.recommendationOffered || guest.upsold) return false;
  const candidates = recommendationCandidates(guest, quote);
  if (!candidates.length || Math.random() >= CONFIG.retail.recommendationChance) return false;
  guest.recommendationOffered = true;
  guest.awaitingRecommendation = true;
  guest.pendingCredit = onCredit;
  guest.categoryFilter = 'all';
  guest.counterOffer = null;
  guest.lastWords = `这个价可以。我还剩 ¥${quote.budget - quote.total}，有合适的可以再推荐一件。`;
  guest.dealSignal = { tone: 'good', icon: '+', title: '可以推荐加购', text: '顾客已经接受当前价格，可推荐一件预算内商品，也可直接收款。', ready: false };
  renderVisitor();
  save();
  return true;
}

function setReceiptTotal(guest, target) {
  const total = receiptTotal(guest);
  const prices = guest.receipt.map(row => row.price);
  let running = 0;
  let allocated = 0;
  guest.receipt.forEach((row, index) => {
    running += prices[index];
    const share = index === guest.receipt.length - 1 ? target : Math.round(target * running / total);
    row.price = Math.max(0, share - allocated);
    allocated = share;
  });
  guest.priceStrategy = 'custom';
  guest.discounted = false;
}

function acceptBuyerCounterOffer() {
  const guest = state.current;
  if (guest?.type !== 'buyer' || !Number.isInteger(guest.counterOffer)) return;
  const offer = guest.counterOffer;
  setReceiptTotal(guest, offer);
  guest.haggleResolved = true;
  guest.counterOffer = null;
  guest.lastWords = `好，¥${offer}，成交。`;
  settleBuyerSale(!!guest.haggleOnCredit, true);
}

function continueBuyerHaggle(guest, quote, listedTotal, onCredit) {
  if (guest.haggleRound >= guest.maxHaggleRounds) {
    const rounds = guest.maxHaggleRounds;
    notifyPlayer(`${guest.name}：已经谈了 ${rounds} 轮，还是算了，我不买了。`, true);
    addLog(`${guest.name} 讨价 ${rounds} 轮后离开。`);
    finishVisit();
    return;
  }
  const target = Math.max(1, Math.min(quote.budget, Math.round(listedTotal * guest.bargainTarget)));
  let offer = guest.counterOffer == null ? target : guest.counterOffer;
  if (guest.counterOffer != null && quote.total > offer) {
    const roundsLeft = Math.max(1, guest.maxHaggleRounds - guest.haggleRound);
    offer = Math.min(quote.total - 1, offer + Math.max(1, Math.ceil((quote.total - offer) / (roundsLeft + 1))));
  }
  guest.haggleRound++;
  guest.counterOffer = Math.max(0, offer);
  guest.haggleOnCredit = onCredit;
  buyerResponds(guest,
    `¥${quote.total} 还是贵了。¥${guest.counterOffer} 行不行？`,
    { tone: 'risk', icon: '↔', title: guest.name + '正在还价', text: `顾客还价 ¥${guest.counterOffer}；可以接受、改价，或坚持当前报价。`, ready: false });
}

function settleBuyerSale(onCredit = false, forceAccept = false) {
  const guest = state.current;
  if (guest?.finishedTrade || guest?.encounter === 'help' ||
      guest?.encounter === 'theft' && state.theftKnown && !guest.allowedIn) return;
  if (guest?.type !== 'buyer' || state.settlement || !guest.receipt.length) return;
  prepareBuyerState(guest);
  if (guest.awaitingRecommendation && !forceAccept) return;
  if (onCredit && (!guest.creditAsk || !serviceAvailable('ledger'))) return;
  const quote = receiptQuote(guest);
  const lines = allocateReceipt(receiptLines(guest), quote);
  if (lines.length !== guest.receipt.length || lines.some(({ stock }) => !retailAvailable(stock))) return notifyPlayer('小票里的库存有变动，请重新选货。');
  const { total } = quote;
  if (onCredit && total === 0) return notifyPlayer('小票合计为零，可以直接结账。');
  const mismatch = receiptObjection(guest, lines);
  if (mismatch) return buyerResponds(guest, mismatch,
    { tone: 'risk', icon: '!', title: '顾客拒绝这张小票', text: mismatch, ready: false });
  if (total > quote.budget) {
    const words = `要 ¥${total}？我只有 ¥${quote.budget}，这个价格买不了。`;
    return buyerResponds(guest, words,
      { tone: 'risk', icon: '!', title: '报价超过预算', text: `需要再降 ¥${total - quote.budget}，或移除商品。`, ready: false });
  }
  const overpriced = lines.find(({ stock, revenue }) => revenue > acceptablePrice(stock));
  if (overpriced) {
    const words = overpriced.item.name + '这个价太高了，我不能按这个价买。';
    return buyerResponds(guest, words,
      { tone: 'risk', icon: '!', title: '单品报价被拒绝', text: overpriced.item.name + '需要降价后重新报价。', ready: false });
  }
  const listedTotal = lines.reduce((sum, { stock }) => sum + counterPrice(stock), 0);
  const bargainTarget = Math.max(1, Math.min(quote.budget, Math.round(listedTotal * guest.bargainTarget)));
  if (!forceAccept && guest.counterOffer != null && total <= guest.counterOffer) guest.haggleResolved = true;
  if (!forceAccept && guest.willHaggle && !guest.haggleResolved && total > bargainTarget) {
    return continueBuyerHaggle(guest, quote, listedTotal, onCredit);
  }
  guest.haggleResolved = true;
  guest.counterOffer = null;
  guest.lastWords = quote.roundOff ? `就按 ¥${total}，谢谢你帮我抹零。` : `行，¥${total}，成交。`;
  guest.dealSignal = { tone: 'good', icon: '✓', title: '顾客接受报价', text: `顾客同意按 ¥${total} 购买。`, ready: true };
  if (maybeOfferRecommendation(guest, quote, onCredit)) return;
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
  const totalCost = lines.reduce((sum, { stock }) => sum + stock.cost, 0);
  state.shelf = state.shelf.filter(stock => !sold.has(stock.uid));
  state.grill.slots = state.grill.slots.filter(stock => !sold.has(stock.uid));
  state.grill.tray = (state.grill.tray || []).filter(stock => !sold.has(stock.uid));
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
    if (!onCredit) {
      playRegisterSound();
      showCashFeedback(total, total - totalCost);
    }
    notifyPlayer(guest.name + (quote.roundOff ? '：谢谢你帮我抹零！' : '：谢谢你给我打折！'));
    return;
  }
  finishVisit();
  if (!onCredit) {
    playRegisterSound();
    showCashFeedback(total, total - totalCost);
    notifyPlayer(`${guest.name}：成交，谢谢！实付 ¥${total}。`);
  }
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
  return [...state.shelf, ...state.grill.slots, ...(state.grill.tray || [])];
}

function grillStage(stock) {
  if (stock.trayStage) return GRILL.stages.find(stage => stage.key === stock.trayStage);
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

function moveToTray(uid) {
  if (state.settlement) return;
  const tray = state.grill.tray ||= [];
  const stock = state.grill.slots.find(entry => entry.uid === uid);
  if (!stock || tray.length >= GRILL.trayCapacity) return;
  const stage = grillStage(stock).key;
  if (stage !== 'cooked' && stage !== 'bloom') return;
  state.grill.slots = state.grill.slots.filter(entry => entry !== stock);
  tray.push({ ...stock, trayStage: stage, trayDay: state.day });
  renderAll(); save();
}

function discardGrillFood(uid) {
  if (state.settlement) return;
  const stock = counterInventory().find(entry => entry.grilled && entry.uid === uid);
  if (!stock) return;
  state.grill.tray = (state.grill.tray || []).filter(entry => entry !== stock);
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
  advanceDelivery(true);
  const strat = STRATEGIES[state.strategy];
  const cashBeforeClosing = state.money;
  const autoList = [];
  const others = [];
  let complaintCount = state.pendingComplaints;

  // 1) 收摊自动售卖
  const remain = [];
  for (const s of state.shelf) {
    if (!state.devForceEvent && retailAvailable(s) && Math.random() < strat.autoRate) {
      const price = Math.max(1, Math.round(stockValue(s) * strat.autoMult * calendarPrice(itemById(s.itemId))));
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
    const repayChance = 1 - (1 - CONFIG.creditRepayChance) * (reg?.risk ?? 1);
    const forcedRepay = DEV_MODE && state.devForceEvent === 'credit-repay';
    const forcedDefault = DEV_MODE && state.devForceEvent === 'credit-default';
    if (forcedRepay || (!forcedDefault && Math.random() < repayChance)) {
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
    const forcedRedeem = DEV_MODE && state.devForceEvent === 'sticker-redeem';
    const forcedComplaint = DEV_MODE && state.devForceEvent === 'sticker-complaint';
    if (forcedRedeem || (!forcedComplaint && st.rare > 0 && Math.random() < st.rare * STICKER.redeemChancePerRare)) {
      state.money -= STICKER.redeemPay;
      changeReputation(STICKER.redeemRep);
      st.rare--; st.grumble = 0; st.badge = true; state.specialCards.jinlong = true;
      others.push({ label: '🏆 有孩子集满贴纸！兑付 ¥100，赢得「良心小卖部」名声', amount: -STICKER.redeemPay });
      addLog('有孩子集满了贴纸！你含泪兑付 ¥100，街坊都夸你是良心小卖部。');
    } else if (forcedComplaint || st.grumble >= STICKER.grumbleLimit) {
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
  if (state.grill.tray?.length) {
    addLog('存货盘剩下的热食隔夜变质，已清理。');
    state.grill.tray = [];
  }
  if (state.grill.slots.length) {
    addLog('收摊关机，清掉烤肠机上剩下的热食。');
    state.grill.slots = [];
  }
  state.settlement = {
    dayList: state.daySales, dayTotal, autoList, autoTotal, others, otherTotal,
    daytimeSpend: dayTotal + state.openingMoney - cashBeforeClosing,
    net: state.money - state.openingMoney,
  };
  delete state.devForceEvent;
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
  pruneShelfLayout();
  renderTop();
  renderNeighborhood();
  renderGuide();
  renderTutorials();
  renderVisitor();
  renderWindow();
  renderTabs();
  renderLog();
  scheduleGuideArrow();
}

function openingArrow() {
  if (!state.guide || state.day !== 1) return null;
  if (state.shelf.length && !state.shelf.some(retailAvailable) && !state.daySales.length) {
    return { target: '#shelf-pending .shelf-piece', via: '#open-shelf-grid', hint: '拖到上方空格上架' };
  }
  if (!state.shopOpen) {
    if (state.shelf.length) return { target: '#btn-openday', hint: '备好货了，点这里开店' };
    return { target: '[data-order="wh-noodles"]:enabled', via: '#open-wholesale', hint: '先进一批干脆面' };
  }
  const guest = state.current;
  if (!guest) return { target: '#btn-endday', hint: '顾客接待完了，点这里收摊' };
  if (state.daySales.length || guest.type !== 'buyer') return null;
  if (!state.shelf.length) return { target: '[data-order="wh-noodles"]:enabled', via: '#open-wholesale', hint: '先进一批干脆面' };
  if (!guest.receipt.length) return { target: '#action-area .buyer-options button', hint: '点商品加入小票' };
  return { target: '#receipt-confirm', hint: '核对小票后结账' };
}

function findGuideTarget() {
  if (!state.started || state.settlement || $('dialog[open]')) return null;
  const visible = selector => {
    const element = selector && $(selector);
    return element?.getClientRects().length ? element : null;
  };
  const steps = [];
  const opening = openingArrow();
  if (opening) steps.push(opening);
  for (const lesson of TUTORIALS) {
    const rule = TUTORIAL_ARROWS[lesson.id];
    if (!rule || !serviceAvailable(lesson.unlock) || state.guidedLessons.includes(lesson.id)) continue;
    if (tradeOpen && !['clearance', 'receiving', 'premium'].includes(lesson.id)) continue;
    if (lesson.id === 'premium' && !(state.current?.type === 'seller' && state.current.ask > CONFIG.standardTradeMax)) continue;
    steps.push({ ...rule, lesson: lesson.id });
  }
  for (const step of steps) {
    const target = visible(step.target);
    if (target) return { element: target, key: step.target, hint: step.hint, lesson: step.lesson };
    const entrance = visible(step.via);
    if (entrance) return { element: entrance, key: step.via, hint: step.hint };
  }
  return null;
}

function renderGuideArrow() {
  guideFrame = null;
  const arrow = $('#guide-arrow');
  const target = findGuideTarget();
  guideTarget?.element.classList.remove('guided-target');
  guideTarget = target;
  if (!target) {
    guideKey = '';
    arrow.classList.add('hidden');
    return;
  }
  const { element, key, hint } = target;
  let bounds = element.getBoundingClientRect();
  if (key !== guideKey && (bounds.top < 0 || bounds.bottom > window.innerHeight)) {
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    bounds = element.getBoundingClientRect();
  }
  guideKey = key;
  const onScreen = bounds.bottom > 0 && bounds.top < window.innerHeight;
  arrow.classList.toggle('hidden', !onScreen);
  if (!onScreen) return;
  const below = bounds.top < 72;
  arrow.dataset.side = below ? 'below' : 'above';
  arrow.style.left = clamp(bounds.left + bounds.width / 2, 70, window.innerWidth - 70) + 'px';
  arrow.style.top = (below ? bounds.bottom : bounds.top) + 'px';
  arrow.firstElementChild.textContent = hint;
  element.classList.add('guided-target');
}

function scheduleGuideArrow() {
  if (guideFrame == null) guideFrame = requestAnimationFrame(renderGuideArrow);
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
  if (!openTab && !state.guidedLessons.includes(id)) state.guidedLessons.push(id);
  save();
  renderTutorials();
  if (openTab && lesson.tab) openManagement(lesson.tab);
  scheduleGuideArrow();
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
  else if (guest && guest.type === 'buyer') text = '顾客会自动走到柜台。按他的需求准备商品并开小票。';
  else if (!hasOrdered && (state.shelf.length || !guest) && state.money >= WHOLESALE[0].cost * WHOLESALE[0].pack) {
    text = '试试从供货商补货。点窗台的「进货」，订一批干脆面。';
  } else if (guest) text = '顾客已经到柜台，看看他带来了什么。';
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
  $('#title-screen').close();
  if (!state.shopName) {
    const input = $('#shop-name');
    input.maxLength = SHOP_SIGN.maxLength;
    input.value = SHOP_SIGN.defaultName;
    $('#shop-name-dialog').showModal();
    return;
  }
  state.started = true;
  renderAll();
  save();
  if (firstOpening || !state.neighborSeen.mentor) showNewNeighbor();
}

function itemArtwork(id) {
  const shelfExtra = EXTRA_GOODS.findIndex(item => item.id === id);
  if (shelfExtra >= 0) return `<span class="item-art item-extra" style="--item-x:${shelfExtra % 3 * 50}%;--item-y:${Math.floor(shelfExtra / 3) * 100}%" aria-hidden="true"></span>`;
  const extra = NEW_GOODS.findIndex(item => item.id === id);
  if (extra >= 0) return `<span class="item-art item-new" style="--item-x:${extra % 6 * 20}%;--item-y:${Math.floor(extra / 6) * 50}%" aria-hidden="true"></span>`;
  const art = ITEM_ART[id];
  if (id === 'youxiji') return '<span class="item-art item-art-handheld" aria-hidden="true"></span>';
  if (!art) return itemById(id)?.emoji || '';
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
  const street = $('.street');
  const call = $('#guest-call');
  street.classList.toggle('has-customer', !!guest);
  call.classList.toggle('hidden', !guest);
  const trading = !!guest && tradeOpen;
  $('#counter').classList.toggle('hidden', !trading);
  $('#counter').classList.toggle('seller-stage', guest?.type === 'seller');
  $('#trade-dialogue').classList.toggle('hidden', !trading);
  call.setAttribute('aria-expanded', String(trading));
  call.setAttribute('aria-label', guest ? guest.name + '，回到交易区' : '');
  $('#guest-label').textContent = guest
    ? guest.name + (guest.type === 'seller' ? ' · 来卖货' : ' · 来买货')
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

function playCustomerArrival() {
  const call = $('#guest-call');
  const dialogue = $('#trade-dialogue');
  for (const element of [call, dialogue]) element.classList.remove('customer-arriving');
  void call.offsetWidth;
  for (const element of [call, dialogue]) element.classList.add('customer-arriving');
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
    const count = item ? state.shelf.filter(stock => stock.itemId === id && retailAvailable(stock)).length : 0;
    return `<button type="button" id="display-slot-${index}" class="display-slot" aria-haspopup="dialog"
      onclick="openDisplaySlot(${index})" aria-label="第 ${index + 1} 格，${item ? item.name : '空位'}"
      title="${item ? item.name + '，库存 ' + count : '摆放商品'}">${item
        ? itemArtwork(id) + `<small class="display-stock-badge" aria-hidden="true">${count}</small><span class="display-item-name">${item.name}</span>`
        : '<span class="display-empty-slot" aria-hidden="true">+</span><span class="display-item-name">布置</span>'}</button>`;
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
  $('#shop-sign').textContent = state.shopName || SHOP_SIGN.defaultName;
  $('#stat-day').textContent = `第 ${state.day} 天`;
  const event = calendarEvent();
  $('#open-calendar').textContent = event ? '日历 · ' + event.name : '日历';
  $('#stat-money').textContent = `💰 ¥${state.money}`;
  $('#stat-rep').textContent = `口碑 ${state.rep}`;
  $('#stat-rep').title = '口碑进度 ' + state.repVisits + ' / ' + CONFIG.reputation.visitsPerPoint;
  $('#stat-goal').textContent = state.won ? '🎯 已盘下店面！' : `🎯 盘下店面 ¥${state.money} / ¥${CONFIG.goalMoney}`;
  $('#win-banner').classList.toggle('hidden', !(state.won && !state.winSeen));
  $('#open-dev').classList.toggle('hidden', !DEV_MODE);
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
  if (c.finishedTrade || c.encounter === 'help' || c.encounter === 'theft' && state.theftKnown && !c.allowedIn) return renderCustomerEvent(c, area, act);
  return renderBuyer(c, area, act);
}

function customerPortrait(guest) {
  const identity = guest.portraitName || guest.name;
  const calendarIndex = CALENDAR_PORTRAITS.indexOf(guest.customerId || guest.id);
  if (calendarIndex >= 0) return { key: 'calendar', position: (calendarIndex % 2 * 100) + '% ' + (Math.floor(calendarIndex / 2) * 100) + '%' };
  const schoolIndex = SCHOOL_PORTRAITS.indexOf(guest.customerId || guest.id);
  if (schoolIndex >= 0) return { key: 'school', position: (schoolIndex % 4 * 100 / 3) + '% ' + (schoolIndex < 4 ? '0%' : '100%') };
  const index = guest.customerId ? CUSTOMER_PORTRAITS.indexOf(guest.customerId) : -1;
  if (index >= 0) return { key: 'new', position: (index % 4 * 100 / 3) + '% ' + (Math.floor(index / 4) * 50) + '%' };
  const portrait = identity === '快递小哥' ? 'courier' : PORTRAITS[identity];
  return { key: portrait ?? 'fallback', position: '', avatar: portrait == null ? guest.avatar : '' };
}

function renderDialogue(guest, role, lines) {
  const frame = $('#portrait-frame');
  const portrait = customerPortrait(guest);
  frame.dataset.portrait = portrait.key;
  frame.style.backgroundPosition = portrait.position;
  frame.textContent = portrait.avatar || '';
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
  renderDialogue(c, c.regularId ? '熟客 · 卖家' : '卖家', [c.storyLine, ...(c.lastWords ? [c.lastWords] : [c.line, pickCachedPitch(c)])].filter(Boolean));
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
  prepareBuyerState(guest);
  if (!guest.priceStrategy) guest.priceStrategy = 'listed';
  const lines = receiptLines(guest);
  const reserved = new Set(guest.receipt.map(row => row.uid));
  const availableAll = guest.awaitingRecommendation ? recommendationCandidates(guest)
    : uniqueStock(counterInventory().filter(stock => retailAvailable(stock) && !reserved.has(stock.uid) &&
      (!guest.wantedItem || (!guest.receipt.length && matchesBuyerRequest(guest, stock))) &&
      (!guest.wantedCategory || matchesBuyerRequest(guest, stock))));
  const category = SHOP_CATEGORIES.find(entry => entry.id === guest.categoryFilter);
  const available = category ? availableAll.filter(stock => shopCategory(itemById(stock.itemId)).id === category.id) : availableAll;
  const clearance = available.filter(stock => serviceAvailable('clearance') && stockCondition(stock) === 'near');
  const grilled = available.filter(stock => stock.grilled);
  const regular = available.filter(stock => !stock.grilled && !clearance.includes(stock));
  const request = guest.wantedItem ? `指定商品：${itemById(guest.wantedItem).name}`
    : guest.wantedCategory ? `指定类别：${SHOP_CATEGORIES.find(entry => entry.id === guest.wantedCategory).name}`
    : guest.selfPick ? '顾客已经选好商品' : '自由配货';
  const canChoose = guest.awaitingRecommendation || (!guest.selfPick && !(guest.wantedItem && guest.receipt.length));
  act.innerHTML = `<div class="checkout">
    <div class="checkout-stock">
      <div class="buyer-request-summary"><strong>${request}</strong><span>预算 ¥${guest.cap}</span></div>
      ${canChoose && !guest.wantedItem ? renderCategoryFilter(availableAll, guest) : ''}
      ${guest.awaitingRecommendation
        ? renderBuyerOptions(`推荐加购 · 最多再花 ¥${receiptQuote(guest).budget - receiptQuote(guest).total}`, available, guest)
          + '<button type="button" class="btn small" onclick="skipRecommendation()">不推荐，按当前小票收款</button>'
        : guest.wantedItem && guest.receipt.length || guest.selfPick ? ''
        : renderBuyerOptions('货架', regular, guest) +
          (clearance.length ? renderBuyerOptions('临期促销区', clearance, guest, 'clearance') : '') +
          (grilled.length ? renderBuyerOptions('现烤热食', grilled, guest) : '')}
      <button type="button" class="btn small" onclick="buyerRefuse()">结束接待</button>
    </div>
    <form class="receipt${receiptCollapsed ? ' collapsed' : ''}" style="--receipt-scale:${receiptZoom}" onsubmit="event.preventDefault(); settleBuyerSale()">
      <header class="receipt-header">
        <div><strong>购物小票</strong><small>第 ${state.day} 天 · ${guest.selfPick ? '顾客自选' : '店主配货'}</small></div>
        <div class="receipt-window-controls" aria-label="小票显示大小">
          <button id="receipt-zoom-out" type="button" onclick="adjustReceiptZoom(-.1)" aria-label="缩小小票" ${receiptZoom <= .8 ? 'disabled' : ''}>−</button>
          <span id="receipt-zoom-level">${Math.round(receiptZoom * 100)}%</span>
          <button id="receipt-zoom-in" type="button" onclick="adjustReceiptZoom(.1)" aria-label="放大小票" ${receiptZoom >= 1.2 ? 'disabled' : ''}>＋</button>
          <button id="receipt-collapse" type="button" aria-expanded="${!receiptCollapsed}" onclick="toggleReceiptCollapsed()">${receiptCollapsed ? '展开' : '收起'}</button>
        </div>
      </header>
      ${lines.map(renderReceiptLine).join('') || '<p class="receipt-empty">小票里没有商品</p>'}
      ${lines.length ? `<section class="deal-strategy" aria-label="成交策略">
        <span>这单怎么谈？</span>
        <div class="deal-options">
          <button type="button" aria-pressed="${guest.priceStrategy === 'friendly'}" onclick="applyReceiptStrategy('friendly')">爽快让利<small>整单九折 · 涨好感</small></button>
          <button type="button" aria-pressed="${guest.priceStrategy === 'listed'}" onclick="applyReceiptStrategy('listed')">照标价卖<small>稳妥成交</small></button>
          <button type="button" aria-pressed="${guest.priceStrategy === 'markup'}" onclick="applyReceiptStrategy('markup')">试着加价<small>约加一成 · 多利润</small></button>
        </div>
        <div id="deal-signal" class="deal-signal" aria-live="polite"></div>
      </section>` : '<div id="deal-signal" class="deal-signal" aria-live="polite"></div>'}
      <div class="receipt-totals"><span>合计</span><strong id="receipt-total"></strong>
        <small id="receipt-savings"></small><small id="receipt-budget"></small></div>
      ${lines.length ? `<details class="receipt-advanced">
        <summary>高级调价 · 逐件修改</summary>
        ${lines.map(renderReceiptEditor).join('')}
      </details>` : ''}
      <div class="trade-actions receipt-confirm-row">
        <button id="receipt-confirm" class="btn gold" disabled>先调整价格</button>
        ${guest.counterOffer != null && !guest.awaitingRecommendation ? `<button class="btn" type="button" onclick="acceptBuyerCounterOffer()">接受还价 ¥${guest.counterOffer}</button>` : ''}
        ${guest.creditAsk && lines.length ? '<button class="btn" type="submit" formaction="#" onclick="event.preventDefault(); if (this.form.reportValidity()) settleBuyerSale(true)">记赊账</button>' : ''}
      </div>
    </form>
  </div>`;
  updateReceipt(guest);
}

function setBuyerCategoryFilter(id) {
  const guest = state.current;
  if (guest?.type !== 'buyer' || !['all', ...SHOP_CATEGORIES.map(category => category.id)].includes(id)) return;
  guest.categoryFilter = id;
  renderVisitor();
  save();
  requestAnimationFrame(() => $(`[data-buyer-category="${id}"]`)?.focus({ preventScroll: true }));
}

function renderCategoryFilter(stocks, guest) {
  const counts = Object.fromEntries(SHOP_CATEGORIES.map(category => [category.id,
    stocks.filter(stock => shopCategory(itemById(stock.itemId)).id === category.id).length]));
  const buttons = [{ id: 'all', name: '全部', count: stocks.length },
    ...SHOP_CATEGORIES.map(category => ({ ...category, count: counts[category.id] }))]
    .filter(category => category.id === 'all' || category.count)
    .map(category => `<button type="button" data-buyer-category="${category.id}"
      aria-pressed="${guest.categoryFilter === category.id}" onclick="setBuyerCategoryFilter('${category.id}')">${category.name}<small>${category.count}</small></button>`).join('');
  return `<nav class="buyer-category-filter" aria-label="按商品类别筛选">${buttons}</nav>`;
}

function renderBuyerOptions(title, stocks, guest, guide = '') {
  const action = guest.awaitingRecommendation ? '推荐' : '添加';
  const tiles = stocks.map(stock => {
    const product = itemById(stock.itemId);
    const wanted = stock.itemId === guest.wantedItem;
    const category = shopCategory(product);
    const handler = guest.awaitingRecommendation ? `recommendStock(${stock.uid})` : `editReceipt(${stock.uid},'add')`;
    return `<button type="button" class="stock-tile" onclick="${handler}" aria-label="${action}${product.name}，${(stock.grilled ? grillStage(stock) : CONDITION[stockCondition(stock)]).name}，¥${counterPrice(stock)}">
      ${itemArtwork(product.id)}<span>${product.name}${wanted ? ' · 点名' : ''}</span>
      <small class="stock-category">${category.name}</small>${conditionBadge(stock)}<small class="stock-price">+ ¥${counterPrice(stock)}</small></button>`;
  }).join('');
  return `<section class="checkout-options" data-guide="${guide}"><h3>${title}</h3>${tiles ? '<div class="buyer-options">' + tiles + '</div>' : '<p>暂无可添加的商品</p>'}</section>`;
}

function renderReceiptLine({ row, stock, item }) {
  const canRelabel = !stock.grilled && (stock.variant === 'fake' || stockCondition(stock) !== betterLabel(stock));
  const label = stock.grilled ? grillStage(stock).name : CONDITION[row.upgraded ? betterLabel(stock) : stockCondition(stock)].name;
  return `<div class="receipt-line receipt-summary-line">
    <div><strong>${item.name}</strong><small>${shopCategory(item).name} · ${label}${row.upgraded ? ' · 已改签' : ''}</small></div>
    <strong class="receipt-unit-price">¥${row.price}</strong>
    <button type="button" class="receipt-remove" onclick="editReceipt(${row.uid},'remove')" aria-label="移除${item.name}">×</button>
    ${canRelabel ? `<button type="button" class="receipt-label" onclick="editReceipt(${row.uid},'label')">${row.upgraded ? '恢复原签' : '悄悄改成' + CONDITION[betterLabel(stock)].name}</button>` : ''}
  </div>`;
}

function renderReceiptEditor({ row, stock, item }) {
  const listed = counterPrice(stock);
  const presets = [
    ['让利档', Math.max(0, Math.min(listed - 1, Math.round(listed * CONFIG.retail.receiptDiscount))), 'discount'],
    ['按标价', listed, 'listed'],
    ['加价档', Math.max(listed + 1, Math.round(listed * CONFIG.retail.priceStrategyMarkup)), 'markup'],
  ].filter((entry, index, all) => all.findIndex(other => other[1] === entry[1]) === index)
    .map(([text, price, key]) => `<button type="button" data-price-action="${key}-${row.uid}"
      aria-pressed="${row.price === price}" onclick="setReceiptPrice(${row.uid},${price},'${key}')">${text}<small>¥${price}</small></button>`).join('');
  return `<div class="receipt-editor-row">
    <strong>${item.name}</strong>
    <div class="receipt-price-editor">
      <div class="price-stepper">
        <button type="button" data-price-action="minus-${row.uid}" onclick="adjustReceiptPrice(${row.uid},-1)" aria-label="${item.name}减一元">−</button>
        <label><span>单价</span><b>¥</b><input type="number" min="0" max="${CONFIG.retail.maxUnitPrice}" step="1" required
          inputmode="numeric" value="${row.price}" aria-label="${item.name}单价" oninput="editReceiptPrice(${row.uid},this)"></label>
        <button type="button" data-price-action="plus-${row.uid}" onclick="adjustReceiptPrice(${row.uid},1)" aria-label="${item.name}加一元">＋</button>
      </div>
      <div class="price-presets" aria-label="${item.name}快捷定价">${presets}</div>
    </div>
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
  else if (currentTab === 'customers') page.innerHTML = tabCustomers();
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
      <div class="mut">进价 ¥${cost} / 件 · 今日参考零售价 ¥${Math.max(1, Math.round(product.value * calendarPrice(product)))} / 件${change}</div>
      <button class="btn small gold display-toggle" data-order="${product.id}" onclick="orderWholesale('${product.id}')" ${disabled ? 'disabled' : ''}>${label}</button>
    </div>`;
  }).join('');
  const equipment = !serviceAvailable('grill') ? '' : state.grill.owned
    ? GRILL.foods.map(food => `<div class="card">
      <b>${food.name}</b> · 每批 ${food.pack} 串 · 冷冻库存 ${state.grill.supplies[food.id] || 0}
      <button class="btn small gold" onclick="orderGrillFood('${food.id}')" ${state.settlement || state.wholesaleOrders.includes(food.id) ? 'disabled' : ''}>进货 ¥${food.cost * food.pack}</button></div>`).join('')
    : `<div class="card"><b>烤肠机</b> · ${GRILL.capacity} 个烤位
      <button id="buy-grill" class="btn gold" onclick="buyGrill()" ${state.settlement ? 'disabled' : ''}>购置 ¥${GRILL.cost}</button></div>`;
  return '<p class="mut">每种商品每天限订一批，立即到货。</p>' + products + equipment;
}

function shelfGroups(stocks) {
  const groups = new Map();
  for (const stock of stocks) {
    const footprint = itemById(stock.itemId).footprint;
    // 批发商品按原批次、成本与真伪叠放，鉴定旧货独立占位。
    const key = stock.wholesale && footprint.w * footprint.h <= SHELF_GRID.stackMaxCells
      ? [stock.itemId, stock.stockedDay, stock.cost, stock.value, stock.variant, stock.condition, !!stock.relabelled].join('/')
      : stock.uid;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(stock.uid);
  }
  return [...groups.values()];
}

function shelfSize(itemId, rotation) {
  const { w, h } = itemById(itemId).footprint;
  return rotation === 90 ? { w: h, h: w } : { w, h };
}

function canPlaceShelf(layout, placement, ignore = null) {
  const { col, row } = placement;
  const { w, h } = shelfSize(placement.itemId, placement.rotation);
  if (col < 0 || row < 0 || col + w > SHELF_GRID.columns || row + h > layout.rows) return false;
  return !layout.placements.some(other => {
    if (other === ignore) return false;
    const size = shelfSize(other.itemId, other.rotation);
    return col < other.col + size.w && col + w > other.col &&
      row < other.row + size.h && row + h > other.row;
  });
}

function migrateShelfLayout(stock) {
  const layout = { version: 1, rows: SHELF_GRID.rows, placements: [] };
  const byUid = new Map(stock.map(entry => [entry.uid, entry]));
  for (const uids of shelfGroups(stock.filter(entry => entry.displayed !== false))) {
    const itemId = byUid.get(uids[0]).itemId;
    for (let index = 0; index < layout.rows * SHELF_GRID.columns; index++) {
      const slot = { itemId, uids, col: index % SHELF_GRID.columns, row: Math.floor(index / SHELF_GRID.columns), rotation: 0 };
      if (!canPlaceShelf(layout, slot)) continue;
      layout.placements.push(slot);
      break;
    }
  }
  return layout;
}

function pruneShelfLayout() {
  const live = new Set(state.shelf.map(stock => stock.uid));
  const placements = state.shelfLayout.placements;
  for (const slot of placements) slot.uids = slot.uids.filter(uid => live.has(uid));
  state.shelfLayout.placements = placements.filter(slot => slot.uids.length);
}

function shelfTile(uids, slot) {
  const stock = state.shelf.find(entry => entry.uid === uids[0]);
  const item = itemById(stock.itemId);
  const { w, h } = shelfSize(item.id, slot?.rotation);
  const position = slot ? `grid-column:${slot.col + 1}/span ${w};grid-row:${slot.row + 1}/span ${h}` : '';
  return `<button type="button" class="shelf-piece" data-stock="${uids.join(',')}" data-rotation="${slot?.rotation || 0}"
      style="${position}" aria-label="${item.name} ×${uids.length}，查看或拖动" title="${item.name} · ${CONDITION[stockCondition(stock)].name}">
      ${itemArtwork(item.id)}<span>${item.name}</span>${uids.length > 1 ? '<b>×' + uids.length + '</b>' : ''}
    </button>`;
}

function tabShelf() {
  const layout = state.shelfLayout;
  const occupied = new Set(layout.placements.flatMap(slot => slot.uids));
  const pending = shelfGroups(state.shelf.filter(stock => !occupied.has(stock.uid)));
  const used = layout.placements.reduce((sum, slot) => {
    const { w, h } = shelfSize(slot.itemId, slot.rotation);
    return sum + w * h;
  }, 0);
  const strategies = Object.entries(STRATEGIES).map(([key, rule]) =>
    `<button class="btn small" aria-pressed="${state.strategy === key}" onclick="setStrategy('${key}')">${rule.name}</button>`).join('');
  return `<div class="shelf-heading"><b>货架 · ${SHELF_GRID.columns} × ${layout.rows}</b>
    <small>已占 ${used} / ${SHELF_GRID.columns * layout.rows} 格</small>
    <button type="button" class="btn small" id="rotate-shelf" disabled>旋转 90°</button></div>
    <div class="shelf-scroll"><div id="shelf-grid" style="--cols:${SHELF_GRID.columns};--rows:${layout.rows}">
      ${layout.placements.map(slot => shelfTile(slot.uids, slot)).join('')}
      <div id="shelf-preview" class="hidden" aria-hidden="true"></div>
    </div></div>
    <div id="shelf-pending"><b>待上架区</b><div class="shelf-pending-items">
      ${pending.map(uids => shelfTile(uids)).join('') || '<small>拖到这里下架</small>'}
    </div></div>
    <details class="shelf-strategy"><summary>定价策略</summary><div class="trade-actions">${strategies}</div></details>
    ${renderMilestones()}`;
}

function beginShelfDrag(event) {
  const tile = event.target.closest('.shelf-piece');
  if (!tile || shelfDrag || event.button !== 0) return;
  const uids = tile.dataset.stock.split(',').map(Number);
  const original = state.shelfLayout.placements.find(slot => slot.uids.includes(uids[0]));
  const itemId = state.shelf.find(stock => stock.uid === uids[0]).itemId;
  const bounds = tile.getBoundingClientRect();
  shelfDrag = {
    pointer: event.pointerId, tile, uids, itemId, original, rotation: Number(tile.dataset.rotation),
    startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
    grabX: (event.clientX - bounds.left) / bounds.width, grabY: (event.clientY - bounds.top) / bounds.height,
  };
  tile.setPointerCapture(event.pointerId);
}

function moveShelfDrag(event) {
  const drag = shelfDrag;
  if (!drag || drag.pointer !== event.pointerId) return;
  drag.x = event.clientX;
  drag.y = event.clientY;
  if (!drag.ghost && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
  if (!drag.ghost) {
    drag.ghost = drag.tile.cloneNode(true);
    drag.ghost.classList.add('shelf-ghost');
    drag.ghost.setAttribute('aria-hidden', 'true');
    drag.ghost.tabIndex = -1;
    document.body.append(drag.ghost);
    drag.tile.classList.add('shelf-dragging');
    $('#rotate-shelf').disabled = false;
    $('#rotate-shelf').classList.add('rotate-during-drag');
    drag.scrollFrame = requestAnimationFrame(scrollShelfDrag);
  }
  previewShelfDrag();
}

function previewShelfDrag() {
  const drag = shelfDrag;
  if (!drag?.ghost || !$('#shelf-grid')) return;
  const grid = $('#shelf-grid');
  const bounds = grid.getBoundingClientRect();
  const size = bounds.width / SHELF_GRID.columns;
  const { w, h } = shelfSize(drag.itemId, drag.rotation);
  const left = drag.x - drag.grabX * w * size;
  const top = drag.y - drag.grabY * h * size;
  Object.assign(drag.ghost.style, { left: left + 'px', top: top + 'px', width: w * size + 'px', height: h * size + 'px' });
  drag.ghost.dataset.rotation = drag.rotation;
  const col = Math.round((left - bounds.left) / size);
  const row = Math.round((top - bounds.top) / size);
  const under = document.elementFromPoint(drag.x, drag.y);
  drag.pending = !!under?.closest('#shelf-pending');
  drag.slot = { itemId: drag.itemId, uids: drag.uids, col, row, rotation: drag.rotation };
  drag.valid = !!under?.closest('#shelf-grid') && canPlaceShelf(state.shelfLayout, drag.slot, drag.original);
  const preview = $('#shelf-preview');
  preview.classList.toggle('hidden', !under?.closest('#shelf-grid'));
  preview.classList.toggle('invalid', !drag.valid);
  Object.assign(preview.style, { left: col * size + 'px', top: row * size + 'px', width: w * size + 'px', height: h * size + 'px' });
  $('#shelf-pending').classList.toggle('shelf-drop-ready', drag.pending);
}

function scrollShelfDrag() {
  if (!shelfDrag?.ghost) return;
  const { x, y } = shelfDrag;
  const scroller = $('.shelf-scroll');
  const bounds = scroller?.getBoundingClientRect();
  if (bounds && y >= bounds.top && y <= bounds.bottom) {
    if (x >= bounds.left && x < bounds.left + 24) scroller.scrollLeft -= 8;
    if (x <= bounds.right && x > bounds.right - 24) scroller.scrollLeft += 8;
  }
  if (y < 34) window.scrollBy(0, -8);
  if (y > window.innerHeight - 34) window.scrollBy(0, 8);
  previewShelfDrag();
  shelfDrag.scrollFrame = requestAnimationFrame(scrollShelfDrag);
}

function rotateShelfDrag() {
  if (!shelfDrag?.ghost) return;
  shelfDrag.rotation = shelfDrag.rotation === 90 ? 0 : 90;
  previewShelfDrag();
}

function finishShelfDrag(event, cancelled = false) {
  const drag = shelfDrag;
  if (!drag || drag.pointer !== event.pointerId) return;
  if (drag.ghost && !cancelled) moveShelfDrag(event);
  shelfDrag = null;
  if (drag.scrollFrame != null) cancelAnimationFrame(drag.scrollFrame);
  drag.tile.classList.remove('shelf-dragging');
  drag.ghost?.remove();
  $('#shelf-preview')?.classList.add('hidden');
  $('#shelf-pending')?.classList.remove('shelf-drop-ready');
  const rotate = $('#rotate-shelf');
  if (rotate) {
    rotate.disabled = true;
    rotate.classList.remove('rotate-during-drag');
  }
  if (cancelled) return;
  if (!drag.ghost) return viewStock(drag.uids[0]);
  if (!drag.valid && !drag.pending) return;
  const layout = state.shelfLayout;
  layout.placements = layout.placements.filter(slot => slot !== drag.original);
  if (drag.valid) layout.placements.push(drag.slot);
  if (drag.pending && state.current?.receipt) {
    const kept = state.current.receipt.filter(row => !drag.uids.includes(row.uid));
    if (kept.length !== state.current.receipt.length) {
      state.current.receipt = kept;
      resetBuyerNegotiation(state.current);
    }
  }
  renderAll(); save();
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
    <small>熟客提出试玩时可以答应，顾客自己选洞，收入在收摊时入账。${!state.settlement && demand ? ' 今天还可接待 ' + demand + ' 次。' : ''}</small>
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
      ${['cooked', 'bloom'].includes(stage.key) ? `<button class="btn small gold" onclick="moveToTray(${stock.uid})" ${state.settlement || state.grill.tray?.length >= GRILL.trayCapacity ? 'disabled' : ''}>放存货盘</button>` : ''}
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
    <div class="card"><strong>存货盘 · ${state.grill.tray?.length || 0}/${GRILL.trayCapacity}</strong><p>只供当天出售，隔夜清理。</p>
      ${(state.grill.tray || []).map(stock => `<p>${itemById(stock.itemId).name} · ${grillStage(stock).name}
      <button class="btn small" onclick="discardGrillFood(${stock.uid})" ${state.settlement ? 'disabled' : ''}>丢弃</button></p>`).join('')}</div>
    <div class="trade-actions">${controls}<button class="btn small" onclick="openManagement('wholesale')">向供货商补货</button></div>
  </section>`;
}

function tabCustomers() {
  const roster = [
    ...NEW_CUSTOMERS.filter(person => NEW_REGULAR_ROLES[person.id]).map(person => ({ ...person, customerId: person.id })),
    ...REGULARS,
  ];
  const cards = roster.map(person => {
    const id = person.id || person.name;
    const card = state.customers[id];
    const visits = card?.visits || state.regulars[person.id]?.visits || 0;
    const portrait = customerPortrait(person);
    return `<article class="card customer-card">
      <div class="customer-card-art"><span class="portrait-frame" data-portrait="${portrait.key}"
        style="background-position:${portrait.position}" aria-hidden="true">${portrait.avatar || ''}</span></div>
      <strong>${person.name}</strong><small class="mut">${visits ? '来店 ' + visits + ' 次' : '尚未见面'}</small>
      ${id === 'thief' && state.theftKnown ? '<p>已标记 · 曾顺走商品</p>' : ''}
      ${card?.chapters.length ? `<details><summary>来店故事 · ${card.chapters.length} 段</summary>
      <ol>${card.chapters.map(chapter => '<li>' + chapter + '</li>').join('')}</ol></details>` : ''}
    </article>`;
  }).join('');
  return `<p class="mut">全部 ${roster.length} 位顾客</p><div class="customer-roster">${cards}</div>`;
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
  return [...REGULARS, ...NEW_CUSTOMERS.filter(person => NEW_REGULAR_ROLES[person.id])].map((r) => {
    const s = getRegular(r.id);
    const role = NEW_REGULAR_ROLES[r.id] || r.role;
    const portrait = customerPortrait({ ...r, customerId: NEW_REGULAR_ROLES[r.id] ? r.id : null });
    const unlock = s.favor >= CONFIG.favorSpecialAt ? '已解锁专属好货' : s.favor >= CONFIG.favorGoodOddsAt ? '货源成色变好' : '继续成交涨好感';
    const goods = (r.favItems || [...r.likes, ...(EXTRA_GOOD_PREFERENCES[r.id] || [])])
      .map(id => itemById(id).name).join('、');
    return `<article class="card regular-card">
      <div class="customer-card-art"><span class="portrait-frame" data-portrait="${portrait.key}"
        style="background-position:${portrait.position}" aria-hidden="true">${portrait.avatar || ''}</span></div>
      <div><div class="row"><b>${r.name}（${role}）</b><span>好感 ${s.favor} · 来访 ${s.visits} 次</span></div>
      <div class="mut">${r.favItems ? '拿手货' : '喜欢的商品'} · ${goods}</div>
      ${r.favItems ? `<small class="mut">${unlock}</small>` : ''}</div>
    </article>`;
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

/* ---------------- 开发者测试台（正式版由 DEV_MODE 统一关闭） ---------------- */
function devStageName(key) {
  return key === 'opening' ? '开局零售' : SERVICE_NAMES[key] || key;
}

function devSetStage(key) {
  if (!DEV_MODE || !DEV_CONFIG.stages.includes(key)) return;
  const milestone = key === 'opening' ? [0, 0] : MILESTONES[key];
  state.progress.sales = milestone[0];
  state.progress.days = milestone[1];
  state.progress.kept = [];
  state.grill.owned = key === 'grill' || key === 'delivery';
  state.seenTutorials = TUTORIALS.filter(lesson => serviceAvailable(lesson.unlock)).map(lesson => lesson.id);
  state.guidedLessons = [...state.seenTutorials];
  renderAll(); save(); renderDeveloperPanel();
  notifyPlayer(`开发测试：已切到「${devStageName(key)}」阶段。`);
}

function devGrantResources() {
  if (!DEV_MODE) return;
  state.money = Math.max(state.money, DEV_CONFIG.grantMoney);
  const addStock = (item, wholesale = false) => {
    const existing = state.shelf.filter(stock => stock.itemId === item.id).length;
    for (let i = existing; i < DEV_CONFIG.stockEach; i++) {
      const value = wholesale ? item.value : Math.round((item.base[0] + item.base[1]) / 2);
      state.shelf.push({
        uid: nextUid(), itemId: item.id, variant: 'real', condition: 'mint',
        cost: Math.max(1, Math.round(value * DEV_CONFIG.stockCostMultiplier)), value, wholesale, stockedDay: state.day,
      });
    }
  };
  WHOLESALE.forEach(item => addStock(item, true));
  ITEMS.forEach(item => addStock(item));
  state.shelfLayout = migrateShelfLayout(state.shelf);
  renderAll(); save(); renderDeveloperPanel();
  notifyPlayer('开发测试：资金与全品类商品已补齐。');
}

function devMeetVisitor(kind, profile = '', customerId = '') {
  if (!DEV_MODE || !['buyer', 'seller', 'credit', 'poke'].includes(kind)) return;
  if (profile && !BUYER_PROFILES[profile]) return;
  if (kind !== 'seller' && !counterInventory().some(retailAvailable)) devGrantResources();
  state.settlement = null;
  $('#modal-mask').classList.add('hidden');
  state.shopOpen = true;
  state.queue = [];
  const visitor = kind === 'seller' ? makeSeller() : makeBuyer(false, profile, customerId);
  if (customerId === 'thief') visitor.devForceTheft = true;
  if (kind === 'credit' || kind === 'poke') {
    if (kind === 'credit' && !state.progress.kept.includes('ledger')) state.progress.kept.push('ledger');
    const regular = REGULARS[0];
    visitor.regularId = regular.id;
    visitor.name = regular.name;
    visitor.portraitName = regular.name;
    visitor.avatar = regular.avatar;
    visitor.customerId = null;
    visitor.encounter = null;
    visitor.creditAsk = kind === 'credit';
    prepareBuyerState(visitor);
    if (kind === 'poke') {
      if (!state.progress.kept.includes('poke')) state.progress.kept.push('poke');
      if (!state.poke.active || !pokeDemand()) {
        const prize = POKE.grands.find(pokePrizeAvailable);
        state.poke = { active: true, holesLeft: POKE.holes, opened: [], dayOpened: 0,
          dayLimit: POKE.basePokes + POKE.grandTraffic, grandId: prize.itemId,
          grandPos: randInt(0, POKE.holes - 1), grandTaken: false };
      }
      visitor.finishedTrade = true;
    }
  }
  state.current = visitor;
  recordCustomerVisit(visitor);
  state.neighborTalk = null;
  tradeOpen = true;
  $('#dev-panel').close();
  renderAll(); save(); playCustomerArrival();
}

function devRunSettlement(kind) {
  if (!DEV_MODE || !['rent', 'sticker-redeem', 'sticker-complaint', 'credit-repay', 'credit-default'].includes(kind)) return;
  state.settlement = null;
  state.current = null;
  state.queue = [];
  state.shopOpen = true;
  state.daySales = [];
  state.openingMoney = state.money;
  state.devForceEvent = kind;
  if (kind === 'rent') state.day = Math.max(CONFIG.rentCycle, Math.ceil(state.day / CONFIG.rentCycle) * CONFIG.rentCycle);
  if (kind.startsWith('sticker')) {
    state.sticker.on = true;
    state.sticker.rare = kind === 'sticker-redeem' ? 1 : 0;
    state.sticker.grumble = kind === 'sticker-complaint' ? STICKER.grumbleLimit : 0;
  }
  if (kind.startsWith('credit')) {
    const regular = REGULARS[0];
    state.ledger.push({
      id: nextUid(), regularId: regular.id, whoName: regular.name,
      amount: DEV_CONFIG.creditAmount, due: state.day, done: false, result: null,
    });
  }
  $('#dev-panel').close();
  $('#modal-mask').classList.add('hidden');
  save();
  endDay();
}

function devSetGrillStage(key) {
  if (!DEV_MODE) return;
  const stage = GRILL.stages.find(entry => entry.key === key);
  if (!stage) return;
  state.progress.sales = Math.max(state.progress.sales, MILESTONES.grill[0]);
  state.progress.days = Math.max(state.progress.days, MILESTONES.grill[1]);
  state.grill.owned = true;
  state.grill.slots = [{
    uid: nextUid(), itemId: GRILL.foods[0].id, cost: GRILL.foods[0].cost,
    value: GRILL.foods[0].value, variant: 'real', grilled: true,
    placedAt: state.serviceTurns - stage.turns,
  }];
  $('#dev-panel').close();
  renderAll(); save(); openManagement('grill');
}

function renderDeveloperPanel() {
  if (!DEV_MODE) return;
  $('#dev-status').textContent = `第 ${state.day} 天 · 付现小票 ${state.progress.sales} · 收摊 ${state.progress.days} · 资金 ¥${state.money}`;
  $('#dev-stages').innerHTML = DEV_CONFIG.stages.map(key => {
    const milestone = key === 'opening' ? [0, 0] : MILESTONES[key];
    const active = state.progress.sales === milestone[0] && state.progress.days === milestone[1];
    return `<button type="button" class="btn" aria-pressed="${active}" onclick="devSetStage('${key}')">${devStageName(key)}<br><small>${milestone[0]} 单 / ${milestone[1]} 天</small></button>`;
  }).join('');
  $('#dev-grill-stages').innerHTML = GRILL.stages.map(stage =>
    `<button type="button" class="btn" onclick="devSetGrillStage('${stage.key}')">${stage.name}<br><small>${stage.turns} 回合</small></button>`).join('');
  $('#dev-encounters').innerHTML =
    '<button class="btn" onclick="devSetGrillStage(\'cooked\'); moveToTray(state.grill.slots[0].uid)">测试存货盘</button>' +
    '<button class="btn" onclick="devMeetVisitor(\'poke\')">熟客戳戳乐事件</button>' +
    NEW_CUSTOMERS.map(person =>
      `<button class="btn" onclick="devMeetVisitor('buyer', '', '${person.id}')">${person.name}</button>`).join('') +
    '<button class="btn" onclick="state.theftKnown = false; devMeetVisitor(\'buyer\', \'\', \'thief\')">首次盗窃事件</button>' +
    '<button class="btn" onclick="state.theftKnown = true; devMeetVisitor(\'buyer\', \'\', \'thief\')">已标记的灰夹克顾客</button>';
}

function openDeveloperPanel() {
  if (!DEV_MODE) return;
  renderDeveloperPanel();
  $('#dev-panel').showModal();
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
document.addEventListener('click', event => {
  const target = guideTarget;
  if (target?.lesson && target.element.contains(event.target) && !state.guidedLessons.includes(target.lesson)) {
    state.guidedLessons.push(target.lesson);
    save();
  }
  scheduleGuideArrow();
}, true);
document.addEventListener('close', scheduleGuideArrow, true);
document.addEventListener('toggle', scheduleGuideArrow, true);
window.addEventListener('resize', scheduleGuideArrow);
window.addEventListener('scroll', scheduleGuideArrow, { passive: true });
$('#open-shelf-grid').addEventListener('click', () => openManagement('shelf'));
$('#tab-pages').addEventListener('pointerdown', beginShelfDrag);
document.addEventListener('pointermove', moveShelfDrag);
document.addEventListener('pointerup', event => finishShelfDrag(event));
document.addEventListener('pointercancel', event => finishShelfDrag(event, true));
document.addEventListener('lostpointercapture', event => finishShelfDrag(event, true));
$('#tab-pages').addEventListener('click', event => {
  if (event.target.closest('#rotate-shelf')) rotateShelfDrag();
  if (event.detail === 0 && event.target.closest('.shelf-piece')) {
    viewStock(Number(event.target.closest('.shelf-piece').dataset.stock.split(',')[0]));
  }
});
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() === 'r' && shelfDrag?.ghost) {
    event.preventDefault();
    rotateShelfDrag();
  }
});
$('#btn-openday').addEventListener('click', startDay);
$('#btn-endday').addEventListener('click', endDay);
$('#guest-call').addEventListener('click', () => {
  if (!state.current || state.settlement) return;
  tradeOpen = true;
  renderWindow();
  $('#counter').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('#action-area').focus({ preventScroll: true });
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
$('#open-dev').addEventListener('click', openDeveloperPanel);
$('#close-dev').addEventListener('click', () => $('#dev-panel').close());
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
$('#shop-name-dialog form').addEventListener('submit', event => {
  event.preventDefault();
  state.shopName = $('#shop-name').value.trim().slice(0, SHOP_SIGN.maxLength) || SHOP_SIGN.defaultName;
  $('#shop-name-dialog').close();
  enterShop(false);
});
$('#shop-name-dialog').addEventListener('cancel', event => event.preventDefault());
$('#open-delivery').addEventListener('click', openDelivery);
$('#open-live').addEventListener('click', () => {
  $('#shop-service-content').innerHTML = '<h2 id="shop-service-title">直播</h2><p>后续开放</p>';
  $('#shop-service').showModal();
});
$('#open-title').addEventListener('click', openTitle);
$('#open-calendar').addEventListener('click', openCalendar);
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
if (state.current && !state.settlement) tradeOpen = true;
renderAll();
if (state.settlement) showSettlement(state.settlement);
openTitle();
