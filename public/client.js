const socket = io();

const screenStart = document.getElementById('screen-start');
const screenGame = document.getElementById('screen-game');
const startError = document.getElementById('start-error');
const gameError = document.getElementById('game-error');

const roomCodeDisplay = document.getElementById('room-code-display');
const roleBadge = document.getElementById('role-badge');
const dealerCards = document.getElementById('dealer-cards');
const playerCards = document.getElementById('player-cards');
const dealerValueEl = document.getElementById('dealer-value');
const playerValueEl = document.getElementById('player-value');
const chipsDisplay = document.getElementById('chips-display');
const betDisplay = document.getElementById('bet-display');
const buyinLine = document.getElementById('buyin-line');
const banner = document.getElementById('banner');
const bannerText = document.getElementById('banner-text');
const gameoverModal = document.getElementById('gameover-modal');
const gameoverTitle = document.getElementById('gameover-title');
const gameoverDesc = document.getElementById('gameover-desc');

const hostPanel = document.getElementById('host-panel');
const betPanel = document.getElementById('bet-panel');
const actionPanel = document.getElementById('action-panel');
const inputBet = document.getElementById('input-bet');
const chipTray = document.getElementById('chip-tray');
const btnCashout = document.getElementById('btn-cashout');

let lastPhase = null;
let startingChipsCache = 50000;

document.getElementById('btn-create').addEventListener('click', () => {
  clearErrors();
  const amount = parseInt(document.getElementById('input-starting-chips').value, 10);
  socket.emit('createRoom', amount);
});

document.getElementById('btn-join').addEventListener('click', () => {
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

document.getElementById('btn-home').addEventListener('click', () => {
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

function renderCards(container, hand) {
  container.innerHTML = '';
  hand.forEach((card) => {
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
    container.appendChild(el);
  });
}

function fmt(n) {
  return Number(n || 0).toLocaleString('ko-KR');
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
      const current = parseInt(inputBet.value, 10) || 0;
      inputBet.value = current + v;
    });
    chipTray.appendChild(btn);
  });
}

function render(state) {
  renderCards(dealerCards, state.dealerHand);
  renderCards(playerCards, state.playerHand);

  dealerValueEl.textContent = state.dealerValue !== null ? state.dealerValue : ' ';
  playerValueEl.textContent = state.playerHand.length ? state.playerValue : ' ';

  chipsDisplay.textContent = fmt(state.playerChips);
  betDisplay.textContent = fmt(state.bet);
  startingChipsCache = state.startingChips || startingChipsCache;
  buyinLine.textContent = `시작 금액 ${fmt(state.startingChips)}원 · 2배(${fmt(state.startingChips * 2)}원) 달성 시 칩 교환 가능`;

  hostPanel.classList.add('hidden');
  betPanel.classList.add('hidden');
  actionPanel.classList.add('hidden');
  btnCashout.classList.add('hidden');
  gameoverModal.classList.remove('show');

  if (state.phase === 'gameover') {
    const isPlayerWin = state.finalOutcome === 'player';
    gameoverTitle.textContent = isPlayerWin ? 'PLAYER WIN' : 'DEALER WIN';
    gameoverDesc.textContent = state.message;
    gameoverModal.classList.add('show');
    lastPhase = state.phase;
    return;
  }

  if (state.phase !== lastPhase && (state.phase === 'result')) {
    showBanner(state.message);
  } else if (state.phase === 'player' || state.phase === 'betting') {
    hideBanner();
  }
  lastPhase = state.phase;

  if (state.role === 'host') {
    hostPanel.classList.remove('hidden');
    return;
  }

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
