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
