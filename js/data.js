/* ============================================================
 * 校门口小卖部 —— 数据文件（js/data.js）
 * 职责：只放数据与数值，不放逻辑。
 * 调数值 / 加物品 / 改台词，都只改这个文件，不要动 game.js。
 * ============================================================ */

/* ---------------- 全局数值配置 ---------------- */
const CONFIG = {
  startMoney: 250,          // 起始资金
  goalMoney: 3000,          // 阶段目标：盘下店面
  startRep: 0,             // 起始口碑（0-100）
  saveKey: 'xiaomaibu-save-v2', // 存档键名（改结构时改版本号）

  rentBase: 50,             // 第 1 周房租
  rentStep: 20,             // 每周涨租
  rentCycle: 7,             // 每 7 天交一次租

  sellersPerDay: 3,         // 每日基础卖家数（口碑≥60 再 +1）
  buyersGuaranteed: 3,      // 货架有货时，每日基础买家数
  standardTradeMax: 75,
  counterSlots: 6,
  openingHours: [
    { served: 0, hour: 8, light: 'morning' },
    { served: .2, hour: 12, light: 'noon' },
    { served: .4, hour: 14, light: 'afternoon' },
    { served: .6, hour: 16, light: 'sunset' },
    { served: .8, hour: 18, light: 'night' },
    { served: 1, hour: 20, light: 'night' },
  ],
  reputation: { min: -100, max: 100, visitsPerPoint: 12, dailyLossLimit: 3, failedBidLoss: 1 },
  retail: {
    buyerCount: [1, 8],
    everydayBudget: [12, 25],
    specialtyBudget: [30, 115],
    premiumBudget: [120, 420],
    selfPickChance: .45,
    selfPickCount: [1, 3],
    specificChance: .35,
    categoryChance: .45,
    recommendationChance: .65,
    freshSaleFavor: 1,
    freshSaleRepProgress: 1,
    priceTolerance: { standard: 1.2, fresh: 1.5, mint: 1.65, bloom: 1.5 },
    conditionChance: .35,
    conditionCheckChance: .40,
    conditionPenalty: 2,
    clearanceMultiplier: .75,
    receiptDiscount: .9,
    priceStrategyMarkup: 1.1,
    discountBudgetBoost: 2,
    roundOffAmount: 1,
    courtesyRepProgress: 1,
    courtesyFavor: 1,
    maxUnitPrice: 9999,
  },

  // 成色抽取概率（真品 / 残次 / 山寨）
  variantOdds: { real: 0.55, bad: 0.25, fake: 0.20 },
  // 成色真值系数
  variantMult: { real: 1.0, bad: 0.55, fake: 0.22 },
  variantName: { real: '真品', bad: '残次', fake: '山寨' },

  maxChecks: 3,             // 每件货最多鉴定次数（检查点共 4 个）
  sellerBottom: [0.55, 0.80], // 卖家底线 = 真值 × 该区间随机
  sellerAskReal: [0.75, 1.35],  // 卖家自认真品时的要价倍率
  sellerAskBad: [0.50, 0.80],   // 残次品卖家的要价倍率

  collectorChance: 0.18,    // 买家中收藏家的概率
  collectorMult: [1.5, 2.0],    // 收藏家出价倍率（对真值）

  fakeComplaintChance: 0.25,    // 山寨货卖出后被投诉概率
  fakeComplaintFine: 10,        // 投诉罚款
  fakeComplaintRep: -1,         // 投诉扣口碑

  creditChance: 0.25,       // 熟客买家提出赊账的概率
  creditDueDays: [2, 3],    // 赊账到期天数
  creditRepayChance: 0.80,  // 到期还款概率（强子减半，见 REGULARS.risk）

  favorGoodOddsAt: 3,       // 好感≥3：该熟客货物真品率 +15%
  favorSpecialAt: 6,        // 好感≥6：偶尔带来保真专属好货
};

/* 仅供本地开发测试台使用；正式版关闭 game.js 顶部的 DEV_MODE。 */
const DEV_CONFIG = {
  grantMoney: 5000,
  stockEach: 2,
  stockCostMultiplier: .4,
  creditAmount: 42,
  stages: ['opening', 'clearance', 'receiving', 'ledger', 'sticker', 'premium', 'grill', 'delivery'],
};

/* ---------------- 定价策略（三档） ----------------
 * mult：买家出价倍率；buyers：每日买家数修正；
 * autoRate：收摊自动售出概率；autoMult：自动售出价倍率 */
const STRATEGIES = {
  low:  { name: '薄利多销', mult: 0.85, buyers: +1, autoRate: 0.75, autoMult: 0.95 },
  mid:  { name: '标准',     mult: 1.00, buyers: 0,  autoRate: 0.55, autoMult: 1.15 },
  high: { name: '高价慢卖', mult: 1.30, buyers: -1, autoRate: 0.35, autoMult: 1.45 },
};

/* 玩家经营时使用的商品大类。原物品 cat 继续保留，供收藏偏好和鉴定使用。 */
const SHOP_CATEGORIES = [
  { id: 'food', name: '食物', cats: ['食品', '热食'] },
  { id: 'study', name: '学习用品', cats: ['文具'] },
  { id: 'daily', name: '日用品', cats: ['日用', '电器'] },
  { id: 'fun', name: '玩具娱乐', cats: ['玩具', '卡牌', '潮流'] },
  { id: 'collect', name: '收藏旧物', cats: ['收藏'] },
];

// 以开店第一天为周一，每 28 天重复一次。事件按周期内的日期安排。
const SHOP_CALENDAR = {
  cycleDays: 28,
  weekdays: ['一', '二', '三', '四', '五', '六', '日'],
  events: [
    { day: 3, name: '雨天', description: '放学后大家赶着回家，零食饮料也好商量。', buyers: -1, prices: { food: .90 } },
    { day: 5, name: '运动会', description: '操场活动结束，孩子们来补充零食和饮料。', buyers: 2, prices: { food: 1.20 } },
    { day: 9, name: '手工课', description: '手工课要用到文具，校门口比平常热闹。', buyers: 1, prices: { study: 1.15 } },
    { day: 14, name: '学校放假', description: '学生少了，文具和玩具更容易议价。', buyers: -2, prices: { study: .85, fun: .90 } },
    { day: 19, name: '街坊市集', description: '周边摊位陆续开张，日用品和旧物更受关注。', buyers: 2, prices: { daily: 1.15, collect: 1.10 } },
    { day: 24, name: '放学联欢', description: '同学们结伴来买零食和小玩具。', buyers: 2, prices: { food: 1.10, fun: 1.15 } },
  ],
};

/* 买家画像：预算倍率、主动讨价概率、最多报价回合、期望折扣区间。 */
const BUYER_PROFILES = {
  child:    { name: '小学生', budgetMult: .68, haggleChance: .08, rounds: [1, 1], target: [.94, .98] },
  student:  { name: '学生', budgetMult: .82, haggleChance: .18, rounds: [1, 2], target: [.90, .97] },
  youngMan: { name: '青年男生', budgetMult: 1.05, haggleChance: .48, rounds: [2, 2], target: [.88, .95] },
  auntie:   { name: '街坊阿姨', budgetMult: 1.00, haggleChance: .86, rounds: [4, 5], target: [.78, .88] },
  adult:    { name: '普通顾客', budgetMult: 1.00, haggleChance: .34, rounds: [2, 3], target: [.87, .95] },
  elder:    { name: '老街坊', budgetMult: .95, haggleChance: .52, rounds: [3, 4], target: [.83, .92] },
};

/* ---------------- 熟客（全原创） ----------------
 * favor 好感度；patience 砍价耐心修正；fakeBias 货源山寨倾向（-1~1）；
 * risk 赊账赖账倍率（1 为普通，2 为双倍赖账率）；likes 偏好品类 */
const REGULARS = [
  { id: 'laozhou', profile: 'elder', name: '老周', avatar: '🧓', role: '集邮老手',
    lines: { sell: '小老板，看看我这老物件，都是压箱底的。', buy: '这件我惦记好几天了，给个实在价。', credit: '先记账上，我老周的招牌还能不值这点钱？' },
    profile: 'elder', patience: 0, fakeBias: -0.5, risk: 1, likes: ['收藏'], favItems: ['youpiao', 'jinianci'] },
  { id: 'guifen', profile: 'auntie', name: '桂芬婶', avatar: '👵', role: '砍价高手',
    lines: { sell: '家里收拾出来的，你可别想蒙婶子。', buy: '再便宜点，婶子可是天天来捧场的。', credit: '婶子先记着，卖了菜就来还你。' },
    profile: 'auntie', patience: -1, fakeBias: 0, risk: 1, likes: ['日用', '电器'], favItems: ['tangcibei', 'shouyinji'] },
  { id: 'xiaodoubao', profile: 'child', name: '小豆包', avatar: '🧒', role: '小学生',
    lines: { sell: '姐姐，我拿零花钱换的宝贝卖给你。', buy: '哇！这个我要攒钱买，求你别卖给别人。', credit: '我先记账，放学让我妈来给钱，行不行嘛。' },
    profile: 'child', patience: +1, fakeBias: 0, risk: 1, likes: ['玩具', '卡牌'], favItems: ['danzhu', 'shanka'] },
  { id: 'qiangzi', profile: 'youngMan', name: '强子', avatar: '🧑', role: '鞋表贩子',
    lines: { sell: '渠道货，懂的都懂，价格好说。', buy: '痛快点，这件我转手就能出去。', credit: '兄弟之间先记着，周转开了马上还。' },
    profile: 'youngMan', patience: 0, fakeBias: +0.6, risk: 2, likes: ['潮流'], favItems: ['shanzhaibiao', 'shanzhaixie'] },
  { id: 'sundaye', profile: 'elder', name: '孙大爷', avatar: '👴', role: '老街坊',
    lines: { sell: '年纪大了，留着也是留着，你给个公道价。', buy: '这东西有年头了，我就好这一口。', credit: '先记账上，我遛弯回来就给你送来。' },
    profile: 'elder', patience: +1, fakeBias: -0.3, risk: 1, likes: ['收藏', '文具'], favItems: ['lianhuanhua', 'huaibiao'] },
];

/* ---------------- 普通顾客池 ---------------- */
const SELLERS = [
  { name: '豆豆妈', avatar: '👩', line: '孩子不玩了，收拾出来卖给你。' },
  { name: '初中生阿凯', avatar: '🧑‍🎓', line: '急用钱买新卡带，这个便宜处理了。' },
  { name: '买菜路过的大姐', avatar: '🧕', line: '家里翻出来的，你看看值多少。' },
  { name: '遛弯的刘叔', avatar: '🧔', line: '闲置多年，留着占地方。' },
  { name: '快递小哥', avatar: '🚴', line: '客户退货不要的，全新着呢。' },
  { name: '隔壁班女生', avatar: '👧', line: '同款买重了，这个转给你。' },
];
const BUYERS = [
  { name: '放学的小学生', avatar: '🎒', profile: 'child', line: '就这个！我看中好久了。' },
  { name: '来接孩子的爸爸', avatar: '👨', profile: 'adult', line: '孩子闹着要，给我拿那个。' },
  { name: '怀旧的年轻人', avatar: '🧑', profile: 'youngMan', line: '哎哟，这可是我小时候的梦。' },
  { name: '精打细算的阿姨', avatar: '👩‍🦰', profile: 'auntie', line: '这件多少钱？合适我就拿了。' },
  { name: '来买文具的女生', avatar: '👧', profile: 'student', line: '我来看看今天有什么。' },
  { name: '刚打完球的学生', avatar: '🏀', profile: 'student', line: '打完球想买点吃的。' },
  { name: '修车的许师傅', avatar: '🧰', profile: 'adult', line: '刚忙完，来看看。' },
];
const COLLECTOR = { name: '神秘收藏家', avatar: '🕶️', line: '听说你这儿有好货，我专程来的。钱不是问题，要真东西。' };

/* 卖家台词模板（{item} 替换为物品名） */
const SELLER_PITCH = [
  '这件{item}可是好东西，你仔细看看。',
  '我这{item}保管得可好了，诚心要你就开个价。',
  '{item}，当年抢都抢不到，你店里肯定好卖。',
];

/* ---------------- 戳戳乐 ---------------- */
const POKE = {
  boardCost: 48,        // 每板进货价
  holes: 24,            // 每板洞数
  price: 5,             // 顾客每戳一洞付费
  smallPrizeCost: 1,    // 每洞小奖成本
  basePokes: 4,         // 每日基础戳洞人数
  grandTraffic: 3,      // 大奖在架时每日额外人数
  // 可选大奖：cost 为放进板里的成本
  grands: [
    { itemId: 'siduche', cost: 80 },
    { itemId: 'youxiji', cost: 120 },
    { itemId: 'baowan', cost: 40 },
  ],
};

/* ---------------- 集贴纸 ---------------- */
const STICKER = {
  snackIncome: [8, 18],     // 活动开启时每日顺带收入
  redeemPay: 100,           // 集满兑付金额
  redeemRep: 1,             // 兑付赢得的口碑
  rareMax: 5,               // 金龙贴纸最大投放量
  redeemChancePerRare: 0.02,// 每张投放量带来的每日集满概率
  grumbleZero: [8, 14],     // 投放 0 时每日嘀咕值增长
  grumbleHas: [0, 3],       // 投放 ≥1 时每日嘀咕值增长
  grumbleLimit: 100,        // 嘀咕值上限触发投诉
  complaintFine: 30,        // 投诉罚款
  complaintRep: -1,         // 投诉扣口碑
  grumbleAfterComplaint: 40,// 投诉后嘀咕值回落
};

/* ---------------- 物品库（29 件） ----------------
 * base：真品真值的基础价区间；checks 恰好 4 条：
 * [检查点, 真品线索, 山寨线索, 残次线索]——只暗示，不下结论。 */
const ITEMS = [
  { id: 'shanka', footprint: { w: 1, h: 1 }, name: '干脆面闪卡', emoji: '🃏', cat: '卡牌', base: [20, 80],
    flavor: '干脆面里摸出来的闪卡，一张稀有卡能换一周零花钱。',
    checks: [
      ['卡面印刷', '闪粉均匀，人物线条锐利', '闪粉发灰，线条有点糊', '印刷没毛病，就是卡面有道折痕'],
      ['卡背编码', '编码字体规整，钢印清晰', '编码对不齐，像是重印的', '编码清楚，边角被捏得发白'],
      ['镭射膜', '晃一晃彩虹纹流动自然', '彩虹纹呆板，角度不对就发暗', '膜面完好，只是沾了点油渍'],
      ['边角', '四角尖挺，没有毛边', '切边毛糙，有轻微分层', '有一个角磨圆了']],
  },
  { id: 'baowan', footprint: { w: 1, h: 1 }, name: '弹开球', emoji: '🔮', cat: '玩具', base: [25, 70],
    flavor: '滚过磁卡「啪」地弹开变身，当年在校门口能横着走。',
    checks: [
      ['磁吸感应', '贴近磁卡立刻有吸力', '吸力若有似无，要凑很近', '吸力正常，但反应慢半拍'],
      ['弹开机构', '弹开干脆，造型完全展开', '弹开软绵绵，有时卡住一半', '能弹开，就是一只脚收不回去'],
      ['接缝', '接缝严密，摸不到毛刺', '接缝对不齐，缝隙能塞指甲', '接缝没问题，表面有磕碰白点'],
      ['球身印刷', '图案清晰，配色正', '图案偏色，边缘溢墨', '印刷清楚，就是贴纸翘边了']],
  },
  { id: 'tuoluo', footprint: { w: 1, h: 1 }, name: '战斗陀螺', emoji: '🌀', cat: '玩具', base: [20, 60],
    flavor: '金属环越重越能打，午休走廊天天开赛。',
    checks: [
      ['战斗环重量', '掂着压手，金属感扎实', '轻飘飘的，像全塑料的', '重量够，就是环边有磕痕'],
      ['轴承', '拨一下转得顺滑安静', '转动发涩，还带哗啦声', '轴承顺滑，但轴尖磨平了点'],
      ['发射器齿条', '齿口完整，拉动有劲', '齿口发白，有崩齿', '齿条完好，拉绳有点起毛'],
      ['表面印刷', '标志清晰，电镀均匀', '标志字母间距怪，电镀发乌', '印刷没毛病，贴纸被撕掉一半']],
  },
  { id: 'siduche', footprint: { w: 2, h: 1 }, name: '四驱车', emoji: '🏎️', cat: '玩具', base: [60, 160],
    flavor: '校门口改装大赛的硬通货，马达和导轮都是钱。',
    checks: [
      ['车壳印刷', '字迹锐利，贴纸对位准', '贴纸歪斜，颜色发闷', '印刷没毛病，壳角有道裂纹'],
      ['底盘刻字', '刻字深而清晰', '刻字浅，边缘发毛', '刻字清楚，底盘有改装划痕'],
      ['马达标签', '标签字体工整，铜线发亮', '标签糊成一团，铜线发黑', '标签在，就是转起来声音发闷'],
      ['导轮做工', '导轮顺滑无毛刺', '导轮晃动，塑料毛刺多', '导轮顺滑，但缺了一颗螺丝']],
  },
  { id: 'youyouqiu', footprint: { w: 1, h: 1 }, name: '悠悠球', emoji: '🪀', cat: '玩具', base: [10, 35],
    flavor: '睡眠时间越长越神气，绳子都是自己换的。',
    checks: [
      ['轴承', '空转时间长，几乎没声', '转两下就停，还偏心晃', '转得顺，就是轴承有点锈点'],
      ['球体', '两半对称，分量均匀', '一边轻一边重，缝对不齐', '对称没问题，外圈有磕凹'],
      ['绳槽', '槽口光滑不磨绳', '槽口有毛刺，绳子起毛', '槽口完好，原配绳子快断了'],
      ['外观', '漆面亮，图案正', '漆面发雾，图案偏位', '漆没毛病，边上有掉漆']],
  },
  { id: 'youxiji', footprint: { w: 2, h: 2 }, name: '掌上游戏机', emoji: '🎮', cat: '电器', base: [80, 220],
    flavor: '被窝里的快乐源泉，没收名单上的头号通缉犯。',
    checks: [
      ['屏幕', '点亮无坏点，背光均匀', '屏幕发黄，边缘有暗斑', '显示正常，就是屏面有划痕'],
      ['按键', '回弹清脆，没有连键', '按键肉，按下去黏糊', '按键都灵，方向键磨得发亮'],
      ['电池仓', '触点干净，仓盖严实', '触点发绿，像漏过液', '仓里干净，就是盖子松了'],
      ['外壳刻字', '刻字清晰，螺丝是十字口', '刻字模糊，螺丝口型对不上', '刻字没问题，壳角有摔裂']],
  },
  { id: 'cidai', footprint: { w: 1, h: 1 }, name: '磁带', emoji: '📼', cat: '电器', base: [8, 30],
    flavor: '铅笔是它的专属维修工具，A 面第一首最经典。',
    checks: [
      ['带芯', '磁带平整，没有起皱', '带子有点松，边缘发毛', '带子没问题，就是中段有一处接痕'],
      ['外壳', '壳体透亮，螺丝齐全', '壳体发浑，缺一颗螺丝', '外壳完好，边角有小裂纹'],
      ['标签纸', '字迹工整，贴得端正', '标签歪贴，字迹像描的', '标签在，就是有点受潮起泡'],
      ['窗口', '窗口干净，能看清带量', '窗口全是灰，毛毛的', '窗口清晰，压带毡有点脱落']],
  },
  { id: 'suishenting', footprint: { w: 2, h: 1 }, name: '随身听', emoji: '🎧', cat: '电器', base: [50, 150],
    flavor: '挂在腰间最拉风，磁带转起来青春就转起来。',
    checks: [
      ['试听', '声音干净，左右声道齐', '一边声音小，还带电流声', '声音正常，快进时有点飘'],
      ['按键', '按键段落感清楚', '按键松松垮垮，像要掉', '按键都好使，播放键磨秃了'],
      ['电池仓', '仓内干净无锈', '触点有白霜，漏过液', '仓内干净，盖子扣不紧'],
      ['机身刻字', '刻字工整，皮带扣锃亮', '刻字浅，字体还不对版', '刻字没问题，机身有道深划痕']],
  },
  { id: 'shanzhaibiao', footprint: { w: 1, h: 1 }, name: '山寨名表', emoji: '⌚', cat: '潮流', base: [100, 300],
    flavor: '十个人里九个看不出真假，剩下那个是卖表的。',
    checks: [
      ['表盘刻字', '刻字立体，夜光涂得均匀——慢着，这做工不像仿的', '字母挤成一团，有个字母还印反了', '刻字没毛病，表盘里进了点灰'],
      ['机芯动静', '晃一晃，秒针走得又稳又静', '秒针一跳一跳，还带哒哒声', '走时是准的，就是上弦有点涩'],
      ['表带', '表带沉手，扣具咬合紧', '表带轻得发飘，边角割手', '表带没问题，针扣有点松'],
      ['表镜', '表镜通透，侧光没有发蓝边', '表镜发雾，边缘一圈蓝光', '表镜清楚，就是有一道细划痕']],
  },
  { id: 'gangbi', footprint: { w: 1, h: 2 }, name: '老式钢笔', emoji: '🖊️', cat: '文具', base: [15, 50],
    flavor: '吸满一管墨水，能写完整个暑假作业。',
    checks: [
      ['笔尖', '笔尖刻字清楚，铱点圆润', '笔尖偏软，刻字模糊', '笔尖没问题，就是有点挂纸'],
      ['笔帽', '笔帽扣合有「咔哒」声', '笔帽松，倒过来就掉', '扣合正常，帽口有细裂纹'],
      ['上墨器', '推拉顺滑，不漏墨', '推拉发涩，接口渗墨', '上墨正常，储墨管有点老化发黄'],
      ['笔杆', '笔杆漆面亮，无磕碰', '漆面发乌，logo 印歪了', '笔杆完好，尾部有小磕痕']],
  },
  { id: 'lianhuanhua', footprint: { w: 1, h: 2 }, name: '连环画', emoji: '📚', cat: '收藏', base: [20, 90],
    flavor: '小人书，一毛钱能租一下午的精神食粮。',
    checks: [
      ['封面', '色彩鲜亮，品相挺括', '颜色发灰，像是翻印的', '封面完整，就是边角卷了'],
      ['内页印刷', '线条清晰，不透印', '线条发虚，有重影', '印刷没问题，中间缺了一页'],
      ['装订', '订书钉原装，没有锈', '钉子是后换的，位置还偏了', '装订牢固，书脊有点开胶'],
      ['出版信息', '版次印次清楚，老出版社', '信息页字迹模糊，对不上版', '信息齐全，就是扉页有个章']],
  },
  { id: 'danzhu', footprint: { w: 1, h: 1 }, name: '玻璃弹珠', emoji: '🔵', cat: '玩具', base: [3, 12],
    flavor: '赢来的弹珠要单独装一罐，那是战绩。',
    checks: [
      ['花纹', '内花居中，颜色透亮', '花纹偏心，颜色发浊', '花纹没问题，表面有小坑'],
      ['气泡', '珠体干净，几乎没气泡', '里面气泡一串串的', '气泡很少，就是有一道内裂纹'],
      ['圆度', '滚起来笔直不跑偏', '滚起来一歪一歪的', '圆度够，就是沾了洗不掉的渍'],
      ['透光', '对光看通透均匀', '透光发闷，中间有杂质', '通透没问题，边上有磕点']],
  },
  { id: 'kadai', footprint: { w: 1, h: 1 }, name: '游戏卡带', emoji: '👾', cat: '电器', base: [30, 120],
    flavor: '吹一吹再插，是每个玩家都懂的开机仪式。',
    checks: [
      ['标签贴纸', '贴纸平整，原版字体', '贴纸发鼓，字体对不上', '贴纸完整，就是边角翘起'],
      ['金手指', '触点金亮，没有划痕', '触点发暗，还有假镀的绿锈', '触点没问题，有一两道深划痕'],
      ['外壳螺丝', '三角螺丝，原装口型', '螺丝是十字口，后换的', '螺丝齐全，壳体有撬痕'],
      ['摇晃', '摇起来没杂音，板子固定', '里面哗啦响，板子是松的', '没有杂音，就是壳有点松动']],
  },
  { id: 'chongwuji', footprint: { w: 1, h: 1 }, name: '电子宠物机', emoji: '🐣', cat: '电器', base: [25, 80],
    flavor: '上课都要惦记喂它，死了能哭一下午。',
    checks: [
      ['屏幕', '像素点齐全，图案清楚', '屏幕发淡，缺了好几行点', '显示正常，屏面有细划痕'],
      ['按键', '三个键都灵敏', '中间键要使劲按才有反应', '按键都好使，漆面磨掉了'],
      ['电池盖', '盖子严实，螺丝在', '盖子是后配的，颜色对不上', '盖子原装，就是有点松'],
      ['挂链孔', '孔位完整，没有裂', '孔边发白，像要断', '孔位完好，链子不是原配']],
  },
  { id: 'youpiao', footprint: { w: 1, h: 1 }, name: '邮票', emoji: '✉️', cat: '收藏', base: [40, 200],
    flavor: '老周说，方寸之间装得下整个世界。',
    checks: [
      ['齿孔', '齿孔完整均匀，没有缺齿', '齿孔参差，像是自己剪的', '齿孔齐全，就是一枚角折了'],
      ['背胶', '背胶均匀，老票的胶香还在', '背胶发黏不匀，像刷过胶水', '背胶完好，边缘有点泛黄'],
      ['印刷', '色彩套印精准，细节锐利', '颜色偏淡，细节糊成一片', '印刷没问题，票面有淡淡指印'],
      ['票面', '纸面挺括，没有折痕', '纸面发软，像水洗过', '票面基本完整，边角有小污点']],
  },
];

/* 物品库续（16–29） */
ITEMS.push(
  { id: 'shouyinji', footprint: { w: 2, h: 2 }, name: '旧收音机', emoji: '📻', cat: '电器', base: [35, 110],
    flavor: '旋钮拧到沙沙响，评书和天气预报都在里面。',
    checks: [
      ['旋钮', '旋钮阻尼均匀，刻度对得准', '旋钮打滑，刻度盘是贴上去的', '旋钮能用，就是有点松旷'],
      ['天线', '天线节节拉得顺，根部牢', '天线歪着，根部像粘过的', '天线完整，顶端小球丢了'],
      ['喇叭声', '出声洪亮，没有破音', '声音发闷，还带杂音', '声音没问题，音量大时有点震'],
      ['外壳', '木纹漆面完好，边角齐整', '漆面发假，木纹像印的贴纸', '外壳完好，侧面有道磕痕']],
  },
  { id: 'tangcibei', footprint: { w: 1, h: 1 }, name: '搪瓷杯', emoji: '☕', cat: '日用', base: [10, 40],
    flavor: '磕掉瓷也不漏，大红花图案经久不衰。',
    checks: [
      ['杯口', '杯口一圈光滑，没有崩瓷', '杯口毛糙，像是补过漆', '杯口基本完整，有个小崩点'],
      ['图案', '花色鲜艳，套色准确', '花色发暗，图案错位', '图案没问题，就是有点褪色'],
      ['杯底印记', '底款清晰，老厂出品', '底款模糊，字都连一起了', '底款在，就是磨掉了一半'],
      ['把手', '把手牢固，接缝平整', '把手有点晃，接缝有胶痕', '把手牢固，就是瓷面有裂纹']],
  },
  { id: 'shanzhaixie', footprint: { w: 2, h: 1 }, name: '山寨运动鞋', emoji: '👟', cat: '潮流', base: [30, 90],
    flavor: '远远看一模一样，近看字母多一笔。',
    checks: [
      ['鞋标', '标织得工整，字母一个不多一个不少', '字母多了一笔，产地写得含糊', '鞋标没问题，就是有点起毛'],
      ['走线', '针脚均匀，没有跳线', '走线歪歪扭扭，还有线头', '走线齐整，鞋头有轻微开胶'],
      ['鞋底', '纹路深，材质有弹性', '鞋底发硬，纹路浅得像印的', '鞋底没问题，后跟磨偏了一点'],
      ['鞋盒', '盒标印刷清楚，码数齐全', '盒子软塌，印刷还偏色', '鞋盒完整，就是边角压扁了']],
  },
  { id: 'youxiwangka', footprint: { w: 1, h: 1 }, name: '对战卡牌', emoji: '🂡', cat: '卡牌', base: [15, 70],
    flavor: '金字红字分等级，一张金闪能换一堆散卡。',
    checks: [
      ['镭射防伪', '右下角镭射方块角度正', '镭射发暗，图案对不上', '镭射没问题，卡面有指纹印'],
      ['卡面', '金字立体，反光层次分明', '金字发平，像是贴的金纸', '卡面完整，就是有点弯'],
      ['边角', '四角尖挺，白边均匀', '切边毛糙，白边宽窄不一', '有一个角轻微折痕'],
      ['卡背', '背面色泽均匀，logo 清晰', '背面偏色，logo 发虚', '卡背完好，有轻微划痕']],
  },
  { id: 'cidianci', footprint: { w: 2, h: 1 }, name: '电子词典', emoji: '📟', cat: '电器', base: [40, 130],
    flavor: '查单词是假，打小游戏是真。',
    checks: [
      ['键盘', '按键回弹好，字母没磨损', '几个键按下去没反应', '按键都灵，字母磨掉几个'],
      ['屏幕', '显示清晰，没有断行', '屏幕缺了两行字', '显示正常，屏角有黑斑'],
      ['翻盖轴', '开合顺滑，能任意角度停', '翻盖松垮，停不住', '开合没问题，轴有点异响'],
      ['机身刻字', '品牌刻字清晰，字体正', '刻字模糊，型号对不上', '刻字没问题，外壳有划痕']],
  },
  { id: 'xiangji', footprint: { w: 2, h: 3 }, name: '老式照相机', emoji: '📷', cat: '收藏', base: [60, 180],
    flavor: '快门一响，黄金万两——当年可是大件。',
    checks: [
      ['镜头', '镜片通透，没有霉斑', '镜片发雾，里面像有哈气', '镜片干净，就是边缘有小霉点'],
      ['快门', '各档快门声清脆准确', '快门发黏，慢速档不准', '快门基本准，最高速有点拖'],
      ['机身', '皮革贴面完整，金属件亮', '贴面像是翻新的，胶边外翻', '机身完好，背带环磨损'],
      ['刻字', '机顶刻字深峻，字体老派', '刻字浅，字体版本不对', '刻字没问题，漆边有磕碰']],
  },
  { id: 'fuduji', footprint: { w: 2, h: 2 }, name: '复读机', emoji: '🔁', cat: '电器', base: [45, 120],
    flavor: '英语听力全靠它，跟读功能拯救过无数早读。',
    checks: [
      ['磁头', '磁头光亮，磨损均匀', '磁头锈迹斑斑', '磁头没问题，压带轮老化了'],
      ['按键', '复读键灵敏，段落感强', '按键要按两次才动', '按键都好使，标识磨没了'],
      ['喇叭', '人声清楚，没有破音', '声音发劈，底噪大', '声音正常，音量旋钮有点沙'],
      ['外壳', '壳体严实，电池盖在', '外壳发黄不均，像是拼装的', '外壳完好，提手裂了']],
  },
  { id: 'shouban', footprint: { w: 2, h: 2 }, name: '模型手办', emoji: '🧸', cat: '玩具', base: [30, 110],
    flavor: '摆在柜台最显眼的位置，懂的人自然会问价。',
    checks: [
      ['涂装', '涂装细腻，没有溢色', '涂装粗糙，眼睛都画歪了', '涂装没问题，武器尖有点掉漆'],
      ['关节', '关节紧实，能摆造型', '关节松垮，胳膊自己会掉', '关节基本紧，就是腿有点软'],
      ['底座刻字', '底座有编号刻字，字体工整', '底座光秃秃，什么都没有', '刻字在，就是底座有划痕'],
      ['配件', '配件齐全，替换手都在', '配件缺了关键的一件', '配件在，就是小零件有白痕']],
  },
  { id: 'jinianci', footprint: { w: 1, h: 1 }, name: '纪念币', emoji: '🪙', cat: '收藏', base: [50, 250],
    flavor: '带证书的老纪念币，是收藏家蹲点等的东西。',
    checks: [
      ['边齿', '边齿均匀整齐，滚字清晰', '边齿发毛，像是压铸的', '边齿齐全，就是有一处磕碰'],
      ['浮雕', '浮雕立体，细节丝丝分明', '浮雕发平，细节糊成一片', '浮雕没问题，表面有指纹渍'],
      ['包浆', '包浆自然温润，是岁月的', '颜色浮在表面，像是做旧的', '包浆自然，就是有一小块擦痕'],
      ['证书', '证书纸张老道，编号对得上', '证书像新打印的，编号对不上', '证书齐全，就是折过一道']],
  },
  { id: 'huaban', footprint: { w: 2, h: 3 }, name: '滑板', emoji: '🛹', cat: '潮流', base: [40, 120],
    flavor: '校门口空地上的风云人物同款，豚跳要练一夏天。',
    checks: [
      ['板面', '砂纸粗粝均匀，板型对称', '砂纸发滑，板面有点歪', '板面没问题，板尾磨秃了'],
      ['轮子轴承', '轮子转得顺，轴承没杂音', '轮子晃，轴承哗啦响', '轮子顺滑，就是有一个发黄了'],
      ['桥', '桥体扎实，螺丝齐全', '桥身轻飘，螺丝是后配的', '桥没问题，主钉有点松'],
      ['图案', '板底图案鲜艳完整', '图案偏色，还有重影', '图案在，就是刮花了几道']],
  },
  { id: 'kouqin', footprint: { w: 1, h: 2 }, name: '口琴', emoji: '🎵', cat: '文具', base: [12, 45],
    flavor: '十孔口琴，吹一首《小星星》就够在班里出名。',
    checks: [
      ['试音', '高低音都准，没有哑音', '有两个孔发哑，还漏气', '音准没问题，就是高音有点紧'],
      ['盖板刻字', '刻字清晰，字体老派正宗', '刻字浅，牌子拼写怪怪的', '刻字完好，盖板有小凹'],
      ['琴格', '琴格光滑，吹嘴不刮嘴', '琴格毛糙，边上有裂', '琴格没问题，螺丝有点锈'],
      ['簧片', '透光看簧片齐整无歪斜', '簧片有一片歪了', '簧片齐整，就是积了点灰']],
  },
  { id: 'huaibiao', footprint: { w: 1, h: 1 }, name: '老怀表', emoji: '🕰️', cat: '收藏', base: [70, 220],
    flavor: '孙大爷的同款爱好，链子一挂，年头就出来了。',
    checks: [
      ['表壳', '壳体沉手，花纹深刻', '壳体发轻，花纹像是冲压的', '表壳完好，就是铰链有点松'],
      ['机芯', '打开后盖，齿轮金黄走得稳', '机芯发暗，还有替换过的齿轮', '机芯走时准，就是摆轮有点慢'],
      ['表盘字', '罗马字工整，珐琅面无裂', '字体发飘，盘面像翻印的', '表盘没问题，有一道发丝裂'],
      ['盖内刻字', '盖内有匠人刻记，年份对得上', '盖内光秃，没有刻记', '刻记在，就是磨淡了一点']],
  },
  { id: 'suanpan', footprint: { w: 2, h: 1 }, name: '老算盘', emoji: '🧮', cat: '日用', base: [25, 85],
    flavor: '十三档老算盘，老会计的手感都在珠子里。',
    checks: [
      ['档杆', '档杆笔直，珠子滑动顺畅', '档杆有点弯，珠子发涩', '档杆没问题，就是一根有锈点'],
      ['算珠', '珠子木质温润，分量一致', '珠子轻飘，像是新换的塑料珠', '珠子齐全，就是缺了一颗下珠'],
      ['框料', '边框老木料，包浆厚实', '木料发新，漆味还没散', '边框完好，角上有磕痕'],
      ['刻字', '梁上有老字号刻字', '没有任何刻字，来历不明', '刻字在，就是淡得快看不清']],
  },
  { id: 'jinianzhang', footprint: { w: 1, h: 1 }, name: '纪念章', emoji: '🎖️', cat: '收藏', base: [10, 35],
    flavor: '一枚小章一个故事，老一辈的抽屉里总有几枚。',
    checks: [
      ['浮雕', '浮雕层次分明，线条利落', '浮雕发平，像是翻模的', '浮雕没问题，表面有擦痕'],
      ['电镀', '镀层均匀，亮而不浮', '镀层发乌，还有起泡', '镀层基本完整，边上有点脱落'],
      ['别针', '针杆笔直，针扣灵活', '针是焊上去的，焊点粗糙', '别针能用，就是有点松'],
      ['背面刻字', '背面有年份刻字，字体规整', '背面空白，什么都没刻', '刻字在，就是磨平了一角']],
  },
);

// 供货商品单独列出，供货商按批销售，顾客按件购买。
const NEW_GOODS = [
  { id: 'wh-latiao', footprint: { w: 1, h: 1 }, name: '辣条', cat: '食品', cost: 2, value: 4, pack: 6, life: 10 },
  { id: 'wh-pear', footprint: { w: 1, h: 2 }, name: '大白梨汽水', cat: '食品', cost: 3, value: 6, pack: 6, life: 7 },
  { id: 'wh-candy', footprint: { w: 1, h: 1 }, name: '压片糖果', cat: '食品', cost: 2, value: 4, pack: 6, life: 20 },
  { id: 'wh-choco', footprint: { w: 1, h: 1 }, name: '巧克力', cat: '食品', cost: 4, value: 7, pack: 4, life: 15 },
  { id: 'wh-eraser', footprint: { w: 1, h: 1 }, name: '橡皮', cat: '文具', cost: 2, value: 4, pack: 5 },
  { id: 'wh-plasticbook', footprint: { w: 1, h: 1 }, name: '塑胶本', cat: '文具', cost: 4, value: 7, pack: 4 },
  { id: 'wh-ink', footprint: { w: 1, h: 1 }, name: '墨水瓶', cat: '文具', cost: 4, value: 8, pack: 3 },
  { id: 'wh-case', footprint: { w: 1, h: 2 }, name: '文具盒', cat: '文具', cost: 6, value: 10, pack: 3 },
  { id: 'wh-watercolor', footprint: { w: 1, h: 2 }, name: '水彩笔', cat: '文具', cost: 6, value: 11, pack: 3 },
  { id: 'wh-compass', footprint: { w: 1, h: 2 }, name: '圆规套装', cat: '文具', cost: 5, value: 9, pack: 3 },
  { id: 'wh-pencil', footprint: { w: 1, h: 2 }, name: '自动铅笔', cat: '文具', cost: 3, value: 6, pack: 4 },
  { id: 'wh-beanbag', footprint: { w: 1, h: 1 }, name: '沙包', cat: '玩具', cost: 3, value: 6, pack: 4 },
  { id: 'wh-shuttle', footprint: { w: 1, h: 2 }, name: '毽子', cat: '玩具', cost: 3, value: 6, pack: 4 },
  { id: 'wh-laser', footprint: { w: 1, h: 2 }, name: '激光笔', cat: '玩具', cost: 7, value: 12, pack: 3 },
  { id: 'wh-cologne', footprint: { w: 1, h: 2 }, name: '花露水', cat: '日用', cost: 5, value: 9, pack: 3 },
  { id: 'wh-balm', footprint: { w: 1, h: 1 }, name: '清凉油', cat: '日用', cost: 3, value: 6, pack: 4 },
  { id: 'wh-clip', footprint: { w: 1, h: 1 }, name: '发卡', cat: '日用', cost: 2, value: 5, pack: 4 },
  { id: 'wh-battery', footprint: { w: 1, h: 1 }, name: '电池', cat: '日用', cost: 3, value: 6, pack: 4 },
];
const EXTRA_GOODS = [
  { id: 'wh-duel', footprint: { w: 1, h: 1 }, name: '对战卡片包', emoji: '🃏', cat: '卡牌', cost: 3, value: 6, pack: 4 },
  { id: 'wh-robot', footprint: { w: 2, h: 3 }, name: '变形机器人', emoji: '🤖', cat: '玩具', cost: 9, value: 15, pack: 3 },
  { id: 'wh-doll', footprint: { w: 2, h: 3 }, name: '换装娃娃', emoji: '🎀', cat: '玩具', cost: 8, value: 14, pack: 3 },
  { id: 'wh-shrimp', footprint: { w: 1, h: 1 }, name: '香脆虾条', emoji: '🦐', cat: '食品', cost: 2, value: 4, pack: 6, life: 10 },
  { id: 'wh-stickers', footprint: { w: 1, h: 1 }, name: '迷你贴纸', emoji: '⭐', cat: '文具', cost: 1, value: 3, pack: 6 },
  { id: 'wh-stamp', footprint: { w: 1, h: 1 }, name: '小印章', emoji: '🌼', cat: '文具', cost: 2, value: 4, pack: 5 },
];
const SHOP_SIGN = { defaultName: '校门口小卖部', maxLength: 16 };
const DELIVERY = { packTurns: 2, pickupTurns: 1, fee: 5, repProgress: 3, count: 2 };
const NEW_REGULAR_ROLES = {
  foodblogger: '美食博主', shopblogger: '探店博主', university: '大学生', infirmary: '医务室老师',
  grandma: '老街坊',
  mathteacher: '数学老师',
  peteacher: '体育老师',
  musicteacher: '音乐老师',
  boyglasses: '戴眼镜的男学生',
  girlglasses: '戴眼镜的女学生',
  cafeteria: '食堂阿姨',
  guard: '学校保安',
  xiaoman: '踢毽子的小学生', spike: '乐队少年', sunny: '海报设计爱好者',
  suit: '夜校学生', cosboy: '漫画社成员', cosgirl: '手作爱好者',
  delivery: '送餐骑手', driver: '出租车司机', teacher: '文具互助盒发起人',
};
const STORY_ITEMS = {
  laozhou: ['youpiao'], guifen: ['shouyinji'], xiaodoubao: ['wh-shuttle'], qiangzi: ['shanzhaibiao'], sundaye: ['lianhuanhua'],
  xiaoman: ['wh-shuttle'], spike: ['kouqin'], sunny: ['wh-watercolor'], suit: ['wh-pencil', 'wh-plasticbook'],
  cosboy: ['wh-watercolor'], cosgirl: ['wh-clip'], delivery: ['wh-pear'], driver: ['wh-battery'], teacher: ['wh-eraser', 'wh-pencil'],
};
const EXTRA_GOOD_PREFERENCES = {
  xiaoman: ['wh-doll', 'wh-stickers', 'wh-shrimp'],
  xiaodoubao: ['wh-duel', 'wh-robot', 'wh-shrimp'],
  cosboy: ['wh-duel', 'wh-robot'],
  cosgirl: ['wh-doll', 'wh-stamp', 'wh-stickers'],
  teacher: ['wh-stamp'],
};
const SHELF_GRID = { columns: 12, rows: 6, stackMaxCells: 2 };
const NEW_CUSTOMERS = [
  { id: 'foodblogger', name: '阿葵', profile: 'adult', likes: ['wh-shrimp', 'wh-latiao', 'grill-sausage', 'grill-ball'] },
  { id: 'shopblogger', name: '陶野', profile: 'adult', likes: ['wh-pear', 'wh-robot', 'wh-duel', 'wh-choco'] },
  { id: 'university', name: '顾辰', profile: 'student', likes: ['wh-pencil', 'wh-plasticbook', 'wh-latiao'] },
  { id: 'infirmary', name: '温老师', profile: 'adult', likes: ['wh-balm', 'wh-cologne', 'wh-battery'] },
  { id: 'grandma', name: '冯奶奶', profile: 'elder', likes: ['wh-balm', 'wh-cologne', 'wh-candy'] },
  { id: 'mathteacher', name: '沈老师', profile: 'adult', likes: ['wh-compass', 'wh-ink', 'wh-pencil'] },
  { id: 'peteacher', name: '梁老师', profile: 'adult', likes: ['wh-pear', 'wh-beanbag', 'wh-shuttle'] },
  { id: 'musicteacher', name: '闻老师', profile: 'adult', likes: ['kouqin', 'wh-plasticbook', 'wh-battery'] },
  { id: 'boyglasses', name: '程小远', profile: 'student', likes: ['wh-pencil', 'wh-case', 'wh-duel'] },
  { id: 'girlglasses', name: '叶小禾', profile: 'student', likes: ['wh-watercolor', 'wh-stickers', 'wh-eraser'] },
  { id: 'cafeteria', name: '罗姨', profile: 'auntie', likes: ['wh-balm', 'wh-pear', 'wh-plasticbook'] },
  { id: 'guard', name: '高师傅', profile: 'elder', likes: ['wh-battery', 'wh-balm', 'wh-noodles'] },
  { id: 'xiaoman', name: '小满', profile: 'child', likes: ['wh-clip', 'wh-shuttle', 'wh-candy', 'wh-eraser'], story: ['我们班要练踢毽子，可我一下也接不到。', '小豆包教我先把毽子抛直，我已经能踢三下了。', '今天我踢了十下！放学后我要教小豆包。'] },
  { id: 'spike', name: '阿哲', profile: 'student', likes: ['wh-latiao', 'wh-pear', 'wh-laser'], story: ['我们想组个乐队，还缺个排练的地方。', '小晴说她家车库能借一下午，我们先试一首。', '排练完邻居没投诉，还问我们什么时候演出。'] },
  { id: 'sunny', name: '小晴', profile: 'student', likes: ['wh-clip', 'wh-choco', 'wh-latiao'], story: ['我在做一张乐队招新海报，还没想好配色。', '海报贴出去，有个隔壁班的同学想来试键盘。', '键盘手留下来了，她还帮我们重画了一张海报。'] },
  { id: 'suit', name: '周先生', profile: 'adult', likes: ['wh-pencil', 'wh-plasticbook', 'wh-battery'], story: ['我报名了夜校，第一次下班后还要回教室。', '上节课随堂测验没写完，今晚想早点去复习。', '这次考过了，我打算接着读下一期。'] },
  { id: 'cosboy', name: '阿原', profile: 'student', likes: ['wh-watercolor', 'wh-laser', 'wh-choco'], story: ['我想画个自己设计的角色，服装还没上色。', '配色试了三次，总算找到了想要的颜色。', '我把设定画成一页漫画，社团愿意刊登。'] },
  { id: 'cosgirl', name: '绵绵', profile: 'student', likes: ['wh-ink', 'wh-watercolor', 'wh-clip'], story: ['我想做一对发饰，在社团展示时戴。', '第一次做歪了，我把纸样拆了重新裁。', '展示那天有人问我怎么做，我准备教她。'] },
  { id: 'help', name: '求助的街坊', profile: 'elder', event: 'help' },
  { id: 'thief', name: '灰夹克顾客', profile: 'adult', event: 'theft', likes: ['wh-candy', 'wh-battery'] },
  { id: 'delivery', name: '送餐的小陈', profile: 'adult', likes: ['wh-pear', 'wh-latiao', 'wh-balm'], story: ['我刚跑这片，不知道校门口几点会堵。', '听了你的提醒，我改走后街，今天赶上了取餐。', '现在这片路我熟了。下雨的话，你要捎什么就跟我说。'] },
  { id: 'driver', name: '出租车司机何叔', profile: 'adult', likes: ['wh-pear', 'wh-battery', 'wh-balm', 'wh-cologne'], story: ['有乘客把一把旧伞落车上了，我先替他收着。', '调度站说有人找伞，我让他下班后到站里取。', '伞还回去了。他说那是孩子送的，难怪这么着急。'] },
  { id: 'teacher', name: '许老师', profile: 'adult', likes: ['wh-ink', 'wh-case', 'wh-compass', 'wh-watercolor', 'wh-pencil', 'wh-eraser', 'wh-plasticbook', 'wh-beanbag'], story: ['班里想办一个文具互助盒，我先来看看缺什么。', '孩子们捐了不少铅笔，现在就缺几块橡皮。', '互助盒摆好了，忘带文具的孩子也能安心上课。'] },
];
const CUSTOMER_RULES = { storyVisits: [1, 3, 5], newChance: .33, helpRepChance: .5, helpRepProgress: 3, theftChance: .45 };
const CUSTOMER_PORTRAITS = ['xiaoman', 'spike', 'sunny', 'suit', null, 'cosboy', 'cosgirl', 'help', 'thief', 'delivery', 'driver', 'teacher'];
const SCHOOL_PORTRAITS = ['grandma', 'mathteacher', 'peteacher', 'musicteacher', 'boyglasses', 'girlglasses', 'cafeteria', 'guard'];
const CALENDAR_PORTRAITS = ['foodblogger', 'shopblogger', 'university', 'infirmary'];
const REGULAR_STORIES = {
  laozhou: ['我在找一枚旧邮戳，想补齐当年寄给儿子的信封。', '儿子寄回来一叠信，我才发现他一封也没扔。', '缺的邮戳找到了，我打算把这些信装成一本。'],
  guifen: ['我想把家里的旧收音机拾掇出来，早市摆摊时听。', '修好以后能收到戏曲台了，隔壁摊也凑过来听。', '今天她们轮流点戏，我这摊倒成了早市的听戏角。'],
  xiaodoubao: ['小满想学踢毽子，我也只会两下。', '我教她先抛直，她已经追上我了。', '现在她踢得比我多。明天换她教我。'],
  qiangzi: ['我以前只想着赶紧转手，结果有一批表坏在手里。', '我开始挨个验表了，宁可少进几件。', '今天有人回来找我配表带，说上次买的还走得准。'],
  sundaye: ['我想找回一本小时候读过的连环画。', '找着一本同系列的，封底还有原主人写的名字。', '我孙女也爱看，我打算把这几本留给她。'],
};

const WHOLESALE = [
  { id: 'wh-noodles', footprint: { w: 1, h: 1 }, name: '干脆面', emoji: '🍜', cost: 2, value: 4, pack: 6 },
  { id: 'wh-soda', footprint: { w: 1, h: 2 }, name: '橘子汽水', emoji: '🥤', cost: 3, value: 5, pack: 6 },
  { id: 'wh-notebook', footprint: { w: 1, h: 1 }, name: '田字格本', emoji: '📒', cost: 4, value: 7, pack: 4 },
  { id: 'danzhu', footprint: { w: 1, h: 1 }, name: '玻璃弹珠', cost: 3, value: 6, pack: 4, unlock: 'clearance' },
  { id: 'kouqin', footprint: { w: 1, h: 2 }, name: '口琴', cost: 11, value: 19, pack: 2, unlock: 'receiving' },
  ...NEW_GOODS.map(item => ({ ...item, unlock: 'clearance' })),
  ...EXTRA_GOODS.map(item => ({ ...item, unlock: 'clearance' })),
];

// 按天轮换进价与缺货。同一天刷新或回档时供货条件一致。
const WHOLESALE_MARKET = {
  priceSteps: [0, 1, 0, -1, 0, 1, 0],
  shortageFromDay: 3,
  shortageCycle: 11,
};

// 按立绘图集从左到右的列编号。未单独绘制的角色复用同类立绘。
const PORTRAITS = {
  '初中生阿凯': 0, '放学的小学生': 0, '背书包的学生': 0,
  '桂芬婶': 1, '买菜路过的大姐': 1, '精打细算的阿姨': 1,
  '老周': 2, '神秘收藏家': 2,
  '豆豆妈': 3, '怀旧的年轻人': 3,
  '小豆包': 4, '来接孩子的爸爸': 5, '孙大爷': 6,
  '隔壁班女生': 7, '来买文具的女生': 7, '放学的学生': 7,
  '刚打完球的学生': 8, '强子': 9, '遛弯的刘叔': 9, '修车的许师傅': 9,
};

// 图集上的部位坐标，按单面图片的百分比定位。
const HANDHELD_INSPECTION = [
  [{ index: 0, x: 53, y: 32 }, { index: 1, x: 65, y: 64 }],
  [{ index: 2, x: 47, y: 65 }, { index: 3, x: 47, y: 31 }],
];

// 按图集行序排列，每行四件。掌机沿用原有正背面图片。
const ITEM_ATLASES = [
  ['shanka', 'baowan', 'tuoluo', 'siduche', 'youyouqiu', 'cidai', 'suishenting', 'shanzhaibiao',
    'gangbi', 'lianhuanhua', 'danzhu', 'kadai', 'chongwuji', 'youpiao', 'shouyinji', 'tangcibei'],
  ['shanzhaixie', 'youxiwangka', 'cidianci', 'xiangji', 'fuduji', 'shouban', 'jinianci', 'huaban',
    'kouqin', 'huaibiao', 'suanpan', 'jinianzhang', 'wh-noodles', 'wh-soda', 'wh-notebook', 'jinlong'],
];
const ITEM_ART = Object.fromEntries(ITEM_ATLASES.flatMap((ids, sheet) =>
  ids.map((id, slot) => [id, { sheet, col: slot % 4, row: Math.floor(slot / 4) }])));

const ITEM_INSPECTION = {
  shanka: [[50, 45], [80, 68], [32, 32], [30, 72]],
  baowan: [[30, 58], [72, 66], [57, 41], [39, 29]],
  tuoluo: [[26, 45], [53, 56], [71, 69], [56, 30]],
  siduche: [[48, 39], [51, 75], [71, 43], [28, 58]],
  youyouqiu: [[51, 49], [30, 65], [73, 63], [48, 26]],
  cidai: [[30, 50], [75, 72], [47, 25], [64, 50]],
  suishenting: [[33, 42], [72, 40], [65, 73], [31, 70]],
  shanzhaibiao: [[45, 36], [72, 65], [45, 77], [27, 55]],
  gangbi: [[23, 68], [76, 33], [62, 70], [45, 45]],
  lianhuanhua: [[57, 34], [73, 61], [28, 49], [47, 75]],
  danzhu: [[45, 48], [65, 34], [26, 55], [66, 67]],
  kadai: [[48, 42], [48, 74], [71, 60], [26, 50]],
  chongwuji: [[49, 44], [50, 66], [73, 68], [52, 21]],
  youpiao: [[28, 57], [73, 70], [48, 34], [50, 57]],
  shouyinji: [[72, 44], [56, 23], [30, 48], [54, 72]],
  tangcibei: [[43, 29], [41, 52], [42, 75], [72, 50]],
  shanzhaixie: [[58, 34], [43, 50], [56, 67], [79, 76]],
  youxiwangka: [[68, 72], [50, 45], [28, 29], [72, 30]],
  cidianci: [[55, 68], [51, 30], [31, 49], [74, 51]],
  xiangji: [[51, 53], [69, 28], [27, 53], [74, 67]],
  fuduji: [[29, 40], [56, 26], [68, 56], [39, 72]],
  shouban: [[52, 28], [52, 50], [49, 78], [73, 60]],
  jinianci: [[25, 51], [49, 44], [62, 68], [78, 36]],
  huaban: [[40, 42], [70, 65], [32, 64], [63, 33]],
  kouqin: [[30, 50], [48, 28], [59, 50], [70, 71]],
  huaibiao: [[28, 54], [70, 65], [48, 45], [72, 29]],
  suanpan: [[36, 36], [55, 56], [26, 65], [72, 34]],
  jinianzhang: [[49, 51], [27, 55], [69, 36], [69, 71]],
};

const CONDITION = {
  mint: { name: '新品', color: 'gold', factor: 1 },
  used: { name: '二手', color: 'blue', factor: .8 },
  broken: { name: '破损', color: 'green', factor: .65 },
  defective: { name: '残次', color: 'white', factor: .55 },
  fresh: { name: '新生产', color: 'gold', factor: 1 },
  normal: { name: '正常', color: 'purple', factor: 1 },
  near: { name: '临期', color: 'blue', factor: .75 },
  expired: { name: '过期', color: 'green', factor: .5 },
  spoiled: { name: '坏了', color: 'white', factor: .25 },
};
const FOOD_LIFE = { ...Object.fromEntries([...NEW_GOODS, ...EXTRA_GOODS].filter(item => item.life).map(item => [item.id, item.life])), 'wh-noodles': 5, 'wh-soda': 7 };
// 完成的付现柜台小票数与已经收摊的天数，两个条件都要达到。
const MILESTONES = {
  organizer: [2, 1],
  clearance: [6, 3],
  poke: [10, 4],
  receiving: [16, 6],
  ledger: [22, 8],
  sticker: [28, 10],
  premium: [36, 13],
  grill: [44, 15],
  delivery: [50, 17],
};
const SERVICE_NAMES = {
  delivery: '外卖',
  organizer: '街坊宣传', clearance: '临期促销', poke: '戳戳乐', receiving: '收货鉴定',
  ledger: '熟客赊账', sticker: '集贴纸', premium: '高价货交易', grill: '烤肠机',
};
const TUTORIALS = [
  { id: 'delivery', unlock: 'delivery', title: '接外卖订单', text: '点右上角「外卖」接单。两个顾客回合内配好货，随后等骑手来取，交单后获得货款、服务费与口碑进度。' },
  { id: 'customers', unlock: 'organizer', title: '顾客图鉴', tab: 'customers', action: '看图鉴', text: '在顾客图鉴里查看来店次数和已听过的故事。部分顾客在第 1、3、5 次来店时会讲到后续。' },
  { id: 'new-goods', unlock: 'clearance', title: '供货商新一批货', tab: 'wholesale', action: '看新货', text: '辣条、汽水、文具和玩具等新货已上架。不同顾客会优先挑自己喜欢的商品。' },
  { id: 'opening', title: '第一次开店', tab: 'wholesale', action: '去备货', text: '先向供货商订一批干脆面或汽水，再点「开店」。顾客会自动走到柜台并开口，按要求拿货、确认小票。接待完就可以收摊。' },
  { id: 'organizer', unlock: 'organizer', title: '请小梁帮忙宣传', text: '点右上角「社区小梁」，付费后当天多来两位买家。每天可宣传一次。' },
  { id: 'marbles', unlock: 'clearance', title: '供货商上新 · 玻璃弹珠', tab: 'wholesale', action: '看新货', text: '供货商现在能订玻璃弹珠。点商品下方的进货按钮订一批，之后可在柜台卖出。' },
  { id: 'clearance', unlock: 'clearance', title: '处理临期食品', text: '有临期库存时，接待页面会出现促销区。点商品加到小票，默认是货架标价的七五折。顾客点名时仍要按要求拿货。' },
  { id: 'poke', unlock: 'poke', title: '挂上戳戳乐', tab: 'poke', action: '看洞洞板', text: '点柜台右侧的戳戳乐，选一个大奖并挂上新板。熟客有时会在结账后问能否戳一个洞。答应后由顾客选洞，收入在收摊时入账。' },
  { id: 'harmonica', unlock: 'receiving', title: '供货商上新 · 口琴', tab: 'wholesale', action: '看新货', text: '供货商现在能按批订口琴。进货前可比较今日进价与参考售价。' },
  { id: 'receiving', unlock: 'receiving', title: '收旧货前先验货', text: '从下次开店起会遇到卖家。点击物品上的标记查线索，每件最多查三处。验完按自己的判断报价，起价被拒后还有一次机会。' },
  { id: 'ledger', unlock: 'ledger', title: '给熟客记赊账', tab: 'ledger', action: '看赊账本', text: '提出赊账的熟客会在小票上出现「记赊账」。同意后可到赊账本看欠款和到期日，到期结果在收摊时结算。' },
  { id: 'sticker', unlock: 'sticker', title: '开集贴纸活动', tab: 'sticker', action: '看活动', text: '在集贴纸页打开活动，再选择投放几张金龙贴纸。投得越多，顾客越可能集齐，兑付和投诉在收摊时结算。' },
  { id: 'premium', unlock: 'premium', title: '开始交易高价货', text: '开店后可能遇到带贵重物件的卖家。收购前记得验货，并留够现金交租。洞洞板也多了高价大奖可选。' },
  { id: 'grill', unlock: 'grill', title: '用烤肠机做热食', tab: 'wholesale', action: '看烤肠机', text: '先从供货商买烤肠机，再订烤肠或丸子串。放上烤位后，每送走一位顾客推进一次火候。熟了或开花时可加到小票，未解冻和烤糊的不能卖。' },
];
// target 是要点击的操作，via 用于入口尚未展开时。
const TUTORIAL_ARROWS = {
  delivery: { target: '#open-delivery', hint: '查看外卖订单' },
  organizer: { target: '#shop-organizer', hint: '点小梁了解宣传' },
  marbles: { target: '[data-order="danzhu"]:enabled', via: '#open-wholesale', hint: '看看新到的玻璃弹珠' },
  clearance: { target: '[data-guide="clearance"] button', hint: '看看临期促销商品' },
  poke: { target: '#open-poke', hint: '打开洞洞板' },
  harmonica: { target: '[data-order="kouqin"]:enabled', via: '#open-wholesale', hint: '看看新到的口琴' },
  receiving: { target: '.inspection-marker:enabled', hint: '点击标记查看验货线索' },
  ledger: { target: '[data-tab="ledger"]', via: '#side > summary', hint: '打开赊账本' },
  sticker: { target: '[data-tab="sticker"]', via: '#side > summary', hint: '打开集贴纸活动' },
  premium: { target: '#bidInput', hint: '验货后填写你的报价' },
  grill: { target: '#buy-grill:enabled', via: '#open-wholesale', hint: '看看供货商的烤肠机' },
};
const NEIGHBORS = {
  mentor: { name: '邻居林姨', line: '先向供货商进货，再给放学的顾客结账。柜台卖得越多，能做的生意也会慢慢多起来。' },
  organizer: { name: '社区小梁', line: '我能帮你在街坊群里宣传，今天多来两位买家。', cost: 18, extraBuyers: 2 },
};
const GRILL = {
  cost: 180,
  capacity: 4,
  trayCapacity: 6,
  extraStudents: 2,
  studentNames: ['背书包的学生', '放学的学生'],
  stages: [
    { key: 'frozen', name: '未解冻', turns: 0, factor: 0 },
    { key: 'raw', name: '未熟', turns: 1, factor: .6, checkChance: .55 },
    { key: 'cooked', name: '熟了', turns: 2, factor: 1 },
    { key: 'bloom', name: '开花', turns: 3, factor: 1.25 },
    { key: 'burnt', name: '烤糊', turns: 5, factor: 0 },
  ],
  foods: [
    { id: 'grill-sausage', footprint: { w: 1, h: 1 }, name: '烤肠', emoji: '🌭', cat: '热食', cost: 2, pack: 8, value: 6 },
    { id: 'grill-ball', footprint: { w: 1, h: 1 }, name: '丸子串', emoji: '🍡', cat: '热食', cost: 3, pack: 6, value: 8 },
  ],
};
