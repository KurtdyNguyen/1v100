export interface Player {
  id: string;
  name: string;
  points: number;
  isHostPlayer?: boolean;
  isMainPlayer?: boolean;
  isEliminated?: boolean;
  joinedAt?: string;
}

export interface SocketEvents {
  'join-success': (playerData: Player) => void;
  'player-joined': (newPlayer: Player) => void;
  'player-list-update': (players: Player[]) => void;
  'player-left': (player: Player) => void;
  'join-error': (errorData: { message: string }) => void;
  'error': (message: string) => void;
  'start-game': () => void;
  'new-question': (questionData: any) => void;
  'main-player-selected': (data: { playerId: string; playerName: string }) => void;
  'question-ended': (result: any) => void;
  'game-ended': (result: any) => void;
  'player-eliminated': (player: Player) => void;
  'first-correct-answer': (data: { playerId: string; playerName: string }) => void;
  'new-host-player': (data: { playerId: string; playerName: string }) => void;
}

export interface Question {
  question: string;
  options: Array<{ abcd: string; text: string }>;
  timeLimit: number;
  phase: 'first-question' | 'main-game';
  mainPlayerId?: string | null;
  mainPlayerName?: string;
}

export type SocketCallback = (data: any) => void;