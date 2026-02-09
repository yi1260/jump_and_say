import React from 'react';
import { getR2AssetUrl } from '@/src/config/r2Config';
import { ImgWithFallback } from './ImgWithFallback';

interface LoadingScreenProps {
  progress: number;
  status: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ progress, status }) => {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-kenney-blue/90 backdrop-blur-md p-4">
      <div className="loading-content non-game-scale text-center w-full max-w-2xl px-4 flex flex-col items-center gap-6 md:gap-8 transition-all duration-300">
        
        {/* Animated Character */}
        <div className="relative shrink-0">
           <ImgWithFallback 
             src={getR2AssetUrl('assets/kenney/Vector/Characters/character_pink_jump.svg')}
             className="loading-character animate-bounce drop-shadow-xl" 
             alt="Loading..." 
           />
        </div>

        {/* Content Container */}
        <div className="loading-text w-full flex flex-col items-center gap-6 md:gap-8">
          {/* Title */}
          <h2 className="loading-title font-black text-white italic tracking-tight uppercase drop-shadow-[0_4px_0_#333333]">
            LOADING ASSETS...
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
          <p className="loading-status text-white font-bold tracking-wide uppercase drop-shadow-md min-h-[1.5em] animate-pulse">
            {status}
          </p>
        </div>
      </div>
    </div>
  );
};
