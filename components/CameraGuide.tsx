import { useEffect, useState } from 'react';

interface CameraGuideProps {
  isActive: boolean;
  onPositionValid?: (isValid: boolean) => void;
}

export default function CameraGuide({ isActive, onPositionValid }: CameraGuideProps) {
  const [positionStatus, setPositionStatus] = useState<'checking' | 'good' | 'adjust'>('checking');
  const [guidanceText, setGuidanceText] = useState('正在检测站位...');
  const [showCheckmark, setShowCheckmark] = useState(false);

  useEffect(() => {
    if (!isActive) return;

    const checkPosition = () => {
      const randomCheck = Math.random();
      if (randomCheck > 0.6) {
        setPositionStatus('good');
        setGuidanceText('太棒了！你的位置很标准');
        setShowCheckmark(true);
        onPositionValid?.(true);
      } else {
        setPositionStatus('adjust');
        const messages = [
          '再靠近屏幕一点',
          '请稍微后退一点',
          '头稍微抬高一点',
          '请确保鼻子在画面里',
          '把脸放到框的正中间',
          '请把脸保持在绿色框内'
        ];
        setGuidanceText(messages[Math.floor(Math.random() * messages.length)]);
        setShowCheckmark(false);
        onPositionValid?.(false);
      }
    };

    const intervalId = setInterval(checkPosition, 3000);
    checkPosition();

    return () => {
      clearInterval(intervalId);
    };
  }, [isActive, onPositionValid]);

  if (!isActive) return null;

  return (
    <div className="relative w-full max-w-md mx-auto">
      <div className="relative rounded-2xl overflow-hidden border-4 border-kenney-dark bg-gradient-to-b from-sky-200 to-sky-300 p-8">
        <div className="relative w-full aspect-[4/3] flex items-center justify-center">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`relative w-[60%] h-[70%] border-4 border-dashed rounded-3xl flex items-center justify-center transition-all duration-500 ${
              positionStatus === 'good' ? 'border-green-500 bg-green-100/30' : 'border-red-400 bg-red-100/20'
            }`}>
              {showCheckmark && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg className="w-24 h-24 text-green-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
              
              <div className="absolute top-4 left-4 w-8 h-8 border-l-4 border-t-4 border-current opacity-50" />
              <div className="absolute top-4 right-4 w-8 h-8 border-r-4 border-t-4 border-current opacity-50" />
              <div className="absolute bottom-4 left-4 w-8 h-8 border-l-4 border-b-4 border-current opacity-50" />
              <div className="absolute bottom-4 right-4 w-8 h-8 border-r-4 border-b-4 border-current opacity-50" />
              
              <div className="text-center">
                <div className="text-6xl mb-2">👤</div>
                <p className="text-sm font-bold opacity-70">请把脸放在这里</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="mt-6 text-center space-y-2">
        <p className={`text-xl font-bold transition-colors ${
          positionStatus === 'good' ? 'text-green-600' : 'text-kenney-dark'
        }`}>
          {guidanceText}
        </p>
        <div className="flex justify-center gap-2 flex-wrap">
          <span className="inline-block px-3 py-1 bg-kenney-light rounded-full text-sm font-bold text-kenney-dark">
            📱 手机保持稳定
          </span>
          <span className="inline-block px-3 py-1 bg-kenney-light rounded-full text-sm font-bold text-kenney-dark">
            👃 鼻子不要挡住
          </span>
          <span className="inline-block px-3 py-1 bg-kenney-light rounded-full text-sm font-bold text-kenney-dark">
            👀 眼睛看向屏幕
          </span>
        </div>
      </div>
    </div>
  );
}
