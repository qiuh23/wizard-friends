/** UI contracts contain only the current identity's permitted projection.
 * Authority state, credentials, the deck and random stream never cross here. */
export type Suit = 'blue' | 'red' | 'green' | 'yellow';
export interface CardView { id?: string; kind: 'number' | 'wizard' | 'jester'; suit?: Suit; rank?: number }
export interface PlayerView {
  id: string; name: string; online: boolean; bot: boolean; botDifficulty?: string;
  nicknameId?: string; nicknameBadge?: number; automaticName?: boolean;
  score: number; matchWins?: number; won: number; bid: number | null;
  bidSubmitted: boolean; count: number; hand?: CardView[];
}
export interface RuleOptions {
  deckMode: 'standard' | 'mono'; predictionMode: 'public' | 'hidden' | 'secret';
  strict: boolean; foresight: boolean; short: boolean;
}
export interface RoundResult { id: string; bid: number | null; won: number; delta: number; total: number; bidSubmitted?: boolean }
export interface GameView {
  phase: 'lobby' | 'rules' | 'trump' | 'bid' | 'play' | 'trickEnd' | 'roundEnd' | 'finished';
  players: PlayerView[]; options: RuleOptions; round: number; maxRounds: number;
  cardsPerRound: number; completedTricks: number; dealer: number; turn: number; lastWinner: number;
  trump: Suit | null; reveal: CardView | null; legal: string[]; canBid: boolean; bids: number[];
  foresightActive: boolean; spectatorCount?: number; turnDeadline?: number;
  trick: {player: number; card: CardView}[];
  history: {round: number; cardsPerRound?: number; result: RoundResult[]}[];
  log: string[];
  lifecycle?: {
    paused?: boolean; pauseReason?: string; hostOffline?: boolean; closeAfterRound?: boolean;
    reconnecting?: boolean; retentionDeadline?: number; resultsConfirmed?: string[];
    reviewRemainingMs?: number; nextTrickAt?: number;
    continuationVote?: { accepted: string[]; voters: string[]; deadline: number };
  };
}
export type HandSort = 'suit' | 'rank';
export interface UIModel {
  state: GameView | null; me: string; domestic: boolean; practice: boolean; spectating: boolean;
  isHost: boolean; networkReady: boolean; room: string; publicCode: string; invitation: string; lobbyURL: string;
  nickname: string; busy: boolean; joinOpen: boolean; joinDraft: string | null; roomInput: string;
  returnRooms: {room: string; role: string}[]; practiceSaved: boolean;
  lobbyPanel: string; preferredBotDifficulty: string; status: string;
  selectedCard: string | null; hoveredCard: string | null; handExpanded: boolean; handCollapsed: boolean;
  handSort: HandSort; foresightSort: HandSort | null; pendingPlay: boolean; pendingSettlement: boolean;
  scoresOpen: boolean; menuOpen: boolean; scoreSource: string | null; settingsOpen: boolean; rulesOpen: boolean;
  turnSound: boolean; renderEpoch: number;
  cardTiming: (id?: string) => {enterMs: number; collectMs: number | null};
}
export type RoomModel = UIModel & {state: GameView};
