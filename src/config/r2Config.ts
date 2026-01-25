export const R2_BASE_URL = 'https://cdn.maskmysheet.com';

export const getR2ImageUrl = (imagePath: string): string => {
  // Theme images are likely in the root or a specific folder, assuming current behavior matches requirements
  // If theme images are also moved, this might need adjustment. 
  // Based on user input, only 'assets' and 'mediapipe' were mentioned.
  // Assuming 'raz_aa' prefix is removed from the bucket structure based on S3 paths provided.
  return `${R2_BASE_URL}/raz_aa/${imagePath}`;
};

export const getR2AssetUrl = (path: string): string => {
  // Remove leading slash if present
  let cleanPath = path.startsWith('/') ? path.substring(1) : path;
  
  // Replace local 'assets' directory name with CDN 'assets' directory name
  // Also handle cases where user might have already updated code to 'assets/'
  if (cleanPath.startsWith('assets/')) {
    cleanPath = cleanPath.replace('assets/', 'assets/');
  }
  
  return `${R2_BASE_URL}/${cleanPath}`;
};

export const getLocalAssetUrl = (path: string): string => {
  // Determine local path based on input path
  let cleanPath = path;
  
  // If it's a full URL, strip the domain
  if (cleanPath.startsWith('http')) {
      try {
          const url = new URL(cleanPath);
          cleanPath = url.pathname;
      } catch (e) {
          // If invalid URL, keep as is or try to clean up
          console.warn('[getLocalAssetUrl] Invalid URL:', cleanPath);
      }
  }

  // Ensure it starts with / for local serving
  if (!cleanPath.startsWith('/')) {
      cleanPath = '/' + cleanPath;
  }
  
  // If it already has /assets, good. If it has /raz_aa (themes), we might need to map it?
  // For now, assuming local structure mirrors CDN pathing for /assets.
  // Theme images might not be available locally if they are only on R2.
  // But for 'assets/kenney/...', it maps to '/assets/kenney/...' which is correct.
  
  return cleanPath;
};

export const getR2ThemesListUrl = (): string => {
  return '/themes/themes-list.json';
};

export const handleR2Error = (error: unknown, context: string): never => {
  console.error(`[R2 Error] ${context}:`, error);
  
  if (error instanceof Error) {
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error(`网络连接失败，请检查网络设置: ${context}`);
    }
    if (error.message.includes('404')) {
      throw new Error(`资源未找到: ${context}`);
    }
  }
  
  throw new Error(`加载资源失败: ${context}`);
};
