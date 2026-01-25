export interface MotionState {
  x: number; // 0 = center, -1 = left, 1 = right
  bodyX: number; // 0..1, mirrored to match Live View (0=left, 1=right)
  isJumping: boolean;
  rawNoseX: number;
  rawNoseY: number;
  rawShoulderY: number;
  smoothedState?: MotionState; // Optional recursive reference for smoothed state
}

export interface QuestionData {
  question: string;
  answers: string[]; // 3 answers
  correctIndex: number;
}

export enum GamePhase {
  MENU = 'MENU',
  THEME_SELECTION = 'THEME_SELECTION',
  LOADING = 'LOADING',
  LOADING_AI = 'LOADING_AI',
  CALIBRATING = 'CALIBRATING',
  TUTORIAL = 'TUTORIAL',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER'
}

export type ThemeId = string;

export interface ThemeQuestion {
  question: string;
  image: string;
}

export interface Theme {
  id: string;
  name: string;
  icon: string;
  questions: ThemeQuestion[];
  isAvailable?: boolean;
}

export interface ThemeList {
  themes: Theme[];
}

export interface GameScore {
  current: number;
  high: number;
}
