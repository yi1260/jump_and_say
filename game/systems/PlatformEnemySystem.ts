import Phaser from 'phaser';

/**
 * 横版平台游戏敌人AI系统
 *
 * 负责管理敌人的巡逻行为
 * 史莱姆敌人会左右巡逻，碰到边界自动转向
 */
export class PlatformEnemySystem {
  private scene: Phaser.Scene;
  private enemies: Phaser.Physics.Arcade.Group;

  // 敌人移动速度
  private readonly ENEMY_SPEED = 100;

  constructor(scene: Phaser.Scene, enemies: Phaser.Physics.Arcade.Group) {
    this.scene = scene;
    this.enemies = enemies;
  }

  public update(_delta: number): void {
    if (!this.enemies) return;

    this.enemies.children.iterate((enemy) => {
      if (!enemy || !enemy.active) return true;

      const sprite = enemy as Phaser.Physics.Arcade.Sprite;
      const body = sprite.body as Phaser.Physics.Arcade.Body;

      // 获取巡逻范围
      const patrolStart = sprite.getData('patrolStart') as number;
      const patrolEnd = sprite.getData('patrolEnd') as number;
      let direction = sprite.getData('direction') as number;

      // 检测是否需要转向
      if (sprite.x <= patrolStart) {
        direction = 1; // 向右
        sprite.setData('direction', direction);
      } else if (sprite.x >= patrolEnd) {
        direction = -1; // 向左
        sprite.setData('direction', direction);
      }

      // 应用速度
      body.setVelocityX(this.ENEMY_SPEED * direction);

      // 根据方向翻转精灵
      sprite.setFlipX(direction < 0);

      return true;
    });
  }

  /**
   * 暂停所有敌人的移动
   */
  public pauseAll(): void {
    this.enemies.children.iterate((enemy) => {
      if (!enemy) return true;
      const sprite = enemy as Phaser.Physics.Arcade.Sprite;
      const body = sprite.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(0, 0);
      return true;
    });
  }

  /**
   * 恢复所有敌人的移动
   */
  public resumeAll(): void {
    // 敌人会在下一个 update 周期自动恢复巡逻
  }
}
