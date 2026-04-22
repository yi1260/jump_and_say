import React from 'react';

interface FeedbackButtonProps {
  onClick: () => void;
}

/**
 * 反馈入口按钮
 * 显示在首页右上角，点击打开反馈弹窗
 */
export const FeedbackButton: React.FC<FeedbackButtonProps> = ({ onClick }) => {
  return (
    <button
      onClick={onClick}
      className="fixed top-4 right-4 md:top-6 md:right-6 z-[100] kenney-button-circle bg-kenney-blue hover:brightness-110 active:translate-y-[2px] md:active:translate-y-[4px] transition-all"
      title="联系我们"
      aria-label="打开反馈弹窗"
    >
      {/* 消息/反馈图标 */}
      <svg
        className="w-5 h-5 md:w-6 md:h-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* 气泡形状 */}
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        {/* 内部小问号或感叹号表示反馈 */}
        <circle cx="12" cy="10" r="1" fill="currentColor" />
        <path d="M9 14c.5.5 1.5 1 3 1s2.5-.5 3-1" />
      </svg>
    </button>
  );
};
