import React, { useRef, useState } from 'react';
import { loggerService } from '../services/logger';

interface BugReportButtonProps {
  className?: string;
}

interface CanvasLayoutConfig {
  width: number;
  padding: number;
  lineHeight: number;
  maxHeight: number;
  maxTextWidth: number;
}

type ShareStatus = 'success' | 'cancel' | 'unsupported';
interface ProblemLogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: unknown[];
}

export const BugReportButton: React.FC<BugReportButtonProps> = ({ className = '' }) => {
  const [isLoading, setIsLoading] = useState(false);
  const lastTouchAtRef = useRef<number>(0);

  const handleBugReport = async (): Promise<void> => {
    if (isLoading) return;

    setIsLoading(true);
    console.info('[BugReport] Triggered');

    try {
      const recentLogs = getRecentLogs();
      const logLines = formatRecentLogLines(recentLogs);
      if (logLines.length === 0) {
        alert('暂无可用日志');
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `bug-report-${timestamp}.png`;
      const imageBlob = await renderLogImage(logLines);
      const shareStatus = await shareImageToAlbum(imageBlob, filename);

      if (shareStatus === 'success' || shareStatus === 'cancel') {
        return;
      }

      const copied = await copyToClipboard(logLines.join('\n'));
      if (copied) {
        alert('当前设备不支持图片分享，已自动复制日志文本。若仍需图片，请手动选择“保存图片”。');
        return;
      }

      const shouldSavePng = window.confirm(
        '当前设备不支持图片分享，且自动复制失败。是否最后尝试保存 PNG 文件？（部分 Chrome 设备可能保存到云盘）'
      );
      if (!shouldSavePng) {
        return;
      }

      saveImage(imageBlob, filename);
      alert('已触发 PNG 保存。');
    } catch (error) {
      console.error('[BugReport] Failed to generate report:', error);
      alert('生成报告失败，请刷新重试');
    } finally {
      setIsLoading(false);
    }
  };

  const getRecentLogs = (): ProblemLogEntry[] => {
    const logs = loggerService.getLogs();
    if (logs.length === 0) {
      return [];
    }

    return logs.slice(-200);
  };

  const formatRecentLogLines = (recentLogs: ProblemLogEntry[]): string[] => {
    if (recentLogs.length === 0) {
      return [];
    }

    const lines: string[] = [
      'Jump & Say Bug Report',
      `Generated: ${new Date().toLocaleString()}`,
      `Recent Logs: ${recentLogs.length}`,
      `UA: ${navigator.userAgent}`,
      '',
    ];

    recentLogs.forEach((entry) => {
      lines.push(`[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`);
      if (entry.data && entry.data.length > 0) {
        entry.data.forEach((datum) => {
          lines.push(`  -> ${safeStringify(datum)}`);
        });
      }
    });

    return lines;
  };

  const safeStringify = (value: unknown): string => {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch (error) {
      console.warn('[BugReport] Failed to stringify log payload:', error);
      return String(value);
    }
  };

  const copyToClipboard = async (text: string): Promise<boolean> => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        console.warn('[BugReport] Clipboard API copy failed:', error);
      }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    } catch (error) {
      document.body.removeChild(textarea);
      console.warn('[BugReport] Legacy copy failed:', error);
      return false;
    }
  };

  const renderLogImage = async (lines: string[]): Promise<Blob> => {
    const layout: CanvasLayoutConfig = {
      width: 1170,
      padding: 48,
      lineHeight: 34,
      maxHeight: 12000,
      maxTextWidth: 1170 - 96,
    };

    const measureCanvas = document.createElement('canvas');
    const measureContext = measureCanvas.getContext('2d');
    if (!measureContext) {
      throw new Error('Canvas context unavailable');
    }

    measureContext.font = '26px Menlo, Monaco, Consolas, monospace';

    const wrappedLines = wrapLines(lines, measureContext, layout.maxTextWidth);
    const maxRenderableLines = Math.max(1, Math.floor((layout.maxHeight - layout.padding * 2) / layout.lineHeight));
    const visibleLines = wrappedLines.slice(-maxRenderableLines);
    if (wrappedLines.length > visibleLines.length) {
      visibleLines[0] = `... 仅显示最近 ${visibleLines.length} 行（原始 ${wrappedLines.length} 行）`;
    }

    const height = layout.padding * 2 + visibleLines.length * layout.lineHeight;
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = Math.min(layout.maxHeight, height);

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas context unavailable');
    }

    context.fillStyle = '#0B1220';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = '26px Menlo, Monaco, Consolas, monospace';
    context.textBaseline = 'top';

    let y = layout.padding;
    visibleLines.forEach((line) => {
      if (line.includes('[ERROR]')) {
        context.fillStyle = '#FCA5A5';
      } else if (line.includes('[WARN]')) {
        context.fillStyle = '#FDE68A';
      } else if (line.startsWith('Jump & Say Bug Report')) {
        context.fillStyle = '#93C5FD';
      } else {
        context.fillStyle = '#E2E8F0';
      }

      context.fillText(line, layout.padding, y);
      y += layout.lineHeight;
    });

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('Failed to generate png blob'));
      }, 'image/png');
    });
  };

  const wrapLines = (
    lines: string[],
    context: CanvasRenderingContext2D,
    maxWidth: number
  ): string[] => {
    const wrapped: string[] = [];

    lines.forEach((line) => {
      if (!line) {
        wrapped.push('');
        return;
      }

      const chars = Array.from(line);
      let current = '';

      chars.forEach((char) => {
        const next = `${current}${char}`;
        if (context.measureText(next).width > maxWidth && current.length > 0) {
          wrapped.push(current);
          current = char;
          return;
        }

        current = next;
      });

      if (current.length > 0) {
        wrapped.push(current);
      }
    });

    return wrapped;
  };

  const shareImageToAlbum = async (blob: Blob, filename: string): Promise<ShareStatus> => {
    if (typeof navigator.share !== 'function' || typeof File === 'undefined') {
      return 'unsupported';
    }

    const file = new File([blob], filename, { type: 'image/png' });

    try {
      if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
        return 'unsupported';
      }

      await navigator.share({
        title: '保存日志长图到相册',
        text: '请在系统菜单中选择“保存图像/存储到相册”。',
        files: [file],
      });
      return 'success';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return 'cancel';
      }

      console.warn('[BugReport] Image share failed:', error);
      return 'unsupported';
    }
  };

  const saveImage = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  };

  const handlePress = (
    event?: React.MouseEvent<HTMLButtonElement> | React.TouchEvent<HTMLButtonElement>
  ): void => {
    if (event) {
      if (event.type === 'touchstart') {
        lastTouchAtRef.current = Date.now();
        if (typeof event.cancelable !== 'boolean' || event.cancelable) {
          event.preventDefault();
        }
      }

      if (event.type === 'click' && Date.now() - lastTouchAtRef.current < 700) {
        return;
      }

      event.stopPropagation();
    }

    void handleBugReport();
  };

  return (
    <button
      type="button"
      onTouchStart={handlePress}
      onClick={handlePress}
      disabled={isLoading}
      className={`fixed bottom-4 right-4 z-[9999] bg-black/15 hover:bg-black/30 disabled:bg-black/10 text-white/50 hover:text-white/80 rounded-full w-8 h-8 md:w-9 md:h-9 flex items-center justify-center backdrop-blur-md transition-all duration-300 hover:scale-110 active:scale-95 shadow-lg shadow-black/20 pointer-events-auto touch-manipulation ${className}`}
      title="设置"
    >
      {isLoading ? (
        <svg className="animate-spin w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )}
    </button>
  );
};
