/* 柜台定价、库存成色、社区客流。存档中的货品保留原始真伪。 */
function changeReputation(delta) {
  state.rep = clamp(state.rep + delta, -200, 200);
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
    const key = [entry.itemId, stockCondition(entry), entry.variant, !!entry.relabelled, retailPrice(entry)].join('/');
    if (!byKind.has(key)) byKind.set(key, entry);
  }
  return [...byKind.values()];
}

function conditionBadge(stock) {
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
  if (state.current && state.current.type === 'buyer' && state.current.targetUid === uid) state.current.offer = retailPrice(stock);
  save();
  renderAll();
  if ($('#item-viewer').open) viewStock(uid);
}

function neighborTraffic() {
  const friends = REGULARS.filter(person => getRegular(person.id).favor >= 5).length;
  return clamp(Math.trunc(state.rep / 65) + Math.min(2, friends), -2, 4);
}

function serviceAvailable(key) {
  return !SERVICE_DAYS[key] || state.day >= SERVICE_DAYS[key];
}

function shopVisitor() {
  if (state.day % CONFIG.rentCycle === 0) {
    const rent = CONFIG.rentBase + (state.day / CONFIG.rentCycle - 1) * CONFIG.rentStep;
    return { role: 'landlord', name: '房东周叔', line: '今天收摊时交本周房租 ¥' + rent + '。' };
  }
  return SHOP_EVENTS[state.day] || (state.day >= 2 ? SHOP_EVENTS[2] : null);
}

function recruitShoppers() {
  if (state.day < 2 || state.settlement || state.promoDay === state.day) return;
  if (state.money < 18) return notifyCashShortage(18);
  state.money -= 18;
  state.promoDay = state.day;
  state.queue.push({ type: 'buyer' }, { type: 'buyer' });
  notifyPlayer('社区宣传已安排，今天多来两位买家。');
  if (!state.current) nextVisitor();
  else renderAll();
  renderNeighborhood();
}

function buyerObjection(guest, stock) {
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

function selectBuyerStock(uid, persuade) {
  const guest = state.current;
  const stock = state.shelf.find(entry => entry.uid === uid);
  if (!guest || guest.type !== 'buyer' || !stock) return;
  const category = itemCategory(itemById(stock.itemId));
  if (category !== guest.wanted) {
    if (!persuade || guest.pitched) return;
    const favor = guest.regularId ? getRegular(guest.regularId).favor : 0;
    if (state.rep < 35 && favor < 3) return;
    guest.pitched = true;
    const chance = clamp(.2 + state.rep / 400 + favor * .045, .15, .8);
    if (Math.random() >= chance) {
      guest.lastWords = '谢谢，今天我还是只想买' + guest.wanted + '。';
      renderAll(); save();
      return;
    }
    guest.lastWords = '你介绍得有道理，我也看看这件。';
  }
  guest.targetUid = uid;
  guest.offer = retailPrice(stock);
  tradePage = 'quote';
  renderAll(); save();
}

function buyerDeal(mode) {
  const guest = state.current;
  const stock = guest && guest.type === 'buyer' ? buyerTarget() : null;
  if (!stock) return;
  const price = mode === 'discount' ? Math.max(1, Math.floor(guest.offer * .85)) : guest.offer;
  if (price > guest.cap && mode !== 'gift') return notifyPlayer('顾客预算只有 ¥' + guest.cap + '，可以打折或赠予差价。');
  const paid = Math.min(price, guest.cap);
  const gift = mode === 'gift' ? Math.max(0, price - paid) : 0;
  settleBuyerSale(paid, mode === 'credit', gift, mode === 'discount' && price < guest.offer);
}

function renderNeighborhood() {
  const visitor = shopVisitor();
  $('#shop-npc').textContent = visitor ? visitor.name : '街坊消息';
  $('#neighborhood-portrait').dataset.npc = visitor ? visitor.role : 'mentor';
  $('#neighborhood-name').textContent = visitor ? visitor.name : '邻居林姨';
  $('#neighborhood-line').textContent = visitor ? visitor.line : '今天先把店里的生意顾好。';
  $('#promote-shop').classList.toggle('hidden', !visitor || visitor.role !== 'organizer' || !!state.settlement);
  $('#promote-shop').disabled = state.promoDay === state.day;
}

function openNeighborhood() {
  renderNeighborhood();
  $('#neighborhood').showModal();
}

/* 校园放学主题纯音乐：钟琴旋律与轻柔的分解和弦。 */
let shopAudio;
let musicOutput;
let musicTimer;
let melodyStep = 0;
const SHOP_TUNE = [
  [76, 79, 81, 79, 76, null, 74, 72],
  [74, 76, 79, 76, 74, null, 71, null],
  [72, 76, 81, 84, 83, 81, 76, null],
  [77, 76, 74, 71, 72, null, 72, null],
];
const SHOP_CHORDS = [[48, 55, 60, 64], [43, 50, 59, 62], [45, 52, 57, 60], [41, 48, 55, 59]];

function setMusicVolume() {
  if (musicTimer) musicOutput.gain.setTargetAtTime(Number($('#music-volume').value) / 100, shopAudio.currentTime, .025);
}

function playTone(note, type, level, duration) {
  const oscillator = shopAudio.createOscillator();
  const gain = shopAudio.createGain();
  const now = shopAudio.currentTime;
  oscillator.type = type;
  oscillator.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
  gain.gain.setValueAtTime(.0001, now);
  gain.gain.exponentialRampToValueAtTime(level, now + .018);
  gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
  oscillator.connect(gain).connect(musicOutput);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function playMusicNote() {
  if (document.hidden) return;
  const bar = Math.floor(melodyStep / 8);
  const beat = melodyStep % 8;
  const note = SHOP_TUNE[bar][beat];
  if (note !== null) {
    playTone(note, 'sine', .22, .66);
    playTone(note + 12, 'sine', .035, .23);
  }
  playTone(SHOP_CHORDS[bar][beat % 4], 'triangle', .13, .48);
  melodyStep = (melodyStep + 1) % (SHOP_TUNE.length * 8);
}

async function toggleMusic() {
  const button = $('#music-toggle');
  if (musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
    musicOutput.gain.setTargetAtTime(0, shopAudio.currentTime, .025);
    button.setAttribute('aria-pressed', 'false');
    return;
  }
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return notifyPlayer('当前环境无法播放背景音乐。');
  try {
    if (!shopAudio) {
      shopAudio = new Audio();
      musicOutput = shopAudio.createGain();
      musicOutput.connect(shopAudio.destination);
    }
    await shopAudio.resume();
    if (musicTimer) return;
    musicTimer = setInterval(playMusicNote, 330);
    setMusicVolume();
    playMusicNote();
    button.setAttribute('aria-pressed', 'true');
  } catch (error) {
    notifyPlayer('暂时无法播放背景音乐。');
  }
}
