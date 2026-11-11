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
const itemById = (id) => ITEMS.find((i) => i.id === id) || WHOLESALE.find((i) => i.id === id);
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
let tradePage = 'inspect';

function newState() {
  return {
    day: 1,
    economyVersion: 1,
    promoDay: 0,
    started: false,
    guide: true,
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
    return Object.assign(newState(), { started: true, guide: false }, s); // 用默认值兜底新字段，保证老存档可续
  } catch (e) { return null; }
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

function makeSeller(demoItemId) {
  const useRegular = Math.random() < 0.35;
  const reg = useRegular ? pick(REGULARS) : null;
  const person = reg || pick(SELLERS);
  // 熟客优先带来偏好物品，好感≥6 时保真好货
  let item;
  if (reg && Math.random() < 0.6) item = itemById(pick(reg.favItems));
  else item = pick(ITEMS);
  if (demoItemId) item = itemById(demoItemId);
  let variant = rollVariant(reg);
  if (reg && getRegular(reg.id).favor >= CONFIG.favorSpecialAt && Math.random() < 0.3) variant = 'real';
  const base = randInt(item.base[0], item.base[1]);
  const condition = variant === 'bad' ? pick(['broken', 'defective']) : Math.random() < clamp(.20 + state.rep / 1000, .05, .42) ? 'mint' : 'used';
  const factor = variant === 'fake' ? CONFIG.variantMult.fake : CONDITION[condition].factor;
  const value = Math.max(1, Math.round(base * factor));
  const ask = variant === 'bad'
    ? Math.max(2, Math.round(base * rand(CONFIG.sellerAskBad[0], CONFIG.sellerAskBad[1])))
    : Math.max(2, Math.round(base * rand(CONFIG.sellerAskReal[0], CONFIG.sellerAskReal[1])));
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

function makeBuyer() {
  const displayed = state.shelf.filter(stock => stock.displayed !== false);
  const available = [...new Set(displayed.map(stock => itemCategory(itemById(stock.itemId))))];
  const categories = ['食品', '文具', '玩具', '收藏', '电器', '卡牌', '日用', '潮流'];
  const useRegular = Math.random() < .35;
  const person = useRegular ? pick(REGULARS) : pick(BUYERS);
  const age = /老|爷|叔/.test(person.name) ? 'older' : /学生|豆包|年轻/.test(person.name) ? 'young' : 'adult';
  const wanted = pick(available.length && Math.random() < .8 ? available : categories);
  const target = displayed.find(stock => itemCategory(itemById(stock.itemId)) === wanted);
  const usualBudget = wanted === '食品' || wanted === '文具' ? randInt(6, 20) : randInt(30, 115);
  const favor = useRegular ? getRegular(person.id).favor : 0;
  const cap = Math.max(3, Math.round(usualBudget * (1 + state.rep / 400 + Math.max(0, favor) * .025)));
  return {
    type: 'buyer', name: useRegular ? person.name : age === 'young' ? '年轻顾客' : age === 'older' ? '路过的街坊' : '路过的顾客',
    portraitName: person.name, avatar: person.avatar, age, wanted, cap,
    line: '今天想买' + wanted + '，预算 ¥' + cap + '。',
    regularId: useRegular ? person.id : null, targetUid: target ? target.uid : null,
    offer: target ? retailPrice(target) : 0, patience: 2,
    creditAsk: serviceAvailable('ledger') && useRegular && Math.random() < CONFIG.creditChance,
  };
}

function startDay() {
  state.openingMoney = state.money;
  state.wholesaleOrders = [];
  state.settlement = null;
  state.daySales = [];
  state.pendingComplaints = 0;
  const sellerCount = CONFIG.sellersPerDay + (state.rep >= 65 ? 1 : 0);
  const queue = [];
  const demo = state.day === 1 && state.guide && !state.shelf.length ? makeSeller('youxiji') : null;
  for (let i = demo ? 1 : 0; i < sellerCount; i++) queue.push(makeSeller());
  // 买家：货架有货才来，保底人数受策略与口碑修正（最低 1）
  if (state.shelf.length) {
    let buyerCount = CONFIG.buyersGuaranteed + STRATEGIES[state.strategy].buyers + neighborTraffic();
    buyerCount = clamp(buyerCount, 1, 8);
    for (let i = 0; i < buyerCount; i++) queue.push({ type: 'buyer' });
  }
  // 卖家与买家穿插
  for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
  if (demo) queue.unshift(demo);
  state.queue = queue;
  state.current = null;
  addLog(`开店啦，今天有 ${queue.length} 位顾客排队。`);
  nextVisitor();
}

function nextVisitor() {
  const returnFocus = tradeOpen;
  tradeOpen = false;
  inspectionFace = 0;
  tradePage = 'inspect';
  inspectedPart = null;
  state.current = null;
  while (!state.current && state.queue.length) {
    const visitor = state.queue.shift();
    // 买家到柜台时按当前库存选货并报价。
    state.current = visitor.type === 'buyer' ? makeBuyer() : visitor;
    if (!state.current) addLog('有买家探头看了一眼：货架空了，先走了。');
  }
  if (state.current && state.current.type === 'buyer' && buyerTarget()) tradePage = 'quote';
  if (state.current && state.current.regularId) getRegular(state.current.regularId).visits++;
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
    changeReputation(-4);
    if (c.regularId) addFavor(c.regularId, -1);
    notifyPlayer(`${c.name} 没接受最后的 ¥${bid}，带着东西走了。口碑 −4。`, true);
    return nextVisitor();
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
  changeReputation(1);
  markCollection(c.itemId, c.variant);
  if (c.regularId) addFavor(c.regularId, +1);
  notifyPlayer(`以 ¥${price} 收下${item.name}。鉴定结果：${CONFIG.variantName[c.variant]}，估值 ¥${c.value}。`, true);
  nextVisitor();
}

function refuseSeller() {
  const c = state.current;
  if (!c) return;
  addLog(`你摆摆手，${c.name} 拿着东西走了。`);
  if (c.regularId) addFavor(c.regularId, -1);
  nextVisitor();
}

/* ============================================================
 * 柜台接待：买家（成交 / 抬价 / 不卖 / 赊账）
 * ============================================================ */
function buyerTarget() {
  const c = state.current;
  return state.shelf.find((s) => s.uid === c.targetUid) || null;
}

function settleBuyerSale(price, onCredit, gift = 0, discount = false) {
  const c = state.current;
  const t = buyerTarget();
  if (!t) return nextVisitor();
  const objection = buyerObjection(c, t);
  if (objection) {
    const penalty = t.relabelled ? 10 : 6;
    changeReputation(-penalty);
    if (c.regularId) addFavor(c.regularId, -2);
    notifyPlayer(c.name + '：' + objection + ' 口碑 −' + penalty + '。', true);
    return nextVisitor();
  }
  const item = itemById(t.itemId);
  state.shelf = state.shelf.filter((s) => s.uid !== t.uid);
  if (onCredit) {
    const due = state.day + randInt(CONFIG.creditDueDays[0], CONFIG.creditDueDays[1]);
    state.ledger.push({ id: nextUid(), regularId: c.regularId, whoName: c.name, amount: price, due, done: false, result: null });
    notifyPlayer(`${c.name} 赊购${item.name}，欠款 ¥${price}，第 ${due} 天到期。`, true);
  } else {
    state.money += price;
    state.daySales.push({ itemId: item.id, label: `${c.name} 买走${item.name}`, revenue: price, profit: price - t.cost });
    addLog(`${c.name} 以 ¥${price} 买走了${item.name}（成本 ¥${t.cost}，净赚 ¥${price - t.cost}）。`);
  }
  changeReputation(1 + (discount ? 2 : 0) + Math.min(6, Math.ceil(gift / 10)));
  if (c.regularId) addFavor(c.regularId, 1 + (discount ? 1 : 0) + Math.min(3, Math.ceil(gift / 15)));
  if (gift) addLog('你让出 ¥' + gift + ' 差价，作为赠予。');
  nextVisitor();
}

function buyerAccept() { buyerDeal('normal'); }
function buyerCredit() { if (serviceAvailable('ledger')) buyerDeal('credit'); }

function buyerRaise() {
  const c = state.current;
  if (!c || c.type !== 'buyer') return;
  const want = Math.round(c.offer * 1.15);
  if (want <= c.cap) { c.offer = want; c.lastWords = '行行行，就这个价，成交！'; return settleBuyerSale(want, false); }
  c.patience--;
  if (c.patience <= 0) {
    changeReputation(-5);
    if (c.regularId) addFavor(c.regularId, -1);
    notifyPlayer(`${c.name}：太贵了，我不要了。口碑 −5。`, true);
    return nextVisitor();
  }
  c.offer = want;
  c.lastWords = '你这价我实在接不住，最多这个数了。';
  renderAll(); save();
}

function buyerRefuse() {
  const c = state.current;
  if (!c) return;
  addLog(`你把东西放回货架，${c.name} 恋恋不舍地走了。`);
  nextVisitor();
}

/* ============================================================
 * 支线系统操作
 * ============================================================ */
function orderWholesale(id) {
  const product = WHOLESALE.find(item => item.id === id);
  if (!product || state.day < (product.unlockDay || 1) || state.settlement || state.wholesaleOrders.includes(id)) return;
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

  if (firstOrder && (!state.current || state.current.type !== 'buyer') && !state.queue.some(visitor => visitor.type === 'buyer')) {
    state.queue.push({ type: 'buyer' });
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
  const total = POKE.boardCost + g.cost;
  if (state.money < total) return notifyCashShortage(total);
  state.money -= total;
  state.poke = { active: true, holesLeft: POKE.holes, holesOpened: 0, grandId: grandItemId, grandPos: randInt(0, POKE.holes - 1), grandTaken: false };
  state.specialCards.pokeGrand = true;
  addLog(`戳戳乐进货上架！大奖是${itemById(grandItemId).name}，一共花了 ¥${total}。`);
  renderAll(); save();
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

/* ============================================================
 * 收摊结算
 * ============================================================ */
function endDay() {
  if (state.settlement) return showSettlement(state.settlement);
  if (state.current || state.queue.length) return notifyPlayer('还有顾客在等，先接待完再收摊。');
  const strat = STRATEGIES[state.strategy];
  const cashBeforeClosing = state.money;
  const autoList = [];
  const others = [];
  let complaintCount = state.pendingComplaints;

  // 1) 收摊自动售卖
  const remain = [];
  for (const s of state.shelf) {
    if (Math.random() < strat.autoRate) {
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
      changeReputation(2);
      if (e.regularId) addFavor(e.regularId, +1);
      others.push({ label: `💵 ${e.whoName} 来还赊账`, amount: e.amount });
    } else {
      e.result = 'default';
      if (e.regularId) addFavor(e.regularId, -2);
      others.push({ label: `🏃 ${e.whoName} 的赊账赖掉了`, amount: 0 });
    }
  }

  // 4) 戳戳乐日结
  const pk = state.poke;
  if (pk.active && pk.holesLeft > 0) {
    let pokes = POKE.basePokes + (!pk.grandTaken ? POKE.grandTraffic : 0) + (state.rep >= 60 ? 1 : 0);
    pokes = Math.min(pokes, pk.holesLeft);
    let grandHit = false;
    for (let i = 0; i < pokes; i++) {
      if (!pk.grandTaken && pk.holesOpened + i === pk.grandPos) grandHit = true;
    }
    pk.holesOpened += pokes; pk.holesLeft -= pokes;
    const net = pokes * (POKE.price - POKE.smallPrizeCost);
    state.money += net;
    others.push({ label: `🎯 戳戳乐被戳了 ${pokes} 个洞`, amount: net });
    if (grandHit) {
      pk.grandTaken = true;
      addLog(`🎉 戳戳乐大奖 ${itemById(pk.grandId).name} 被戳走了！围观的人都沸腾了。`);
      others.push({ label: `🎉 大奖 ${itemById(pk.grandId).name} 被戳中（成本已在进货时付过）`, amount: 0 });
    }
    if (pk.holesLeft <= 0) { pk.active = false; addLog('戳戳乐板子戳完了，该重新进货了。'); }
  }

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
  startDay();
  renderAll(); save();
  if (SHOP_EVENTS[state.day] || state.day % CONFIG.rentCycle === 0) openNeighborhood();
}

/* ============================================================
 * 渲染
 * ============================================================ */
function renderAll() {
  renderTop();
  renderNeighborhood();
  renderGuide();
  renderVisitor();
  renderWindow();
  renderTabs();
  $('#counter-stock').innerHTML = [...new Set(state.shelf.map(stock => stock.itemId))]
    .slice(0, 6).map(itemArtwork).join('');
  renderLog();
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
  if (state.settlement) text = '看完今天的流水，点「明天开店」进入下一天。';
  else if (guest && guest.type === 'buyer') text = '点窗前的买家，看看他想买什么。';
  else if (!hasOrdered && (state.shelf.length || !guest) && state.money >= WHOLESALE[0].cost * WHOLESALE[0].pack) {
    text = '试试从供货商补货。点窗台的「进货」，订一批干脆面。';
  } else if (guest) text = '点窗前的顾客，看看他带来了什么。';
  else text = '顾客接待完了，点「收摊结算」看看今天的流水。';
  $('#guide-text').textContent = text;
  tradeGuide.textContent = !guest ? ''
    : guest.type === 'buyer' ? '看清买家的报价，再决定成交、抬价还是不卖。'
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
  if (firstOpening) openNeighborhood();
}

function itemArtwork(id) {
  const art = ITEM_ART[id];
  if (id === 'youxiji') return '<span class="item-art item-art-handheld" aria-hidden="true"></span>';
  if (!art) return '';
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
  const stock = state.shelf.find(entry => entry.uid === uid);
  if (stock) viewItem(stock.itemId, uid);
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
  $('#street-status').textContent = guest
    ? '还有 ' + state.queue.length + ' 位顾客在路上'
    : state.settlement ? '今天已打烊' : '顾客已接待完，可以收摊了';
  $('#open-shelf').setAttribute('aria-label', '打开货架，共 ' + state.shelf.length + ' 件商品');
}

function toggleDisplay(uid) {
  const entry = state.shelf.find(item => item.uid === uid);
  if (!entry || state.settlement) return;
  entry.displayed = entry.displayed === false;
  renderWindow();
  renderTabs();
  save();
  $('#display-' + uid).focus();
}

function renderTop() {
  $('#stat-day').textContent = `第 ${state.day} 天`;
  $('#stat-money').textContent = `💰 ¥${state.money}`;
  $('#stat-rep').textContent = `😊 口碑 ${state.rep}`;
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
  const column = PORTRAITS[identity];
  frame.dataset.portrait = identity === '快递小哥' ? 'courier' : Number.isInteger(column) ? String(column) : 'fallback';
  frame.textContent = Number.isInteger(column) ? '' : guest.avatar;
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

function setTradePage(page) {
  tradePage = page;
  renderVisitor();
}

function renderSeller(c, area, act) {
  const item = itemById(c.itemId);
  renderDialogue(c, c.regularId ? '熟客 · 卖家' : '卖家', c.lastWords ? [c.lastWords] : [c.line, pickCachedPitch(c)]);
  area.innerHTML = '';
  const draft = tradeOpen ? $('#bidInput')?.value : '';
  const minimum = c.openingBid ? c.openingBid + 1 : 1;
  const prices = c.openingBid
    ? [minimum, Math.round((c.openingBid + c.ask) / 2), c.ask]
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
      <p>${c.openingBid ? `起价 ¥${c.openingBid} 未成交。最后一口价 ¥${minimum}–${c.ask}。` : '先报你愿意出的最低价。卖家接受就成交。'}</p>
      <div class="trade-actions" aria-label="快捷填价">${shortcuts}</div>
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

function renderBuyer(c, area, act) {
  const t = buyerTarget();
  const item = t ? itemById(t.itemId) : null;
  const role = c.regularId ? '熟客 · 买家' : '散客 · 买家';
  renderDialogue(c, role, [c.lastWords || c.line]);
  area.innerHTML = `<div class="trade-brief">
    <span class="trade-intent">想买 · ${c.wanted}</span>
    ${item ? `<button type="button" class="item-preview" onclick="viewStock(${t.uid})" aria-label="查看${item.name}">${itemArtwork(item.id)}</button>
      <strong>${item.name}</strong>${conditionBadge(t)}${t.relabelled ? '<span class="pill real">真品标签</span>' : ''}` : '<strong>还没选商品</strong>'}
    <dl><dt>预算</dt><dd>¥${c.cap}</dd><dt>耐心</dt><dd>${c.patience}</dd></dl>
  </div>`;

  const favor = c.regularId ? getRegular(c.regularId).favor : 0;
  const mayPitch = !c.pitched && (state.rep >= 35 || favor >= 3);
  const matches = uniqueStock(state.shelf.filter(stock => stock.displayed !== false && itemCategory(itemById(stock.itemId)) === c.wanted));
  const alternatives = mayPitch ? uniqueStock(state.shelf.filter(stock => stock.displayed !== false && itemCategory(itemById(stock.itemId)) !== c.wanted && stock.uid !== c.targetUid)) : [];
  const options = [...matches, ...alternatives].map(stock => {
    const product = itemById(stock.itemId);
    const pitch = !matches.includes(stock);
    return `<button type="button" class="stock-tile" onclick="selectBuyerStock(${stock.uid},${pitch})"
      aria-pressed="${stock.uid === c.targetUid}">${itemArtwork(product.id)}<span>${product.name}</span>
      <small>${pitch ? '推销 · ' : ''}¥${retailPrice(stock)}</small></button>`;
  }).join('');
  const choices = options ? '<div class="buyer-options">' + options + '</div>' : '<p>货架上没有符合需求的商品。</p>';
  const discountPrice = Math.max(1, Math.floor(c.offer * .85));
  act.innerHTML = `<div class="trade-pages" role="group" aria-label="交易步骤">
    <button class="btn small" onclick="setTradePage('inspect')" aria-pressed="${tradePage === 'inspect'}">选商品</button>
    <button class="btn small" onclick="setTradePage('quote')" aria-pressed="${tradePage === 'quote'}">报价</button>
  </div>
  ${tradePage === 'inspect' ? choices : t ? `<div class="trade-actions">
    <button class="btn primary" onclick="buyerAccept()">成交 ¥${c.offer}</button>
    <button class="btn gold" onclick="buyerDeal('discount')">打折 ¥${discountPrice}</button>
    ${c.offer > c.cap ? `<button class="btn" onclick="buyerDeal('gift')">赠予差价 ¥${c.offer - c.cap}</button>` : ''}
    ${c.creditAsk && serviceAvailable('ledger') ? '<button class="btn" onclick="buyerCredit()">赊账</button>' : ''}
    <button class="btn" onclick="buyerRaise()">加价 15%</button>
  </div>` : '<p>先为顾客选一件商品。</p>'}
  <button class="btn small" onclick="buyerRefuse()">结束接待</button>`;
}

function renderTabs() {
  if (!serviceAvailable(currentTab)) currentTab = 'shelf';
  document.querySelectorAll('#tabs .tab').forEach(b => {
    b.classList.toggle('hidden', !serviceAvailable(b.dataset.tab));
    b.classList.toggle('active', b.dataset.tab === currentTab);
  });
  const page = $('#tab-pages');
  if (currentTab === 'shelf') page.innerHTML = tabShelf();
  else if (currentTab === 'wholesale') page.innerHTML = tabWholesale();
  else if (currentTab === 'poke') page.innerHTML = tabPoke();
  else if (currentTab === 'sticker') page.innerHTML = tabSticker();
  else if (currentTab === 'ledger') page.innerHTML = tabLedger();
  else if (currentTab === 'collection') page.innerHTML = tabCollection();
  else page.innerHTML = tabRegulars();
}

function tabWholesale() {
  const products = WHOLESALE.filter(product => state.day >= (product.unlockDay || 1)).map(product => {
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
  return '<p class="mut">每种商品每天限订一批，立即到货。</p>' + products;
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
    <details class="shelf-strategy"><summary>定价策略</summary><div class="trade-actions">${strategies}</div></details>`;
}

function tabPoke() {
  const pk = state.poke;
  if (!pk.active) {
    const opts = POKE.grands.map((g) => {
      const total = POKE.boardCost + g.cost;
      return `<div class="card"><div class="row"><span>大奖：${itemPreviewButton(g.itemId)} <b>${itemById(g.itemId).name}</b></span><span>总成本 ¥${total}</span></div>
        <button class="btn small primary" onclick="pokeStock('${g.itemId}')">进货上架</button></div>`;
    }).join('');
    return `<div class="card">🎯 戳戳乐：一板 ${POKE.holes} 个洞，进货 ¥${POKE.boardCost}，顾客 ¥${POKE.price}/洞来戳。大奖摆在明面上能拉客流，被戳中就归人家了。</div>${opts}`;
  }
  let holes = '';
  for (let i = 0; i < POKE.holes; i++) {
    const opened = i < pk.holesOpened;
    const isGrand = i === pk.grandPos;
    holes += `<div class="hole ${opened ? 'open' : ''} ${isGrand && !pk.grandTaken ? 'grand' : ''}">${opened ? (isGrand && pk.grandTaken ? '🏆' : '·') : '?'}</div>`;
  }
  return `<div class="card">🎯 营业中：剩余 ${pk.holesLeft} 个洞｜大奖 ${itemPreviewButton(pk.grandId)} ${itemById(pk.grandId).name} ${pk.grandTaken ? '已被戳走 😭' : '还在板上 ✨（拉客流中）'}</div>
    <div class="poke-grid">${holes}</div><div class="mut" style="margin-top:8px;">每天收摊时自动结算戳洞收入，大奖位置只有你自己看得见。</div>`;
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
  const rows = (list) => list.length
    ? list.map((x) => `<tr><td>${x.itemId ? itemPreviewButton(x.itemId) : ''} ${esc(x.label)}</td><td class="plus">+¥${x.revenue}</td></tr>`).join('')
    : '<tr><td class="mut">无</td><td>¥0</td></tr>';
  const others = s.others.length
    ? s.others.map((x) => `<tr><td>${esc(x.label)}</td><td class="${x.amount >= 0 ? 'plus' : 'minus'}">${x.amount >= 0 ? '+' : ''}¥${x.amount}</td></tr>`).join('')
    : '<tr><td class="mut">无</td><td>¥0</td></tr>';
  $('#modal').innerHTML = `<h3>🌙 第 ${state.day} 天收摊结算</h3>
    <b>☀️ 白天柜台成交（小计 +¥${s.dayTotal}）</b><table>${rows(s.dayList)}</table>
    <b>🌙 收摊自动售卖（小计 +¥${s.autoTotal}）</b><table>${rows(s.autoList)}</table>
    <b>🧾 其他收支（小计 ${s.otherTotal >= 0 ? '+' : ''}¥${s.otherTotal}）</b><table>${others}</table>
    <p>白天进货支出 ¥${s.daytimeSpend}</p>
    <p style="font-size:16px;">今日净变化：<b class="${s.net >= 0 ? 'plus' : 'minus'}">${s.net >= 0 ? '+' : ''}¥${s.net}</b>｜当前资金 <b>¥${state.money}</b>｜口碑 ${state.rep}</p>
    <button class="btn primary" onclick="nextDay()" style="margin-top:10px;">☀️ 明天开店</button>`;
  $('#modal-mask').classList.remove('hidden');
}

/* ---------------- 初始化与全局绑定 ---------------- */
function resetGame() {
  if (!confirm('确定要清空存档、重新开店吗？')) return;
  localStorage.removeItem(CONFIG.saveKey);
  state = newState();
  addLog('新店开业！口袋里有 ¥250，目标是攒够 ¥3000 盘下店面。');
  startDay();
  renderAll(); save();
}

document.querySelectorAll('#tabs .tab').forEach((b) =>
  b.addEventListener('click', () => { currentTab = b.dataset.tab; renderTabs(); }));
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

$('#open-shelf').addEventListener('click', () => openManagement('shelf'));
$('#viewer-label').addEventListener('click', () => changeLabel(viewedShelfUid));
$('#shop-npc').addEventListener('click', openNeighborhood);
$('#close-neighborhood').addEventListener('click', () => $('#neighborhood').close());
$('#promote-shop').addEventListener('click', () => {
  $('#neighborhood').close();
  recruitShoppers();
});
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
  startDay();
}
renderAll();
if (state.settlement) showSettlement(state.settlement);
openTitle();
