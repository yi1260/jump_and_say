import { AnimatePresence, motion } from 'framer-motion';
import React, { useState } from 'react';

// 微信号配置
const WECHAT_ID = 'yi1260ofvivian';

// 反馈类型
type FeedbackType = 'bug' | 'suggestion' | 'feedback';

interface FeedbackModalProps {
  isVisible: boolean;
  onClose: () => void;
}

// 反馈类型配置
const FEEDBACK_TYPES: Record<FeedbackType, { label: string; icon: string; hint: string }> = {
  bug: { label: 'Bug', icon: '🐛', hint: '截图+描述发我' },
  suggestion: { label: '建议', icon: '💡', hint: '有好点子欢迎说' },
  feedback: { label: '反馈', icon: '💬', hint: '期待你的声音' },
};

/**
 * 反馈弹窗组件 - 横屏优化版
 */
export const FeedbackModal: React.FC<FeedbackModalProps> = ({ isVisible, onClose }) => {
  const [activeType, setActiveType] = useState<FeedbackType>('bug');
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
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-2"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', bounce: 0.3 }}
            className="relative bg-white/95 backdrop-blur-md w-full max-w-md rounded-xl md:rounded-2xl px-3 py-2 md:px-5 md:py-3 flex flex-col items-center shadow-[0_6px_0_rgba(0,0,0,0.2)] border-3 border-kenney-dark"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 关闭按钮 */}
            <button
              onClick={onClose}
              className="absolute top-1 right-1 md:top-2 md:right-2 w-6 h-6 md:w-7 md:h-7 rounded-full bg-kenney-red border-2 border-kenney-dark flex items-center justify-center shadow-[0_2px_0_#333] active:translate-y-[1px] transition-all"
              aria-label="关闭"
            >
              <svg className="w-3 h-3 md:w-4 md:h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>

            {/* 标题 */}
            <h2 className="text-base md:text-lg font-black text-kenney-dark mb-1.5 md:mb-2">
              联系作者
            </h2>

            {/* 反馈类型 + 微信号 横向排列 */}
            <div className="flex items-start gap-2 md:gap-3 w-full">
              {/* 反馈类型选择 */}
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex gap-1 md:gap-1.5">
                  {(Object.keys(FEEDBACK_TYPES) as FeedbackType[]).map((type) => (
                    <button
                      key={type}
                      onClick={() => setActiveType(type)}
                      className={`px-2 py-1 md:px-2.5 md:py-1.5 rounded-lg border-2 transition-all ${
                        activeType === type
                          ? 'bg-kenney-blue border-kenney-dark shadow-[0_2px_0_#333]'
                          : 'bg-white/80 border-gray-300 hover:border-kenney-blue'
                      }`}
                      title={FEEDBACK_TYPES[type].label}
                    >
                      <span className="text-sm md:text-base">{FEEDBACK_TYPES[type].icon}</span>
                    </button>
                  ))}
                </div>
                {/* 当前类型的提示语 */}
                <p className="text-[9px] md:text-[10px] text-gray-500 text-center leading-tight">
                  {FEEDBACK_TYPES[activeType].hint}
                </p>
              </div>

              {/* 分隔线 */}
              <div className="w-px h-10 bg-gray-200 mt-1" />

              {/* 微信号区域 */}
              <div className="flex-1 flex items-center justify-between bg-gradient-to-r from-green-50 to-green-100/80 rounded-lg px-2.5 py-1.5 md:px-3 md:py-2 border border-green-200">
                <div className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.555a.59.59 0 0 1 .213.646l-.39 1.48c-.019.077-.029.156-.029.235 0 .403.327.73.73.73.149 0 .293-.046.414-.132l1.865-1.108a.59.59 0 0 1 .503-.055c.992.292 2.062.451 3.183.451.264 0 .524-.012.781-.034-.147-.513-.225-1.052-.225-1.608 0-3.637 3.506-6.587 7.83-6.587.264 0 .524.012.781.034C17.318 4.338 13.44 2.188 8.691 2.188zm-2.67 4.78a.865.865 0 1 1 0 1.73.865.865 0 0 1 0-1.73zm5.34 0a.865.865 0 1 1 0 1.73.865.865 0 0 1 0-1.73z"/>
                    <path d="M23.996 14.972c0-3.39-3.261-6.147-7.28-6.147-4.02 0-7.28 2.757-7.28 6.147 0 3.39 3.26 6.147 7.28 6.147.878 0 1.723-.13 2.515-.373a.585.585 0 0 1 .498.054l1.479.878a.727.727 0 0 0 1.008-.65.727.727 0 0 0-.032-.209l-.308-1.17a.585.585 0 0 1 .212-.642c1.466-1.1 2.408-2.72 2.408-4.035zm-9.87-1.083a.686.686 0 1 1 0-1.372.686.686 0 0 1 0 1.372zm5.18 0a.686.686 0 1 1 0-1.372.686.686 0 0 1 0 1.372z"/>
                  </svg>
                  <span className="text-xs md:text-sm font-bold text-green-700">微信</span>
                </div>

                <div className="flex items-center gap-1.5 md:gap-2">
                  <span className="text-sm md:text-base font-black text-green-800">
                    {WECHAT_ID}
                  </span>
                  <button
                    onClick={handleCopyWechatId}
                    className={`px-2 py-0.5 md:px-2.5 md:py-1 rounded text-[10px] md:text-xs font-bold transition-all border border-green-700 ${
                      copied
                        ? 'bg-kenney-green text-white'
                        : 'bg-white text-green-700 active:scale-95'
                    }`}
                  >
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
            </div>

            {/* 底部提示 */}
            <p className="text-[10px] md:text-xs text-gray-400 mt-1.5 md:mt-2 text-center">
              添加时请注明来意，感谢支持！
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
