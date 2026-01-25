import React, { useState, useEffect } from 'react';
import { getLocalAssetUrl } from '@/src/config/r2Config';

interface ImgWithFallbackProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  fallbackSrc?: string;
}

export const ImgWithFallback: React.FC<ImgWithFallbackProps> = ({ src, fallbackSrc, ...props }) => {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setCurrentSrc(src);
    setHasError(false);
  }, [src]);

  const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    // If we haven't errored yet, try the fallback
    if (!hasError) {
      console.warn(`[ImgWithFallback] Failed to load ${currentSrc}, trying fallback...`);
      setHasError(true);
      
      // Use provided fallback or auto-generate local path
      const nextSrc = fallbackSrc || getLocalAssetUrl(currentSrc);
      
      if (nextSrc !== currentSrc) {
        setCurrentSrc(nextSrc);
      }
    } else {
      console.error(`[ImgWithFallback] Fallback also failed for ${src}`);
      // Allow parent onError to handle if needed
      if (props.onError) {
        props.onError(e);
      }
    }
  };

  return (
    <img 
      {...props} 
      src={currentSrc} 
      onError={handleError}
    />
  );
};
