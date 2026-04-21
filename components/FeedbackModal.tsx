import { AnimatePresence, motion } from 'framer-motion';
import React, { useState } from 'react';

// 微信号配置
const WECHAT_ID = 'yi1260ofhust';

interface FeedbackModalProps {
  isVisible: boolean;
  onClose: () => void;
}

/**
 * 联系作者与打赏弹窗组件
 */
export const FeedbackModal: React.FC<FeedbackModalProps> = ({ isVisible, onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopyWechatId = async () => {
    if (!WECHAT_ID) return;
    try {
      await navigator.clipboard.writeText(WECHAT_ID);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', bounce: 0.4 }}
            className="relative bg-[#f8f9fa] w-full max-w-sm rounded-2xl md:rounded-3xl p-5 md:p-6 flex flex-col items-center shadow-2xl border-4 border-kenney-dark overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 装饰性背景 */}
            <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-kenney-blue/20 to-transparent pointer-events-none" />

            {/* 关闭按钮 */}
            <button
              onClick={onClose}
              className="absolute top-3 right-3 md:top-4 md:right-4 w-8 h-8 rounded-full bg-white hover:bg-red-50 border-2 border-kenney-dark flex items-center justify-center shadow-[0_2px_0_#333] active:translate-y-[2px] active:shadow-none transition-all z-10"
              aria-label="关闭"
            >
              <svg className="w-4 h-4 text-kenney-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>

            {/* 标题 */}
            <div className="flex flex-col items-center mb-6 mt-2 relative z-10">
              <span className="text-3xl mb-2 block animate-bounce" style={{ animationDuration: '2s' }}>👋</span>
              <h2 className="text-xl md:text-2xl font-black text-kenney-dark text-center tracking-wide">
                联系作者
              </h2>
              <p className="text-sm text-gray-500 mt-1.5 font-medium">交流反馈 · 感谢支持</p>
            </div>

            {/* 内容区域 */}
            <div className="w-full flex flex-col gap-4 relative z-10">
              {/* 微信号区域 */}
              <div className="bg-white rounded-xl p-3 md:p-4 border-2 border-gray-200 shadow-sm flex items-center justify-between group hover:border-kenney-blue transition-colors">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.555a.59.59 0 0 1 .213.646l-.39 1.48c-.019.077-.029.156-.029.235 0 .403.327.73.73.73.149 0 .293-.046.414-.132l1.865-1.108a.59.59 0 0 1 .503-.055c.992.292 2.062.451 3.183.451.264 0 .524-.012.781-.034-.147-.513-.225-1.052-.225-1.608 0-3.637 3.506-6.587 7.83-6.587.264 0 .524.012.781.034C17.318 4.338 13.44 2.188 8.691 2.188zm-2.67 4.78a.865.865 0 1 1 0 1.73.865.865 0 0 1 0-1.73zm5.34 0a.865.865 0 1 1 0 1.73.865.865 0 0 1 0-1.73z"/>
                      <path d="M23.996 14.972c0-3.39-3.261-6.147-7.28-6.147-4.02 0-7.28 2.757-7.28 6.147 0 3.39 3.26 6.147 7.28 6.147.878 0 1.723-.13 2.515-.373a.585.585 0 0 1 .498.054l1.479.878a.727.727 0 0 0 1.008-.65.727.727 0 0 0-.032-.209l-.308-1.17a.585.585 0 0 1 .212-.642c1.466-1.1 2.408-2.72 2.408-4.035zm-9.87-1.083a.686.686 0 1 1 0-1.372.686.686 0 0 1 0 1.372zm5.18 0a.686.686 0 1 1 0-1.372.686.686 0 0 1 0 1.372z"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 font-bold mb-0.5">微信沟通</div>
                    <div className="text-sm md:text-base font-black text-kenney-dark tracking-wide">
                      {WECHAT_ID}
                    </div>
                  </div>
                </div>
                
                <button
                  onClick={handleCopyWechatId}
                  className={`shrink-0 px-3 py-1.5 md:px-4 md:py-2 rounded-lg text-xs md:text-sm font-bold transition-all border-2 ${
                    copied
                      ? 'bg-kenney-green border-kenney-dark text-white shadow-[0_2px_0_#333] active:translate-y-[2px] active:shadow-none'
                      : 'bg-white border-gray-200 text-kenney-dark hover:border-kenney-blue hover:text-kenney-blue shadow-[0_2px_0_rgb(229,231,235)] active:translate-y-[2px] active:shadow-none'
                  }`}
                >
                  {copied ? '已复制!' : '复制微信'}
                </button>
              </div>

              {/* 打赏区域 */}
              <div className="bg-white rounded-xl p-4 md:p-5 border-2 border-yellow-200 shadow-sm flex flex-col items-center relative overflow-hidden group hover:border-yellow-400 transition-colors">
                {/* 背景点缀 */}
                <div className="absolute -top-3 -right-3 text-4xl opacity-20 pointer-events-none group-hover:scale-110 transition-transform">☕</div>
                <div className="absolute -bottom-3 -left-3 text-4xl opacity-20 pointer-events-none group-hover:scale-110 transition-transform">⚡</div>

                <h3 className="text-sm md:text-base font-bold text-yellow-700 mb-3 text-center leading-relaxed relative z-10">
                  如果这个项目对您有帮助<br/>欢迎请作者喝杯咖啡 ☕
                </h3>
                
                <div className="w-32 h-32 md:w-36 md:h-36 bg-gray-50 rounded-xl border-2 border-gray-200 flex flex-col items-center justify-center p-1 mb-2 relative overflow-hidden shadow-inner z-10">
                  {/* 图片标签：加载 /assets/donate-qr.png 或 .jpg */}
                  <img 
                    src="/assets/donate-qr.png" 
                    alt="打赏二维码" 
                    className="w-full h-full object-cover rounded-lg relative z-20 bg-white"
                    onError={(e) => {
                      // 图片加载失败时隐藏 img 并显示占位提示
                      e.currentTarget.style.display = 'none';
                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                  {/* 占位提示：当图片不存在时显示 */}
                  <div className="hidden absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-50 z-10">
                    <svg className="w-8 h-8 mx-auto mb-1 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs font-bold">暂无收款码</span>
                  </div>
                </div>
                
                <p className="text-[10px] md:text-xs font-medium text-gray-400 text-center relative z-10 leading-tight">
                  支持后记得加微信~
                </p>
              </div>
            </div>
            
            <p className="mt-5 text-xs text-gray-400 font-medium text-center">
              感谢您的每一份支持与鼓励！✨
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
