/* 校园放学主题纯音乐：钟琴旋律与轻柔的分解和弦。 */
let shopAudio;
let musicOutput;
let effectsOutput;
let musicTimer;
let melodyStep = 0;
const SHOP_TUNE = [
  [76, 79, 81, 79, 76, null, 74, 72],
  [74, 76, 79, 76, 74, null, 71, null],
  [72, 76, 81, 84, 83, 81, 76, null],
  [77, 76, 74, 71, 72, null, 72, null],
];
const SHOP_CHORDS = [[48, 55, 60, 64], [43, 50, 59, 62], [45, 52, 57, 60], [41, 48, 55, 59]];

async function ensureShopAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return false;
  if (!shopAudio) {
    shopAudio = new Audio();
    musicOutput = shopAudio.createGain();
    effectsOutput = shopAudio.createGain();
    musicOutput.connect(shopAudio.destination);
    effectsOutput.connect(shopAudio.destination);
    effectsOutput.gain.value = .72;
  }
  await shopAudio.resume();
  return true;
}

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
  try {
    if (!await ensureShopAudio()) return notifyPlayer('当前环境无法播放背景音乐。');
    if (musicTimer) return;
    musicTimer = setInterval(playMusicNote, 330);
    setMusicVolume();
    playMusicNote();
    button.setAttribute('aria-pressed', 'true');
  } catch (error) {
    notifyPlayer('暂时无法播放背景音乐。');
  }
}

async function playRegisterSound() {
  try {
    if (!await ensureShopAudio()) return;
    const now = shopAudio.currentTime;
    const click = shopAudio.createOscillator();
    const clickGain = shopAudio.createGain();
    click.type = 'square';
    click.frequency.setValueAtTime(155, now);
    click.frequency.exponentialRampToValueAtTime(72, now + .055);
    clickGain.gain.setValueAtTime(.15, now);
    clickGain.gain.exponentialRampToValueAtTime(.0001, now + .07);
    click.connect(clickGain).connect(effectsOutput);
    click.start(now);
    click.stop(now + .08);

    [79, 84, 88].forEach((note, index) => {
      const oscillator = shopAudio.createOscillator();
      const gain = shopAudio.createGain();
      const start = now + .055 + index * .055;
      oscillator.type = 'sine';
      oscillator.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(.14 - index * .02, start + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .24);
      oscillator.connect(gain).connect(effectsOutput);
      oscillator.start(start);
      oscillator.stop(start + .26);
    });
  } catch (error) { /* 浏览器禁止音频时保持静默，不影响交易 */ }
}

async function playServiceBellSound() {
  try {
    if (!await ensureShopAudio()) return;
    const now = shopAudio.currentTime;
    // 上餐铃：一次短促机械敲击，加同一基音的金属泛音，不演奏旋律。
    const strikeBuffer = shopAudio.createBuffer(1, Math.max(1, Math.floor(shopAudio.sampleRate * .018)), shopAudio.sampleRate);
    const strikeData = strikeBuffer.getChannelData(0);
    for (let index = 0; index < strikeData.length; index++) strikeData[index] = (Math.random() * 2 - 1) * (1 - index / strikeData.length);
    const strike = shopAudio.createBufferSource();
    const strikeFilter = shopAudio.createBiquadFilter();
    const strikeGain = shopAudio.createGain();
    strike.buffer = strikeBuffer;
    strikeFilter.type = 'bandpass';
    strikeFilter.frequency.value = 4200;
    strikeFilter.Q.value = 1.8;
    strikeGain.gain.setValueAtTime(.22, now);
    strikeGain.gain.exponentialRampToValueAtTime(.0001, now + .025);
    strike.connect(strikeFilter).connect(strikeGain).connect(effectsOutput);
    strike.start(now);
    strike.stop(now + .025);
    [1860, 2670, 4190, 5830].forEach((frequency, index) => {
      const oscillator = shopAudio.createOscillator();
      const gain = shopAudio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.18 / (index + 1), now + .003);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .58 - index * .07);
      oscillator.connect(gain).connect(effectsOutput);
      oscillator.start(now);
      oscillator.stop(now + .62);
    });
  } catch (error) { /* 浏览器禁止音频时保持静默，不影响叫号 */ }
}
