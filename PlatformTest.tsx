import React from 'react';
import { createRoot } from 'react-dom/client';
import Phaser from 'phaser';
import { PlatformScene } from './game/scenes/PlatformScene';

/**
 * 横版闯关模式测试入口
 *
 * 用于快速测试新的横版关卡原型
 * 启动方法：在浏览器控制台执行 document.body.innerHTML = ''; const script = document.createElement('script'); script.src = '/PlatformTest.tsx'; document.body.appendChild(script);
 */
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'platform-test-container',
  width: 1280,
  height: 720,
  backgroundColor: '#87CEEB', // 天空蓝背景
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 2500 },
      debug: false // 设置为 true 可以看到碰撞边界
    }
  },
  scene: [PlatformScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
};

// 创建测试容器
const container = document.createElement('div');
container.id = 'platform-test-container';
container.style.position = 'fixed';
container.style.top = '0';
container.style.left = '0';
container.style.width = '100%';
container.style.height = '100%';
container.style.zIndex = '9999';
container.style.backgroundColor = '#000';
document.body.appendChild(container);

// 创建控制面板
const controls = document.createElement('div');
controls.style.position = 'fixed';
controls.style.top = '10px';
controls.style.right = '10px';
controls.style.zIndex = '10000';
controls.style.backgroundColor = 'rgba(0,0,0,0.7)';
controls.style.padding = '15px';
controls.style.borderRadius = '8px';
controls.style.color = '#fff';
controls.style.fontFamily = 'Arial, sans-serif';
controls.innerHTML = `
  <h3 style="margin: 0 0 10px 0; color: #FFD700;">🎮 横版闯关测试</h3>
  <p style="margin: 5px 0; font-size: 14px;">控制方式：</p>
  <ul style="margin: 5px 0; padding-left: 20px; font-size: 13px;">
    <li>← → 左右移动</li>
    <li>↑ / 空格 跳跃</li>
    <li>踩敌人头上消灭</li>
  </ul>
  <button id="restart-btn" style="margin-top: 10px; padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
    重新开始
  </button>
  <button id="close-btn" style="margin-left: 5px; padding: 8px 16px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
    关闭
  </button>
`;
document.body.appendChild(controls);

// 启动游戏
const game = new Phaser.Game(config);

// 绑定按钮事件
document.getElementById('restart-btn')?.addEventListener('click', () => {
  game.scene.start('PlatformScene');
});

document.getElementById('close-btn')?.addEventListener('click', () => {
  game.destroy(true);
  container.remove();
  controls.remove();
});

console.log('[PlatformTest] 横版闯关测试模式已启动！');
console.log('[PlatformTest] 使用 ← → 移动，↑ 或空格跳跃');
