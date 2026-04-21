/**
 * Platform Level Configuration
 *
 * Supports multi-book configuration for English learning gameplay.
 * Each book corresponds to one answer gate with ~8 questions from Round1.
 */

import type { ThemeQuestion } from '../../types';

export interface BookConfig {
  bookId: string;                 // Book identifier (e.g., 'raz-level-a-001')
  title: string;                  // Display title
  questions: ThemeQuestion[];     // Questions for this book (~8 items)
}

export interface ObstacleDef {
  type: 'spike' | 'platform' | 'spring';
  x: number;
  width?: number;
  height?: number;
}

export interface EnemyDef {
  type: 'slime';
  x: number;
  patrolRange: number; // Half-width of patrol area
}

export interface LevelGenerationResult {
  obstacles: ObstacleDef[];
  enemies: EnemyDef[];
  gatePositions: number[];
}

export interface LevelConfig {
  theme: string;                  // Theme ID ('grass' | 'sand' | 'snow')
  width: number;                  // Level width in pixels
  background: string;             // Background image key

  // Book/gate configuration
  books: BookConfig[];            // Books for this level (each = 1 gate)

  // Random generation settings
  obstaclesPerGate: number;       // Obstacles before each gate (e.g., 3)
  enemiesPerSection: number;      // Enemies between sections
}

/**
 * Level 1 - Grass Theme (草原入门)
 * 5 books = 5 answer gates, ~40 questions total
 */
export const level1Config: LevelConfig = {
  theme: 'grass',
  width: 5000,                    // Wider to accommodate 5 gates
  background: 'background_solid_grass',

  books: [
    {
      bookId: 'raz-a-001',
      title: 'Animals',
      questions: [
        { question: 'cat', image: 'assets/flashcards/cat.png', audio: 'audio/cat.mp3' },
        { question: 'dog', image: 'assets/flashcards/dog.png', audio: 'audio/dog.mp3' },
        { question: 'bird', image: 'assets/flashcards/bird.png', audio: 'audio/bird.mp3' },
        { question: 'fish', image: 'assets/flashcards/fish.png', audio: 'audio/fish.mp3' },
        { question: 'pig', image: 'assets/flashcards/pig.png', audio: 'audio/pig.mp3' },
        { question: 'cow', image: 'assets/flashcards/cow.png', audio: 'audio/cow.mp3' },
        { question: 'duck', image: 'assets/flashcards/duck.png', audio: 'audio/duck.mp3' },
        { question: 'frog', image: 'assets/flashcards/frog.png', audio: 'audio/frog.mp3' },
      ],
    },
    {
      bookId: 'raz-a-002',
      title: 'Colors',
      questions: [
        { question: 'red', image: 'assets/flashcards/red.png', audio: 'audio/red.mp3' },
        { question: 'blue', image: 'assets/flashcards/blue.png', audio: 'audio/blue.mp3' },
        { question: 'green', image: 'assets/flashcards/green.png', audio: 'audio/green.mp3' },
        { question: 'yellow', image: 'assets/flashcards/yellow.png', audio: 'audio/yellow.mp3' },
        { question: 'orange', image: 'assets/flashcards/orange.png', audio: 'audio/orange.mp3' },
        { question: 'purple', image: 'assets/flashcards/purple.png', audio: 'audio/purple.mp3' },
        { question: 'black', image: 'assets/flashcards/black.png', audio: 'audio/black.mp3' },
        { question: 'white', image: 'assets/flashcards/white.png', audio: 'audio/white.mp3' },
      ],
    },
    {
      bookId: 'raz-a-003',
      title: 'Food',
      questions: [
        { question: 'apple', image: 'assets/flashcards/apple.png', audio: 'audio/apple.mp3' },
        { question: 'banana', image: 'assets/flashcards/banana.png', audio: 'audio/banana.mp3' },
        { question: 'cake', image: 'assets/flashcards/cake.png', audio: 'audio/cake.mp3' },
        { question: 'milk', image: 'assets/flashcards/milk.png', audio: 'audio/milk.mp3' },
        { question: 'bread', image: 'assets/flashcards/bread.png', audio: 'audio/bread.mp3' },
        { question: 'rice', image: 'assets/flashcards/rice.png', audio: 'audio/rice.mp3' },
        { question: 'egg', image: 'assets/flashcards/egg.png', audio: 'audio/egg.mp3' },
        { question: 'meat', image: 'assets/flashcards/meat.png', audio: 'audio/meat.mp3' },
      ],
    },
    {
      bookId: 'raz-a-004',
      title: 'Body',
      questions: [
        { question: 'head', image: 'assets/flashcards/head.png', audio: 'audio/head.mp3' },
        { question: 'shoulder', image: 'assets/flashcards/shoulder.png', audio: 'audio/shoulder.mp3' },
        { question: 'knee', image: 'assets/flashcards/knee.png', audio: 'audio/knee.mp3' },
        { question: 'toe', image: 'assets/flashcards/toe.png', audio: 'audio/toe.mp3' },
        { question: 'eye', image: 'assets/flashcards/eye.png', audio: 'audio/eye.mp3' },
        { question: 'ear', image: 'assets/flashcards/ear.png', audio: 'audio/ear.mp3' },
        { question: 'nose', image: 'assets/flashcards/nose.png', audio: 'audio/nose.mp3' },
        { question: 'mouth', image: 'assets/flashcards/mouth.png', audio: 'audio/mouth.mp3' },
      ],
    },
    {
      bookId: 'raz-a-005',
      title: 'Actions',
      questions: [
        { question: 'jump', image: 'assets/flashcards/jump.png', audio: 'audio/jump.mp3' },
        { question: 'run', image: 'assets/flashcards/run.png', audio: 'audio/run.mp3' },
        { question: 'walk', image: 'assets/flashcards/walk.png', audio: 'audio/walk.mp3' },
        { question: 'sit', image: 'assets/flashcards/sit.png', audio: 'audio/sit.mp3' },
        { question: 'stand', image: 'assets/flashcards/stand.png', audio: 'audio/stand.mp3' },
        { question: 'clap', image: 'assets/flashcards/clap.png', audio: 'audio/clap.mp3' },
        { question: 'sing', image: 'assets/flashcards/sing.png', audio: 'audio/sing.mp3' },
        { question: 'dance', image: 'assets/flashcards/dance.png', audio: 'audio/dance.mp3' },
      ],
    },
  ],

  obstaclesPerGate: 3,
  enemiesPerSection: 2,
};

/**
 * Generate random level elements based on configuration
 */
export function generateLevelElements(config: LevelConfig): LevelGenerationResult {
  const gateCount = config.books.length;
  const gatePositions: number[] = [];
  const obstacles: ObstacleDef[] = [];
  const enemies: EnemyDef[] = [];

  // Generate evenly-spaced gate positions
  const sectionWidth = config.width / (gateCount + 1);
  for (let i = 0; i < gateCount; i++) {
    // Add some randomness to gate position (+/- 100px)
    const baseX = sectionWidth * (i + 1);
    const randomOffset = (Math.random() - 0.5) * 200;
    gatePositions.push(Math.max(400, Math.min(config.width - 400, baseX + randomOffset)));
  }

  // Generate obstacles and enemies for each section
  for (let i = 0; i < gateCount; i++) {
    const gateX = gatePositions[i];
    const sectionStart = i === 0 ? 200 : gatePositions[i - 1] + 200;
    const sectionEnd = gateX - 150; // End before the gate's guide block

    // Generate obstacles before this gate
    for (let j = 0; j < config.obstaclesPerGate; j++) {
      const x = randomInRange(sectionStart + 100, sectionEnd - 50);
      const obstacleType = getRandomObstacleType();

      if (obstacleType === 'spike') {
        obstacles.push({ type: 'spike', x });
      } else if (obstacleType === 'platform') {
        // Create a floating platform at random height
        const height = randomInRange(100, 200);
        const width = randomInRange(2, 4);
        obstacles.push({ type: 'platform', x, width, height });
      } else if (obstacleType === 'spring') {
        obstacles.push({ type: 'spring', x });
      }
    }

    // Generate enemies in this section
    for (let j = 0; j < config.enemiesPerSection; j++) {
      // Ensure enemies don't overlap with obstacles
      const x = randomInRange(sectionStart + 50, sectionEnd - 100);
      const patrolRange = randomInRange(60, 120);

      enemies.push({
        type: 'slime',
        x,
        patrolRange,
      });
    }
  }

  return { obstacles, enemies, gatePositions };
}

function randomInRange(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

function getRandomObstacleType(): 'spike' | 'platform' | 'spring' {
  const types: ('spike' | 'platform' | 'spring')[] = ['spike', 'platform', 'spring'];
  return types[Math.floor(Math.random() * types.length)];
}
