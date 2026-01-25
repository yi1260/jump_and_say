
import { useEffect, useMemo, useState } from 'react';
import { getLocalAssetUrl, getR2AssetUrl } from '../src/config/r2Config';

const BACKGROUNDS = [
  'assets/kenney/Vector/Backgrounds/background_color_hills.svg',
  'assets/kenney/Vector/Backgrounds/background_color_trees.svg',
  'assets/kenney/Vector/Backgrounds/background_color_desert.svg',
  'assets/kenney/Vector/Backgrounds/background_clouds.svg',
  'assets/kenney/Vector/Backgrounds/background_fade_hills.svg',
  'assets/kenney/Vector/Backgrounds/background_fade_trees.svg',
  'assets/kenney/Vector/Backgrounds/background_fade_desert.svg'
];

interface GameBackgroundProps {
  currentIndex: number;
}

export default function GameBackground({ currentIndex }: GameBackgroundProps) {
  const bgSrc = useMemo(() => getR2AssetUrl(BACKGROUNDS[currentIndex % BACKGROUNDS.length]), [currentIndex]);
  const bgLocalSrc = useMemo(() => getLocalAssetUrl(bgSrc), [bgSrc]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState(bgSrc);

  useEffect(() => {
    console.log('GameBackground currentIndex:', currentIndex, 'bgSrc:', bgSrc);
    setIsLoaded(false);
    setResolvedSrc(bgSrc);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setIsLoaded(true);
    img.onerror = () => {
      if (bgLocalSrc === bgSrc) return;
      const localImg = new Image();
      localImg.onload = () => {
        setResolvedSrc(bgLocalSrc);
        setIsLoaded(true);
      };
      localImg.onerror = () => setIsLoaded(true);
      localImg.src = bgLocalSrc;
    };
    img.src = bgSrc;
  }, [bgSrc, bgLocalSrc, currentIndex]);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
      {isLoaded && (
        <img
          src={resolvedSrc}
          alt="background"
          className="w-full h-full object-cover"
          style={{ 
            imageRendering: 'auto',
            willChange: 'transform',
            transform: 'translateZ(0)'
          }}
        />
      )}
    </div>
  );
}
