export const R2_BASE_URL = 'https://cdn.maskmysheet.com/raz_aa';

export const getR2ImageUrl = (imagePath: string): string => {
  return `${R2_BASE_URL}/${imagePath}`;
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
