// 블랙잭 게임 로직 (서버에서만 실행되는 순수 함수/클래스 모음)

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createShuffledDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return parseInt(rank, 10);
}

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += cardValue(card.rank);
    if (card.rank === 'A') aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}

function isBust(hand) {
  return handValue(hand) > 21;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 아주 느리게 — 한 단계씩 또렷하게 보이도록
const INITIAL_DEAL_INTERVAL = 900; // 초기 카드 한 장씩 나눠주는 간격
const DEALER_REVEAL_DELAY = 2600; // 히든 카드를 뒤집기 전 대기
const DEALER_HIT_INTERVAL = 2600; // 딜러가 카드를 한 장씩 받는 간격
const PRE_RESULT_DELAY = 1800; // 결과 발표 전 대기

const TURN_LIMIT_MS = 15000; // 플레이어 턴 제한시간

class Room {
  constructor(code, hostId, startingChips = 50000) {
    this.code = code;
    this.hostId = hostId;
    this.playerId = null;
    this.deck = [];
    this.playerHand = [];
    this.dealerHand = [];
    this.startingChips = startingChips;
    this.playerChips = startingChips;
    this.dealerChips = startingChips * 10; // 딜러(방장) 보유 칩 — 플레이어 시작 금액의 10배
    this.bet = 0;
    // phase: waiting(플레이어 대기) | betting(배팅 대기) | dealing(카드 분배 중) | player(플레이어 턴) | dealer(딜러 턴) | result(결과) | gameover(게임 종료)
    this.phase = 'waiting';
    this.message = '플레이어를 기다리는 중...';
    this.canDouble = false;
    this.finalOutcome = null; // 'player' | 'dealer'
    this.dealerHoleRevealed = false;
    this.hostPeeked = false; // 방장이 "내 카드 보기"로 직접 확인했는지 (플레이어에게는 영향 없음)
    this._roundStartChips = startingChips;
    this.turnTimer = null;
    this.turnDeadline = null;
    this.onUpdate = null; // 상태가 바뀔 때마다 호출되는 브로드캐스트 콜백
  }

  _emit() {
    if (this.onUpdate) this.onUpdate();
  }

  _startTurnTimer() {
    this._clearTurnTimer();
    this.turnDeadline = Date.now() + TURN_LIMIT_MS;
    this.turnTimer = setTimeout(() => {
      if (this.phase === 'player') {
        this.stand();
      }
    }, TURN_LIMIT_MS);
  }

  _clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.turnDeadline = null;
  }

  playerJoined(playerId) {
    this.playerId = playerId;
    this.phase = 'betting';
    this.message = '배팅해주세요.';
  }

  peekDealerCard() {
    if (this.dealerHand.length < 2) {
      return { ok: false, error: '아직 확인할 카드가 없습니다.' };
    }
    this.hostPeeked = true;
    this._emit();
    return { ok: true };
  }

  cashOut() {
    if (this.phase !== 'betting' && this.phase !== 'result') {
      return { ok: false, error: '지금은 칩 교환을 할 수 없습니다.' };
    }
    if (this.playerChips < this.startingChips * 2) {
      return { ok: false, error: '아직 칩 교환 조건을 달성하지 못했습니다.' };
    }
    const profit = this.playerChips - this.startingChips;
    this.phase = 'gameover';
    this.finalOutcome = 'player';
    this.message = `게임 종료! 플레이어 승리 (획득 +${profit.toLocaleString('ko-KR')}원, 최종 보유 ${this.playerChips.toLocaleString('ko-KR')}원)`;
    return { ok: true };
  }

  placeBet(amount) {
    if (this.phase !== 'betting' && this.phase !== 'result') {
      return { ok: false, error: '지금은 배팅할 수 없습니다.' };
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      return { ok: false, error: '올바른 배팅 금액을 입력하세요.' };
    }
    if (amount > this.playerChips) {
      return { ok: false, error: '칩이 부족합니다.' };
    }

    this.bet = amount;
    this._roundStartChips = this.playerChips;
    this.playerChips -= amount;
    this.phase = 'dealing';
    this.message = '카드를 나눠드립니다...';
    this._dealCards();

    return { ok: true };
  }

  async _dealCards() {
    this.deck = createShuffledDeck();
    this.playerHand = [];
    this.dealerHand = [];
    this.dealerHoleRevealed = false;
    this.hostPeeked = false;
    this._emit();

    const order = ['player', 'dealer', 'player', 'dealer'];
    for (const who of order) {
      await sleep(INITIAL_DEAL_INTERVAL);
      const card = this.deck.pop();
      if (who === 'player') this.playerHand.push(card);
      else this.dealerHand.push(card);
      this._emit();
    }

    this.canDouble = this.playerChips >= this.bet;

    const playerBJ = isBlackjack(this.playerHand);
    const dealerBJ = isBlackjack(this.dealerHand);

    if (playerBJ || dealerBJ) {
      this.phase = 'dealer';
      this.message = '딜러가 카드를 확인합니다...';
      this._resolveRound({ skipDealerDraw: true });
    } else {
      this.phase = 'player';
      this.message = '히트 또는 스탠드를 선택하세요.';
      this._startTurnTimer();
      this._emit();
    }
  }

  hit() {
    if (this.phase !== 'player') return { ok: false, error: '지금은 히트할 수 없습니다.' };
    this._clearTurnTimer();
    this.playerHand.push(this.deck.pop());
    this.canDouble = false;
    if (isBust(this.playerHand)) {
      this.phase = 'dealer';
      this._resolveRound({ skipDealerDraw: true, playerBusted: true });
    } else {
      this.message = '히트 또는 스탠드를 선택하세요.';
      this._startTurnTimer();
    }
    return { ok: true };
  }

  stand() {
    if (this.phase !== 'player') return { ok: false, error: '지금은 스탠드할 수 없습니다.' };
    this._clearTurnTimer();
    this.phase = 'dealer';
    this._resolveRound();
    return { ok: true };
  }

  doubleDown() {
    if (this.phase !== 'player') return { ok: false, error: '지금은 더블다운할 수 없습니다.' };
    if (!this.canDouble || this.playerHand.length !== 2) {
      return { ok: false, error: '더블다운을 할 수 없습니다.' };
    }
    this._clearTurnTimer();
    this.playerChips -= this.bet;
    this.bet *= 2;
    this.playerHand.push(this.deck.pop());
    this.canDouble = false;
    this.phase = 'dealer';
    if (isBust(this.playerHand)) {
      this._resolveRound({ skipDealerDraw: true, playerBusted: true });
    } else {
      this._resolveRound();
    }
    return { ok: true };
  }

  async _resolveRound({ skipDealerDraw = false, playerBusted = false } = {}) {
    this.message = playerBusted ? '버스트! 딜러가 카드를 확인합니다...' : '딜러가 카드를 확인합니다...';
    this._emit();
    await sleep(DEALER_REVEAL_DELAY);
    this.dealerHoleRevealed = true;
    this._emit();

    if (!skipDealerDraw) {
      while (handValue(this.dealerHand) < 17) {
        await sleep(DEALER_HIT_INTERVAL);
        this.dealerHand.push(this.deck.pop());
        this._emit();
      }
    }

    await sleep(PRE_RESULT_DELAY);

    const playerBJ = isBlackjack(this.playerHand);
    const dealerBJ = isBlackjack(this.dealerHand);
    const playerVal = handValue(this.playerHand);
    const dealerVal = handValue(this.dealerHand);

    let outcome; // 'player_blackjack' | 'push' | 'player_win' | 'dealer_win'
    let payout = 0;

    if (playerBusted) {
      outcome = 'dealer_win';
      this.message = `버스트! (${playerVal}) 딜러 승리`;
    } else if (playerBJ && dealerBJ) {
      outcome = 'push';
      payout = this.bet;
      this.message = '둘 다 블랙잭! 푸시 (배팅금 반환)';
    } else if (playerBJ) {
      outcome = 'player_blackjack';
      payout = Math.floor(this.bet * 2.5); // 원금 + 1.5배
      this.message = '블랙잭! 승리 (3:2 배당)';
    } else if (dealerBJ) {
      outcome = 'dealer_win';
      this.message = '딜러 블랙잭! 패배';
    } else if (isBust(this.dealerHand)) {
      outcome = 'player_win';
      payout = this.bet * 2;
      this.message = `딜러 버스트! (${dealerVal}) 승리`;
    } else if (playerVal > dealerVal) {
      outcome = 'player_win';
      payout = this.bet * 2;
      this.message = `승리! (${playerVal} vs ${dealerVal})`;
    } else if (playerVal < dealerVal) {
      outcome = 'dealer_win';
      this.message = `패배 (${playerVal} vs ${dealerVal})`;
    } else {
      outcome = 'push';
      payout = this.bet;
      this.message = `푸시 (${playerVal} vs ${dealerVal})`;
    }

    this.playerChips += payout;
    // 플레이어의 순증감만큼 딜러 칩은 반대로 움직인다 (플레이어가 따면 딜러는 마이너스)
    const playerDelta = this.playerChips - this._roundStartChips;
    this.dealerChips -= playerDelta;
    this.outcome = outcome;
    this.phase = 'result';
    this.bet = 0;

    if (this.playerChips <= 0) {
      this.phase = 'gameover';
      this.finalOutcome = 'dealer';
      this.message = '파산! 게임 종료 - 딜러 승리';
    }

    this._emit();
  }

  getState(role) {
    const isHost = role === 'host';
    const revealedForRole = this.dealerHoleRevealed || (isHost && this.hostPeeked);
    const dealerHiddenHole = this.dealerHand.length > 1 && !revealedForRole;
    const dealerHand = this.dealerHand.map((card, idx) => {
      if (dealerHiddenHole && idx === 1) {
        return { hidden: true };
      }
      return card;
    });

    const canCashOut =
      (this.phase === 'betting' || this.phase === 'result') &&
      this.playerChips >= this.startingChips * 2;

    return {
      code: this.code,
      role,
      phase: this.phase,
      message: this.message,
      bet: this.bet,
      startingChips: this.startingChips,
      playerChips: this.playerChips,
      dealerChips: this.dealerChips,
      canDouble: this.canDouble,
      canCashOut,
      finalOutcome: this.finalOutcome,
      turnDeadline: this.turnDeadline,
      playerHand: this.playerHand,
      playerValue: handValue(this.playerHand),
      dealerHand,
      dealerValue: dealerHiddenHole || this.dealerHand.length === 0 ? null : handValue(this.dealerHand),
      hasPlayer: !!this.playerId,
    };
  }
}

module.exports = { Room, createShuffledDeck, handValue, isBlackjack, isBust };
