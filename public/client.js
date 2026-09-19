const socket = io();

const screenStart = document.getElementById('screen-start');
const screenGame = document.getElementById('screen-game');
const startError = document.getElementById('start-error');
const gameError = document.getElementById('game-error');

const table = document.getElementById('table');
const roomCodeDisplay = document.getElementById('room-code-display');
const roleBadge = document.getElementById('role-badge');
const dealerCards = document.getElementById('dealer-cards');
const playerCards = document.getElementById('player-cards');
const dealerValueEl = document.getElementById('dealer-value');
const playerValueEl = document.getElementById('player-value');
const chipsLabel = document.getElementById('chips-label');
const chipsDisplay = document.getElementById('chips-display');
const chipsDelta = document.getElementById('chips-delta');
const betLabel = document.getElementById('bet-label');
const betDisplay = document.getElementById('bet-display');
const buyinLine = document.getElementById('buyin-line');
const banner = document.getElementById('banner');
const bannerText = document.getElementById('banner-text');
const gameoverModal = document.getElementById('gameover-modal');
const gameoverTitle = document.getElementById('gameover-title');
const gameoverDesc = document.getElementById('gameover-desc');
const turnTimerEl = document.getElementById('turn-timer');

const hostPanel = document.getElementById('host-panel');
const betPanel = document.getElementById('bet-panel');
const actionPanel = document.getElementById('action-panel');
const inputBet = document.getElementById('input-bet');
const chipTray = document.getElementById('chip-tray');
const btnCashout = document.getElementById('btn-cashout');
const btnPeek = document.getElementById('btn-peek');
const playerBetChip = document.getElementById('player-bet-chip');

let startingChipsCache = 50000;
let currentTurnDeadline = null;
let prevDealerCount = 0;
let prevPlayerCount = 0;
let prevPhase = null;
let chipsBeforeRound = null;

// ---- 사운드 (합성음, 느리게) ----
let audioCtx = null;
function ensureAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    else if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}
function beep(freq, dur, type, peak, delay) {
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime + (delay || 0);
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak || 0.12, t0 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch (e) {}
}
function noiseSwoosh(dur) {
  if (!audioCtx) return;
  try {
    dur = dur || 0.45;
    const bufferSize = Math.floor(audioCtx.sampleRate * dur);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    const t0 = audioCtx.currentTime;
    filter.frequency.setValueAtTime(1200, t0);
    filter.frequency.exponentialRampToValueAtTime(2200, t0 + dur * 0.5);
    filter.frequency.exponentialRampToValueAtTime(600, t0 + dur);
    filter.Q.value = 0.7;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.09, t0 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    noise.connect(filter).connect(gain).connect(audioCtx.destination);
    noise.start(t0);
    noise.stop(t0 + dur + 0.05);
  } catch (e) {}
}
function sfxCard() { noiseSwoosh(0.45); }
function sfxChip() { beep(1200, 0.12, 'triangle', 0.07); beep(1500, 0.1, 'triangle', 0.06, 0.06); }
function sfxWin() { beep(520, 0.22, 'sine', 0.09); beep(700, 0.3, 'sine', 0.09, 0.2); }
function sfxLose() { beep(180, 0.4, 'sine', 0.08); }
function sfxPush() { beep(360, 0.22, 'sine', 0.06); }

document.getElementById('btn-create').addEventListener('click', () => {
  ensureAudio();
  clearErrors();
  const amount = parseInt(document.getElementById('input-starting-chips').value, 10);
  socket.emit('createRoom', amount);
});

document.getElementById('btn-join').addEventListener('click', () => {
  ensureAudio();
  clearErrors();
  const code = document.getElementById('input-code').value;
  if (!code.trim()) {
    startError.textContent = '방 코드를 입력하세요.';
    return;
  }
  socket.emit('joinRoom', code);
});

document.getElementById('input-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});

document.getElementById('btn-bet').addEventListener('click', () => {
  const amount = parseInt(inputBet.value, 10);
  clearErrors();
  socket.emit('placeBet', amount);
});

document.getElementById('btn-clear-bet').addEventListener('click', () => {
  inputBet.value = '';
});

inputBet.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-bet').click();
});

document.getElementById('btn-hit').addEventListener('click', () => {
  clearErrors();
  socket.emit('hit');
});

document.getElementById('btn-stand').addEventListener('click', () => {
  clearErrors();
  socket.emit('stand');
});

document.getElementById('btn-double').addEventListener('click', () => {
  clearErrors();
  socket.emit('doubleDown');
});

btnCashout.addEventListener('click', () => {
  clearErrors();
  socket.emit('cashOut');
});

btnPeek.addEventListener('click', () => {
  clearErrors();
  socket.emit('peekDealerCard');
});

document.getElementById('btn-home').addEventListener('click', () => {
  window.location.reload();
});

document.getElementById('btn-exit').addEventListener('click', () => {
  window.location.reload();
});

socket.on('roomCreated', ({ code }) => {
  enterGameScreen(code, 'host');
});

socket.on('joinSuccess', ({ code }) => {
  enterGameScreen(code, 'player');
});

socket.on('joinError', (msg) => {
  startError.textContent = msg;
});

socket.on('actionError', (msg) => {
  gameError.textContent = msg;
});

socket.on('info', (msg) => {
  showBanner(msg);
});

socket.on('roomClosed', (msg) => {
  alert(msg);
  window.location.reload();
});

socket.on('state', (state) => {
  render(state);
});

function enterGameScreen(code, role) {
  roomCodeDisplay.textContent = code;
  roleBadge.textContent = role === 'host' ? '방장 (딜러)' : '플레이어';
  table.classList.toggle('host-view', role === 'host');
  screenStart.classList.add('hidden');
  screenGame.classList.remove('hidden');
}

function clearErrors() {
  startError.textContent = '';
  gameError.textContent = '';
}

function suitClass(suit) {
  return suit === '♥' || suit === '♦' ? 'red' : '';
}

function cardSignature(card) {
  return card.hidden ? 'hidden' : `${card.rank}${card.suit}`;
}

function buildCardEl(card) {
  const el = document.createElement('div');
  if (card.hidden) {
    el.className = 'card hidden-card';
  } else {
    el.className = `card ${suitClass(card.suit)}`;
    el.innerHTML =
      `<div class="corner"><span>${card.rank}</span><span>${card.suit}</span></div>` +
      `<div class="pip">${card.suit}</div>` +
      `<div class="corner br"><span>${card.rank}</span><span>${card.suit}</span></div>`;
  }
  return el;
}

// 이미 놓인 카드는 그대로 두고, 새로 추가되거나(슬라이드 인) 공개된(뒤집기) 카드만 움직인다.
const cardCache = { dealer: [], player: [] };
function renderCards(container, hand, cacheKey) {
  const prevSigs = cardCache[cacheKey];
  const newSigs = hand.map(cardSignature);

  if (hand.length < prevSigs.length) {
    // 새 라운드 등으로 손패 수가 줄었으면 통째로 다시 그린다.
    container.innerHTML = '';
    hand.forEach((card, idx) => {
      const el = buildCardEl(card);
      el.classList.add('card-enter');
      el.style.animationDelay = `${idx * 250}ms`;
      container.appendChild(el);
    });
    cardCache[cacheKey] = newSigs;
    return;
  }

  for (let i = 0; i < prevSigs.length; i++) {
    if (prevSigs[i] !== newSigs[i]) {
      const el = buildCardEl(hand[i]);
      el.classList.add('card-flip');
      const existing = container.children[i];
      if (existing) existing.replaceWith(el);
      else container.appendChild(el);
    }
  }

  for (let i = prevSigs.length; i < hand.length; i++) {
    const el = buildCardEl(hand[i]);
    el.classList.add('card-enter');
    el.style.animationDelay = `${(i - prevSigs.length) * 250}ms`;
    container.appendChild(el);
  }

  cardCache[cacheKey] = newSigs;
}

function fmt(n) {
  return Number(n || 0).toLocaleString('ko-KR');
}

function setDelta(delta) {
  const cls = delta > 0 ? '' : delta < 0 ? 'loss' : 'zero';
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  chipsDelta.className = `readout-delta ${cls}`;
  chipsDelta.textContent = `${sign}${fmt(Math.abs(delta))}`;
}

function showBanner(text, sub) {
  bannerText.innerHTML = text + (sub ? `<span class="sub" style="display:block;font-size:12px;font-family:Manrope,sans-serif;font-weight:700;color:var(--cream-100);margin-top:4px;">${sub}</span>` : '');
  banner.classList.add('show');
}

function hideBanner() {
  banner.classList.remove('show');
}

function buildChipTray(startingChips, currentChips) {
  const multiplier = startingChips / 50000;
  const denoms = [1000, 5000, 10000, 25000].map((d) => Math.max(500, Math.round((d * multiplier) / 100) * 100));
  chipTray.innerHTML = '';
  denoms.forEach((v, idx) => {
    const btn = document.createElement('button');
    btn.className = `chip c${idx + 1}`;
    btn.textContent = fmt(v);
    btn.disabled = v > currentChips;
    btn.addEventListener('click', () => {
      ensureAudio();
      sfxChip();
      const current = parseInt(inputBet.value, 10) || 0;
      inputBet.value = current + v;
    });
    chipTray.appendChild(btn);
  });
}

// 턴 타이머를 매 250ms마다 갱신 (서버 브로드캐스트를 기다리지 않고 로컬에서 카운트다운)
setInterval(() => {
  if (currentTurnDeadline === null) {
    turnTimerEl.textContent = '';
    return;
  }
  const remaining = Math.max(0, Math.ceil((currentTurnDeadline - Date.now()) / 1000));
  turnTimerEl.textContent = `남은 시간 ${remaining}초`;
  turnTimerEl.classList.toggle('urgent', remaining <= 5);
}, 250);

function render(state) {
  const newDealerCount = state.dealerHand.length;
  const newPlayerCount = state.playerHand.length;
  if (newDealerCount > prevDealerCount || newPlayerCount > prevPlayerCount) {
    sfxCard();
  }
  prevDealerCount = newDealerCount;
  prevPlayerCount = newPlayerCount;

  renderCards(dealerCards, state.dealerHand, 'dealer');
  renderCards(playerCards, state.playerHand, 'player');

  dealerValueEl.textContent = state.dealerValue !== null ? state.dealerValue : ' ';
  playerValueEl.textContent = state.playerHand.length ? state.playerValue : ' ';

  if (state.role === 'host') {
    chipsLabel.textContent = '딜러 보유 칩';
    chipsDisplay.textContent = fmt(state.dealerChips);
    chipsDisplay.style.color = '';
    betLabel.textContent = '플레이어 보유 칩';
    betDisplay.textContent = fmt(state.playerChips);
    setDelta(state.dealerChips - state.startingChips * 10);
  } else {
    chipsLabel.textContent = '보유 칩';
    chipsDisplay.textContent = fmt(state.playerChips);
    chipsDisplay.style.color = '';
    betLabel.textContent = '현재 배팅';
    betDisplay.textContent = fmt(state.bet);
    setDelta(state.playerChips - state.startingChips);
  }
  startingChipsCache = state.startingChips || startingChipsCache;
  buyinLine.textContent = `시작 금액 ${fmt(state.startingChips)}원 · 2배(${fmt(state.startingChips * 2)}원) 달성 시 칩 교환 가능`;

  hostPanel.classList.add('hidden');
  betPanel.classList.add('hidden');
  actionPanel.classList.add('hidden');
  btnCashout.classList.add('hidden');
  gameoverModal.classList.remove('show');

  if (state.phase === 'gameover') {
    if (prevPhase !== 'gameover') {
      if (state.role === 'player') {
        if (state.finalOutcome === 'player') sfxWin();
        else sfxLose();
      }
    }
    const isPlayerWin = state.finalOutcome === 'player';
    gameoverTitle.textContent = isPlayerWin ? 'PLAYER WIN' : 'DEALER WIN';
    gameoverDesc.textContent = state.message;
    gameoverModal.classList.add('show');
    currentTurnDeadline = null;
    prevPhase = state.phase;
    return;
  }

  if (state.phase === 'dealer' || state.phase === 'dealing' || state.phase === 'result') {
    showBanner(state.message);
  } else if (state.phase === 'player' || state.phase === 'betting') {
    hideBanner();
  }

  if (state.phase === 'dealing' && prevPhase !== 'dealing') {
    chipsBeforeRound = state.playerChips;
  }
  if (state.phase === 'result' && prevPhase !== 'result' && state.role === 'player' && chipsBeforeRound !== null) {
    if (state.playerChips > chipsBeforeRound) sfxWin();
    else if (state.playerChips < chipsBeforeRound) sfxLose();
    else sfxPush();
  }

  currentTurnDeadline = state.phase === 'player' ? state.turnDeadline : null;
  prevPhase = state.phase;

  if (state.role === 'host') {
    hostPanel.classList.remove('hidden');
    if (state.bet > 0) {
      playerBetChip.textContent = `배팅 ${fmt(state.bet)}`;
      playerBetChip.classList.remove('hidden');
    } else {
      playerBetChip.classList.add('hidden');
    }
    const hasHiddenCard = state.dealerHand.some((c) => c.hidden);
    btnPeek.classList.toggle('hidden', !hasHiddenCard);
    return;
  }
  playerBetChip.classList.add('hidden');

  // 플레이어 화면
  if (state.phase === 'betting' || state.phase === 'result') {
    betPanel.classList.remove('hidden');
    inputBet.value = '';
    buildChipTray(state.startingChips, state.playerChips);
    if (state.canCashOut) {
      btnCashout.classList.remove('hidden');
    }
  } else if (state.phase === 'player') {
    actionPanel.classList.remove('hidden');
    document.getElementById('btn-double').disabled = !state.canDouble;
  } else if (state.phase === 'waiting') {
    showBanner('방장을 기다리는 중...');
  }
}
