# 平台关卡英语学习玩法设计文档

> **作者**: Claude Code
> **创建日期**: 2026-04-05
> **状态**: 待实现
> **关联项目**: Jump And Say
> **参考文档**: `docs/2026-03-29-brainstorm.md`, Round1 答题模式实现

---

## 一、设计目标

将英语学习（RAZ/海尼曼/红火箭等教材）与平台跳跃关卡深度结合，通过"答题开门"机制和"护盾奖励系统"，让儿童在体感运动中完成听力理解和口语跟读练习。

**核心原则**：
- 完全复用现有 Round1 听音识图/跟读模块
- 关卡元素随机生成，保证重玩价值
- 即时反馈（星星 + 进度条） + 延迟反馈（护盾奖励）
- 无需教学机制，直接进入游戏

---

## 二、关卡结构设计

### 2.1 关卡流程

```
[起点] → [跳跃区域] → [敌人/障碍] → 💠 [答题门 1] → [跳跃区域] → [敌人/障碍] → 💠 [答题门 2] → ... → [终点]
```

**关卡元素**：
- **固定元素**：起点、终点
- **随机元素**：敌人位置、障碍物位置、答题门位置
- **答题门数量**：由选择的绘本数量决定（例如 5 个绘本 = 5 个答题门）

### 2.2 答题门机制

**门的外观**：
- 封闭的门（`door_closed`）
- 门旁有引导方块（`block_yellow`），带闪烁动画
- 门上方显示当前绘本标识（可选：显示绘本封面缩略图）

**触发流程**：
1. 玩家撞击引导方块
2. 平台场景暂停（`scene.physics.pause()`）
3. 切换到 Round1 场景，传入当前绘本的题目数据
4. Round1 答题完成后（8 题左右）
5. 切回平台场景，门打开（`door_open`），玩家可通行
6. 门保持打开状态，玩家可自由返回

### 2.3 题目与绘本题量

- 每个绘本对应 1 个答题门
- 每个绘本题目数量由 Round1 实现决定（通常约 8 题）
- 例如：5 个绘本 → 5 个门 → 全关约 40 道题

---

## 三、随机生成系统

### 3.1 随机元素配置

**配置参数**（关卡配置文件中）：
```typescript
interface LevelConfig {
  bookCount: number;            // 答题门数量（= 绘本数量）
  obstaclesPerGate: number;     // 每个答题门前的障碍物数量（例如 3）
  enemiesPerSection: number;    // 每个区域的敌人数量（例如 2-3）
}
```

**随机生成内容**：
- 答题门的位置（在关卡宽度范围内）
- 障碍物的类型和位置（从所有可用障碍物类型中随机选择）
- 敌人的位置和类型（从所有可用敌人类型中随机选择）

**生成规则**：
- 从起点开始，依次生成：`[跳跃区域] → [障碍/敌人] → [答题门]`
- 每个答题门前的障碍物数量固定（`obstaclesPerGate`）
- 障碍物类型完全随机，无优先级
- 答题门之间距离保持在 400-600 像素（保证有足够的跳跃空间）

### 3.2 障碍物与敌人类型

**障碍物类型池**（示例）：
- 尖刺（`spikes`）- 地面陷阱
- 高台（平台）- 需要跳上去
- 移动平台 - 水平或垂直移动
- 弹簧 - 弹跳到高处

**敌人类型池**（示例）：
- 史莱姆（普通、火焰、尖刺）
- 蜜蜂/苍蝇（空中敌人）
- 其他地面敌人

**注意**：障碍物和敌人都是"常规"的，即玩家必须**跳跃躲避**或**踩头消灭**，接触即死亡（Game Over）。

---

## 四、Round1 答题场景复用

### 4.1 复用策略

**完全复用现有 Round1 实现**：
- UI 布局：闪卡图片 + 单词文本 + 音频播放
- 答题流程：听音频 → 看图片 → 跟读 → 评分
- 状态机：等待撞击 → 播放音频 → 等待跟读 → 评分反馈
- 题目数据：从绘本配置中读取

**接口适配**：
平台关卡 → Round1 的数据传递：
```typescript
interface Round1LevelData {
  bookId: string;              // 绘本 ID
  questions: Round1Question[]; // 题目列表（约 8 题）
  themeId: string;             // 主题 ID（用于背景/皮肤）
}
```

### 4.2 Round1 完成后返回平台

**完成条件**：
- 所有题目答完（8/8）
- 或达到退出条件（放弃答题）

**返回值**：
```typescript
interface Round1Result {
  correctCount: number;        // 答对题数
  totalCount: number;          // 总题数
  accuracy: number;            // 正确率（0-1）
  starCount: number;           // 获得星星数
}
```

**场景切换流程**：
1. Round1 显示结算界面（星星 + 正确率）
2. 计算护盾奖励（见下文）
3. 播放护盾获得特效（如果有）
4. 延迟 1.5 秒后切回平台场景
5. 平台场景恢复，门已打开
6. 右上角 HUD 更新星星总数

---

## 五、星星与护盾奖励系统

### 5.1 星星计算

**单道题**：
- 答对 = 1 颗星
- 答错 = 0 颗星

**单个答题门**（假设 8 题）：
- 最多 8 颗星
- 显示在 Round1 结算界面

**全关累计**：
- 5 个门 × 8 题 = 最多 40 颗星
- 显示在平台场景右上角 HUD

### 5.2 护盾奖励阈值

| 正确率 | 护盾时长 | 颜色 | 特效 |
|--------|----------|------|------|
| ≥ 60%  | 3 秒     | 🔵 蓝色 | 淡蓝色光晕 |
| ≥ 80%  | 5 秒     | 🟢 绿色 | 绿色光晕 + 粒子 |
| 100%   | 6 秒     | 🟡 金色 | 金色光晕 + 彩虹粒子 + "Perfect!" 文字 |

**计算公式**：
```typescript
const accuracy = correctCount / totalCount;

let shieldDuration = 0;
if (accuracy >= 1.0) {
  shieldDuration = 6;  // 100% → 6 秒金色护盾
} else if (accuracy >= 0.8) {
  shieldDuration = 5;  // 80-99% → 5 秒绿色护盾
} else if (accuracy >= 0.6) {
  shieldDuration = 3;  // 60-79% → 3 秒蓝色护盾
}
```

### 5.3 护盾外观变化

**护盾激活时**：
- 角色周围出现半透明光晕圆圈
- 光晕颜色根据时长变化：
  - 蓝色（3s）：`#4A90E2`，透明度 0.4
  - 绿色（5s）：`#4CAF50`，透明度 0.5
  - 金色（6s）：`#FFD700`，透明度 0.6 + 彩虹粒子特效

**护盾倒计时**：
- 右上角 HUD 显示护盾剩余时间（数字或进度条）
- 护盾消失前 1 秒，光晕快速闪烁（提醒玩家）

**护盾效果**：
- 护盾期间，碰撞敌人/障碍物不会死亡
- 敌人会被弹开或消灭（类似马里奥无敌星）
- HUD 显示护盾图标（闪烁提示）

### 5.4 护盾获得反馈特效

**护盾获得瞬间**（平台场景恢复时）：

1. **视觉反馈**（0-1 秒）：
   - 屏幕中央弹出大字："Shield Get!" 或 "护盾获得！"
   - 文字颜色对应护盾等级（蓝/绿/金）
   - 文字带弹跳动画（bounce in → scale 1.2 → 1.0）

2. **角色特效**（0-2 秒）：
   - 角色周围立即出现护盾光晕
   - 光晕从无到有，快速缩放出现（scale 0 → 1.5 → 1.0）
   - 金色护盾额外播放彩虹粒子爆发效果

3. **HUD 更新**（持续）：
   - 右上角显示护盾图标 + 倒计时数字
   - 护盾图标根据剩余时间变色（最后 1 秒变红闪烁）

4. **音效反馈**：
   - 护盾获得瞬间播放"升级"音效（类似吃星星的声音）
   - 金色护盾额外播放"哇哦！"语音

**伪代码**：
```typescript
function onRound1Complete(result: Round1Result) {
  const shieldDuration = calculateShieldDuration(result.accuracy);

  if (shieldDuration > 0) {
    // 显示获得文字
    showGetShieldText(shieldDuration);

    // 激活护盾
    activateShield(shieldDuration);

    // 播放音效
    playShieldSound(shieldDuration);

    // 更新 HUD
    updateHudShield(shieldDuration);
  }
}
```

---

## 六、数据结构设计

### 6.1 关卡配置

```typescript
interface PlatformLevelConfig {
  theme: string;                  // 主题（'grass' | 'sand' | 'snow'）
  width: number;                  // 关卡总宽度（像素）
  background: string;             // 背景图片 ID

  // 绘本配置
  books: BookConfig[];            // 本关包含的绘本列表

  // 随机生成配置
  obstaclesPerGate: number;       // 每个门前的障碍物数量
  enemiesPerSection: number;      // 每个区域的敌人数量
}

interface BookConfig {
  bookId: string;                 // 绘本 ID（对应 RAZ/海尼曼等）
  title: string;                  // 绘本标题
  questions: Round1Question[];    // 题目列表（8 题左右）
}
```

### 6.2 运行时状态

```typescript
interface PlatformGameState {
  currentGateIndex: number;       // 当前答题门索引（0-4）
  totalStars: number;             // 全关累计星星数
  activeShield: ShieldState | null; // 当前激活的护盾
}

interface ShieldState {
  duration: number;               // 护盾总时长（秒）
  remainingTime: number;          // 剩余时间（秒）
  level: 'blue' | 'green' | 'gold'; // 护盾等级
}
```

---

## 七、技术实现要点

### 7.1 场景切换实现

**平台 → Round1**：
```typescript
// PlatformScene.ts
async function enterWordGate(gateIndex: number) {
  const bookConfig = levelConfig.books[gateIndex];

  // 暂停平台场景
  this.physics.pause();
  this.scene.pause();

  // 切换到 Round1 场景
  this.scene.launch('Round1Scene', {
    bookId: bookConfig.bookId,
    questions: bookConfig.questions,
    themeId: levelConfig.theme,
  });

  // 监听 Round1 完成事件
  this.scene.get('Round1Scene').events.once('complete', onRound1Complete);
}
```

**Round1 → 平台**：
```typescript
// Round1Scene.ts
function onQuizComplete(result: Round1Result) {
  // 发送结果回平台场景
  this.scene.get('PlatformScene').events.emit('complete', result);

  // 停止 Round1 场景
  this.scene.stop();

  // 恢复平台场景
  this.scene.resume('PlatformScene');
}
```

### 7.2 护盾系统实现

**护盾激活**：
```typescript
// PlatformPlayerControlSystem.ts
activateShield(duration: number, level: 'blue' | 'green' | 'gold') {
  this.shieldActive = true;
  this.shieldDuration = duration;
  this.shieldRemainingTime = duration;
  this.shieldLevel = level;

  // 创建护盾精灵
  this.shieldSprite = this.scene.add.sprite(
    this.player.x,
    this.player.y,
    `shield_${level}`,
  ).setVisible(true);

  // 护盾跟随玩家
  this.shieldSprite.startFollow(this.player);
}
```

**护盾碰撞处理**：
```typescript
// 护盾期间碰撞敌人
if (this.shieldActive) {
  // 敌人被消灭/弹开
  enemy.destroy();
  this.playDestroyEffect();
} else {
  // 正常死亡流程
  this.gameOver();
}
```

### 7.3 随机生成实现

**生成答题门和障碍物**：
```typescript
function generateLevelElements() {
  const gates: GatePosition[] = [];
  const obstacles: ObstaclePosition[] = [];

  // 根据绘本数量生成答题门
  for (let i = 0; i < levelConfig.books.length; i++) {
    // 随机门位置（距离上一个门 400-600 像素）
    const gateX = 800 + i * 500 + Math.random() * 200;
    gates.push({ x: gateX, gateIndex: i });

    // 在门前生成障碍物
    for (let j = 0; j < levelConfig.obstaclesPerGate; j++) {
      const obstacleX = gateX - 150 - j * 120;
      const obstacleType = getRandomObstacleType();
      obstacles.push({
        x: obstacleX,
        type: obstacleType
      });
    }
  }

  return { gates, obstacles };
}
```

---

## 八、UI/HUD 设计

### 8.1 平台场景 HUD

**右上角显示**：
```
┌──────────────────────────┐
│ ⭐⭐⭐⭐⭐ 18/40        │  ← 星星总数
│ [🛡️] 5s                 │  ← 护盾剩余时间（激活时显示）
└──────────────────────────┘
```

**星星计数**：
- 显示当前累计星星（字体：白色，大小：24px）
- 答完一个门后更新

**护盾图标**：
- 激活时显示（大小：32x32px）
- 图标颜色对应护盾等级
- 右侧显示剩余秒数（倒计时）

### 8.2 Round1 结算界面

**显示内容**：
```
╔═══════════════════════════╗
║   ⭐⭐⭐⭐⭐ 5/8         ║  ← 本次获得星星
║   正确率：62%             ║  ← 百分比
║   🛡️ Shield Get! (3s)   ║  ← 护盾获得提示（如有）
║   Tap to continue →      ║  ← 继续提示
╚═══════════════════════════╝
```

---

## 九、实现优先级

### 阶段一：核心机制（必需）
1. ✅ 答题门基础实现（PlatformWordGateSystem）
2. ✅ 平台 ↔ Round1 场景切换
3. ✅ 星星累计与 HUD 显示
4. ✅ 护盾激活与碰撞无敌逻辑

### 阶段二：反馈系统（重要）
5. ✅ 护盾外观变化（蓝/绿/金）
6. ✅ 护盾获得特效（文字 + 光晕）
7. ✅ 护盾倒计时 HUD
8. ✅ Round1 结算界面优化

### 阶段三：随机生成（中优先级）
9. ⚠️ 关卡元素随机生成算法
10. ⚠️ 障碍物/敌人配置系统
11. ⚠️ 关卡宽度动态调整

### 阶段四：优化（可选）
12. ⚠️ 护盾粒子特效
13. ⚠️ 音效与语音
14. ⚠️ 成就系统（连击大师等）

---

## 十、测试清单

### 功能测试
- [ ] 撞击引导方块能正确进入 Round1
- [ ] Round1 完成后能正确返回平台场景
- [ ] 门在答题后正确打开
- [ ] 星星数量正确累计
- [ ] 护盾在正确率达标时激活
- [ ] 护盾期间碰撞敌人不会死亡
- [ ] 护盾倒计时结束后恢复正常

### 边界测试
- [ ] 答题正确率恰好 60%/80%/100% 时护盾正确发放
- [ ] 所有门答完后能否到达终点
- [ ] 随机生成的关卡元素不会重叠
- [ ] 障碍物不会生成在无法跳跃的高度

### 用户体验测试
- [ ] 儿童能理解"撞门答题"的机制
- [ ] 护盾获得时有明显的反馈
- [ ] HUD 信息清晰易读
- [ ] 场景切换流畅无明显卡顿

---

## 十一、附录

### A. 相关文档
- `docs/2026-03-29-brainstorm.md` - 初始脑暴文档
- `game/modes/round1/Round1PronunciationMode.ts` - Round1 实现
- `game/systems/PlatformWordGateSystem.ts` - 单词门系统
- `game/data/level1Config.ts` - 关卡配置示例

### B. 待确认事项
- Round1 当前的题目数据结构是否需要适配
- 护盾的音效资源是否已有
- 绘本与题目的映射关系如何建立

### C. 术语表
- **答题门（Word Gate）**：需要答题才能打开的门
- **引导方块（Guide Block）**：门旁边闪烁的方块，撞击后触发答题
- **护盾（Shield）**：答题奖励的无敌状态，分为蓝/绿/金三级
- **Round1**现有的听音识图/跟读模式

---

**文档版本**: 1.0
**最后更新**: 2026-04-05
