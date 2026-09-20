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
const CASHOUT_THRESHOLD = 100000; // 시작 금액 대비 +-10만원이면 게임 종료 가능

class Room {
  constructor(code, hostId, startingChips = 50000) {
    this.code = code;
    this.hostId = hostId;
    this.playerId = null;
    this.deck = [];
    this.dealerHand = [];
    // hands: [{cards, bet, doubled, isSplitAces, canBeBlackjack, done}]
    this.hands = [];
    this.activeHandIndex = 0;
    this.startingChips = startingChips;
    this.playerChips = startingChips;
    this.dealerChips = startingChips * 10; // 딜러(방장) 보유 칩 — 플레이어 시작 금액의 10배
    this.bet = 0; // 이번 판 기준 배팅액(핸드당 최초 배팅)
    this.insuranceBet = 0;
    // phase: waiting | betting | dealing | insurance | player | dealer | result | gameover
    this.phase = 'waiting';
    this.message = '플레이어를 기다리는 중...';
    this.canDouble = false;
    this.canSplit = false;
    this.finalOutcome = null; // 'player' | 'dealer'
    this.dealerHoleRevealed = false;
    this.hostPeeked = false; // 방장이 "내 카드 보기"로 직접 확인했는지 (플레이어에게는 영향 없음)
    this.dealerStats = { blackjack: 0, bust: 0, '21': 0, '20': 0, '19': 0, '18': 0, '17': 0 };
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
      if (this.phase === 'player') this.stand();
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
      return { ok: false, error: '지금은 게임을 종료할 수 없습니다.' };
    }
    if (Math.abs(this.playerChips - this.startingChips) < CASHOUT_THRESHOLD) {
      return { ok: false, error: '아직 게임 종료 조건(시작 금액 대비 ±100,000원)을 달성하지 못했습니다.' };
    }
    this.phase = 'gameover';
    if (this.playerChips >= this.startingChips) {
      const profit = this.playerChips - this.startingChips;
      this.finalOutcome = 'player';
      this.message = `게임 종료! 플레이어 승리 (획득 +${profit.toLocaleString('ko-KR')}원, 최종 보유 ${this.playerChips.toLocaleString('ko-KR')}원)`;
    } else {
      const loss = this.startingChips - this.playerChips;
      this.finalOutcome = 'dealer';
      this.message = `게임 종료! 딜러 승리 (플레이어 ${loss.toLocaleString('ko-KR')}원 손실, 최종 보유 ${this.playerChips.toLocaleString('ko-KR')}원)`;
    }
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
    this.dealerHand = [];
    this.hands = [
      { cards: [], bet: this.bet, doubled: false, isSplitAces: false, canBeBlackjack: true, done: false },
    ];
    this.activeHandIndex = 0;
    this.dealerHoleRevealed = false;
    this.hostPeeked = false;
    this.insuranceBet = 0;
    this.canDouble = false;
    this.canSplit = false;
    this._emit();

    const order = ['player', 'dealer', 'player', 'dealer'];
    for (const who of order) {
      await sleep(INITIAL_DEAL_INTERVAL);
      const card = this.deck.pop();
      if (who === 'player') this.hands[0].cards.push(card);
      else this.dealerHand.push(card);
      this._emit();
    }

    const dealerUp = this.dealerHand[0];
    if (dealerUp.rank === 'A') {
      this.phase = 'insurance';
      this.message = '딜러가 에이스를 보여줍니다. 인슈어런스를 선택하세요.';
      this._emit();
      return;
    }

    this._afterDealPeek();
  }

  insuranceDecision(wantsInsurance) {
    if (this.phase !== 'insurance') {
      return { ok: false, error: '지금은 인슈어런스를 선택할 수 없습니다.' };
    }
    if (wantsInsurance) {
      const cost = Math.floor(this.bet / 2);
      if (cost > this.playerChips) {
        return { ok: false, error: '칩이 부족합니다.' };
      }
      this.insuranceBet = cost;
      this.playerChips -= cost;
    }
    this._afterDealPeek();
    return { ok: true };
  }

  _afterDealPeek() {
    const dealerBJ = isBlackjack(this.dealerHand);

    if (this.insuranceBet > 0 && dealerBJ) {
      this.playerChips += this.insuranceBet * 3; // 원금 + 2:1 배당
    }

    const hand0 = this.hands[0];
    const playerBJ = hand0.canBeBlackjack && isBlackjack(hand0.cards);

    if (dealerBJ || playerBJ) {
      this.phase = 'dealer';
      this.message = '딜러가 카드를 확인합니다...';
      this._resolveImmediate({ dealerBJ, playerBJ });
      return;
    }

    this.canDouble = this.playerChips >= hand0.bet;
    this.canSplit = hand0.cards[0].rank === hand0.cards[1].rank && this.playerChips >= hand0.bet;
    this.phase = 'player';
    this.message = '히트 또는 스탠드를 선택하세요.';
    this._startTurnTimer();
    this._emit();
  }

  hit() {
    if (this.phase !== 'player') return { ok: false, error: '지금은 히트할 수 없습니다.' };
    const hand = this.hands[this.activeHandIndex];
    if (hand.isSplitAces) return { ok: false, error: '스플릿 에이스는 카드를 추가할 수 없습니다.' };
    this._clearTurnTimer();
    hand.cards.push(this.deck.pop());
    if (handValue(hand.cards) >= 21) {
      this._advanceHand();
    } else {
      this.message = this.hands.length > 1 ? `히트 또는 스탠드를 선택하세요. (핸드 ${this.activeHandIndex + 1}/${this.hands.length})` : '히트 또는 스탠드를 선택하세요.';
      this._startTurnTimer();
      this._emit();
    }
    return { ok: true };
  }

  stand() {
    if (this.phase !== 'player') return { ok: false, error: '지금은 스탠드할 수 없습니다.' };
    this._clearTurnTimer();
    this._advanceHand();
    return { ok: true };
  }

  doubleDown() {
    if (this.phase !== 'player') return { ok: false, error: '지금은 더블다운할 수 없습니다.' };
    const hand = this.hands[this.activeHandIndex];
    const val = handValue(hand.cards);
    if (hand.cards.length !== 2 || hand.isSplitAces || val >= 21 || this.playerChips < hand.bet) {
      return { ok: false, error: '더블다운을 할 수 없습니다.' };
    }
    this._clearTurnTimer();
    this.playerChips -= hand.bet;
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(this.deck.pop());
    this._advanceHand();
    return { ok: true };
  }

  split() {
    if (this.phase !== 'player') return { ok: false, error: '지금은 스플릿할 수 없습니다.' };
    if (this.hands.length >= 2) return { ok: false, error: '스플릿은 한 번만 가능합니다.' };
    const hand = this.hands[this.activeHandIndex];
    if (hand.cards.length !== 2 || hand.cards[0].rank !== hand.cards[1].rank) {
      return { ok: false, error: '같은 숫자 카드만 스플릿할 수 있습니다.' };
    }
    if (this.playerChips < hand.bet) {
      return { ok: false, error: '칩이 부족합니다.' };
    }

    this._clearTurnTimer();
    this.playerChips -= hand.bet;
    const isAces = hand.cards[0].rank === 'A';
    const secondCard = hand.cards.pop();
    hand.cards.push(this.deck.pop());
    hand.isSplitAces = isAces;
    hand.canBeBlackjack = false;

    const newHand = {
      cards: [secondCard, this.deck.pop()],
      bet: hand.bet,
      doubled: false,
      isSplitAces: isAces,
      canBeBlackjack: false,
      done: false,
    };
    this.hands.push(newHand);
    this.canSplit = false;
    this.activeHandIndex = 0;
    this._emit();

    if (isAces) {
      // 스플릿 에이스는 각 핸드가 카드 1장만 받고 자동으로 종료된다.
      this._advanceHand();
    } else {
      this.canDouble = this.playerChips >= this.hands[0].bet && handValue(this.hands[0].cards) < 21;
      this.message = `히트 또는 스탠드를 선택하세요. (핸드 1/2)`;
      this._startTurnTimer();
      this._emit();
    }
    return { ok: true };
  }

  _advanceHand() {
    this.hands[this.activeHandIndex].done = true;
    const next = this.activeHandIndex + 1;
    if (next < this.hands.length) {
      this.activeHandIndex = next;
      const nextHand = this.hands[next];
      if (nextHand.isSplitAces) {
        this._advanceHand();
        return;
      }
      this.canDouble = this.playerChips >= nextHand.bet && handValue(nextHand.cards) < 21;
      this.message = `히트 또는 스탠드를 선택하세요. (핸드 ${next + 1}/${this.hands.length})`;
      this._startTurnTimer();
      this._emit();
      return;
    }

    this.phase = 'dealer';
    this._resolveRound();
  }

  async _resolveImmediate({ dealerBJ, playerBJ }) {
    this._emit();
    await sleep(DEALER_REVEAL_DELAY);
    this.dealerHoleRevealed = true;
    this._emit();
    await sleep(PRE_RESULT_DELAY);

    const hand0 = this.hands[0];
    let payout = 0;
    if (playerBJ && dealerBJ) {
      payout = hand0.bet;
      this.message = '둘 다 블랙잭! 푸시 (배팅금 반환)';
    } else if (playerBJ) {
      payout = Math.floor(hand0.bet * 2.5); // 원금 + 1.5배
      this.message = '블랙잭! 승리 (3:2 배당)';
    } else {
      payout = 0;
      this.message = '딜러 블랙잭! 패배';
    }

    if (dealerBJ) this._recordDealerStat('blackjack');

    this.playerChips += payout;
    this._finishRound();
  }

  async _resolveRound() {
    this.message = '딜러가 카드를 확인합니다...';
    this._emit();
    await sleep(DEALER_REVEAL_DELAY);
    this.dealerHoleRevealed = true;
    this._emit();

    const anyAlive = this.hands.some((h) => handValue(h.cards) <= 21);

    if (anyAlive) {
      while (handValue(this.dealerHand) < 17) {
        await sleep(DEALER_HIT_INTERVAL);
        this.dealerHand.push(this.deck.pop());
        this._emit();
      }
    }

    await sleep(PRE_RESULT_DELAY);

    const dealerVal = handValue(this.dealerHand);
    const dealerBusted = dealerVal > 21;

    let totalPayout = 0;
    const parts = [];
    this.hands.forEach((hand, idx) => {
      const val = handValue(hand.cards);
      const tag = this.hands.length > 1 ? `핸드${idx + 1} ` : '';
      if (val > 21) {
        parts.push(`${tag}버스트 패배`);
      } else if (dealerBusted) {
        totalPayout += hand.bet * 2;
        parts.push(`${tag}승리`);
      } else if (val > dealerVal) {
        totalPayout += hand.bet * 2;
        parts.push(`${tag}승리`);
      } else if (val < dealerVal) {
        parts.push(`${tag}패배`);
      } else {
        totalPayout += hand.bet;
        parts.push(`${tag}푸시`);
      }
    });

    if (anyAlive) {
      this._recordDealerStat(dealerBusted ? 'bust' : String(dealerVal));
    }

    this.message = `${parts.join(' · ')} (딜러 ${dealerBusted ? '버스트' : dealerVal})`;
    this.playerChips += totalPayout;
    this._finishRound();
  }

  _recordDealerStat(key) {
    if (this.dealerStats[key] !== undefined) {
      this.dealerStats[key] += 1;
    }
  }

  _finishRound() {
    const playerDelta = this.playerChips - this._roundStartChips;
    // 플레이어의 순증감만큼 딜러 칩은 반대로 움직인다 (플레이어가 따면 딜러는 마이너스)
    this.dealerChips -= playerDelta;
    this.phase = 'result';
    this.bet = 0;
    this.insuranceBet = 0;

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
      Math.abs(this.playerChips - this.startingChips) >= CASHOUT_THRESHOLD;

    return {
      code: this.code,
      role,
      phase: this.phase,
      message: this.message,
      bet: this.bet,
      insuranceBet: this.insuranceBet,
      startingChips: this.startingChips,
      playerChips: this.playerChips,
      dealerChips: this.dealerChips,
      canDouble: this.canDouble,
      canSplit: this.canSplit,
      canCashOut,
      finalOutcome: this.finalOutcome,
      turnDeadline: this.turnDeadline,
      activeHandIndex: this.activeHandIndex,
      hands: this.hands.map((h) => ({
        cards: h.cards,
        value: handValue(h.cards),
        bet: h.bet,
        done: h.done,
      })),
      dealerHand,
      dealerValue: dealerHiddenHole || this.dealerHand.length === 0 ? null : handValue(this.dealerHand),
      dealerStats: this.dealerStats,
      hasPlayer: !!this.playerId,
    };
  }
}

module.exports = { Room, createShuffledDeck, handValue, isBlackjack, isBust };
