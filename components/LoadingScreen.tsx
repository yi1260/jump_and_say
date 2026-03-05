import React from 'react';
import { getR2AssetUrl } from '@/src/config/r2Config';
import { ImgWithFallback } from './ImgWithFallback';

interface LoadingScreenProps {
  progress: number;
  status: string;
  isReady: boolean;
  onPrimeAudio?: () => void;
  onStart?: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  progress,
  status,
  isReady,
  onPrimeAudio,
  onStart
}) => {
  const title = isReady ? '准备完成' : '正在准备中...';
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-kenney-blue/90 backdrop-blur-md p-4">
      <div className="loading-content non-game-scale text-center w-full max-w-2xl px-4 flex flex-col items-center gap-4 md:gap-5 transition-all duration-300">
        
        {/* Animated Character */}
        <div className="relative shrink-0">
           <ImgWithFallback 
             src={getR2AssetUrl('assets/kenney/Vector/Characters/character_pink_jump.svg')}
             className="loading-character animate-bounce drop-shadow-xl" 
             alt="加载中" 
           />
        </div>

        {/* Content Container */}
        <div className="loading-text w-full flex flex-col items-center gap-3 md:gap-4">
          {/* Title */}
          <h2 className="loading-title font-black text-white tracking-[0.03em]">
            {title}
          </h2>

          {/* Progress Bar Container */}
          <div className="loading-bar w-full bg-black/20 rounded-full p-1.5 md:p-2 backdrop-blur-sm border-[3px] md:border-[4px] border-white shadow-inner relative overflow-hidden">
            {/* Progress Bar Fill */}
            <div 
              className="h-full bg-kenney-green rounded-full shadow-[inset_0_2px_0_rgba(255,255,255,0.4)] transition-all duration-300 ease-out relative overflow-hidden flex items-center justify-end pr-2"
              style={{ width: `${Math.max(5, progress)}%` }}
            >
               {/* Shine Effect */}
               <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent"></div>
            </div>
          </div>

          {/* Status Text */}
          <p className="loading-status text-white font-bold tracking-[0.02em] min-h-[1.5em]">
            {status || '正在加载中...'}
          </p>

          {isReady && onStart && (
            <button
              onTouchStart={() => {
                if (onPrimeAudio) onPrimeAudio();
              }}
              onClick={onStart}
              className="kenney-button kenney-button-handdrawn mobile-landscape-button mt-1 md:mt-2 w-full max-w-[min(88vw,320px)] px-5 sm:px-6 md:px-10 py-2 sm:py-2.5 md:py-3 text-base sm:text-lg md:text-xl shadow-2xl"
            >
              开始闯关
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
