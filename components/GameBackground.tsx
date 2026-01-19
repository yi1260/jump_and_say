
import { useEffect, useMemo, useState } from 'react';

const BACKGROUNDS = [
  '/asserts/kenney/Vector/Backgrounds/background_color_hills.svg',
  '/asserts/kenney/Vector/Backgrounds/background_color_trees.svg',
  '/asserts/kenney/Vector/Backgrounds/background_color_desert.svg',
  '/asserts/kenney/Vector/Backgrounds/background_clouds.svg',
  '/asserts/kenney/Vector/Backgrounds/background_fade_hills.svg',
  '/asserts/kenney/Vector/Backgrounds/background_fade_trees.svg',
  '/asserts/kenney/Vector/Backgrounds/background_fade_desert.svg'
];

interface GameBackgroundProps {
  currentIndex: number;
}

export default function GameBackground({ currentIndex }: GameBackgroundProps) {
  const bgSrc = useMemo(() => BACKGROUNDS[currentIndex % BACKGROUNDS.length], [currentIndex]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    console.log('GameBackground currentIndex:', currentIndex, 'bgSrc:', bgSrc);
    setIsLoaded(false);
    const img = new Image();
    img.src = bgSrc;
    img.onload = () => setIsLoaded(true);
  }, [bgSrc, currentIndex]);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
      {isLoaded && (
        <img
          src={bgSrc}
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
