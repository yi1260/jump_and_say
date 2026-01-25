import { AnimatePresence, motion } from 'framer-motion';
import React, { useEffect } from 'react';
import { getR2AssetUrl } from '../src/config/r2Config';

interface CompletionOverlayProps {
  score: number;
  total: number;
  isVisible: boolean;
}

const CompletionOverlay: React.FC<CompletionOverlayProps> = ({ score, total, isVisible }) => {
  const isPerfect = score === total;
  const feedbackText = isPerfect ? 'PERFECT!' : 'GREAT JOB!';

  // Handle voice and sound feedback
  useEffect(() => {
    if (isVisible) {
      // 1. Voice Feedback
      if ('speechSynthesis' in window) {
        const speak = () => {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(feedbackText);
          utterance.lang = 'en-US';
          utterance.pitch = 1.4;
          utterance.rate = 1.1;
          utterance.volume = 1.0;
          window.speechSynthesis.speak(utterance);
        };
        const voiceTimer = setTimeout(speak, 100);
        
        // 2. Rhythmic Star Sound Effects (Using Phaser's sound manager for best iOS compatibility)
        const soundTimers: NodeJS.Timeout[] = [];
        const phaserGame = (window as any).phaserGame;

        for (let i = 0; i < score; i++) {
          const timer = setTimeout(() => {
            if (phaserGame) {
              try {
                const scene = phaserGame.scene.getScene('MainScene');
                if (scene && scene.sound) {
                  scene.sound.play('sfx_bump', { volume: 1.0 });
                }
              } catch (e) {
                console.warn('Phaser sound play failed:', e);
              }
            }
          }, (0.8 + i * 0.4) * 1000);
          soundTimers.push(timer);
        }

        return () => {
          clearTimeout(voiceTimer);
          soundTimers.forEach(t => clearTimeout(t));
        };
      }
    }
  }, [isVisible, feedbackText, score]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1000] pointer-events-none flex flex-col items-center justify-center bg-black/70 overflow-hidden"
        >
          <motion.div
            initial={{ y: -100, opacity: 0, scale: 0.5 }}
            animate={{ 
              y: 0, 
              opacity: 1,
              scale: isPerfect ? [1, 1.1, 1] : 1
            }}
            transition={{ 
              y: { duration: 0.6, ease: "backOut" },
              scale: isPerfect ? { repeat: Infinity, duration: 2, ease: "easeInOut" } : { duration: 0.4 }
            }}
            className="mb-[4vh] md:mb-[8vh]"
          >
            <h1 className={`text-[6vw] md:text-[8vw] font-['Fredoka_One'] italic tracking-wider drop-shadow-[0_8px_0_#333333] ${
              isPerfect ? 'text-kenney-yellow' : 'text-white'
            }`}>
              {feedbackText}
            </h1>
          </motion.div>

          <div className="flex flex-wrap justify-center gap-[2vw] md:gap-[4vw] max-w-[80vw] mb-[4vh] md:mb-[8vh]">
            {Array.from({ length: total }).map((_, i) => (
              <motion.div
                key={i}
                initial={{ scale: 0, rotate: -30 }}
                 animate={{ 
                   scale: i < score ? [0, 1.2, 1] : 1, 
                   rotate: 0,
                   opacity: 1
                 }}
                 transition={{ 
                   scale: {
                     delay: 1.2 + i * 0.5,
                     duration: 0.5,
                     times: [0, 0.8, 1],
                     ease: "easeOut"
                   },
                   rotate: {
                     delay: 1.2 + i * 0.5,
                     duration: 0.5
                   },
                   opacity: {
                     delay: 1.2 + i * 0.5,
                     duration: 0.3
                   }
                 }}
              >
                <img 
                  src={getR2AssetUrl('assets/kenney/Vector/Tiles/star.svg')}
                  className={`w-[8vw] h-[8vw] md:w-[12vw] md:h-[12vw] drop-shadow-lg ${i < score ? '' : 'grayscale opacity-30 blur-[1px]'}`}
                  alt="Star"
                />
              </motion.div>
            ))}
          </div>

           <motion.div
             initial={{ y: 50, opacity: 0 }}
             animate={{ y: 0, opacity: 1 }}
             transition={{ delay: 2.0 + score * 0.6, duration: 0.5 }}
            className="bg-white rounded-full px-[4vw] md:px-[8vw] py-[2vh] md:py-[3vh] shadow-[0_6px_0_#333333] border-[4px] md:border-[6px] border-kenney-dark"
          >
            <span className="text-[4vw] md:text-[5vw] font-black text-kenney-orange tabular-nums">
              {score} / {total}
            </span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CompletionOverlay;
