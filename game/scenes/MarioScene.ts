import Phaser from 'phaser';

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SceneLayout = {
  width: number;
  height: number;
  tileSize: number;
  groundTopY: number;
  playerX: number;
  playerY: number;
  characterWidth: number;
  characterHeight: number;
  decorationSize: number;
  floatingBlockY: number;
  floatingBlockStartX: number;
  floatingBlockGap: number;
};

const FRAME_WIDTH = 1366;
const FRAME_HEIGHT = 1024;
const TILE_SIZE = 96;
const GROUND_TOP_Y = 833;
const CHARACTER_DISPLAY = {
  width: 106,
  height: 118
};
const CHARACTER_TEXTURE_SIZE = {
  width: 512,
  height: 512
};
const JUMP_VELOCITY = -1225;
const PLAYER_SPEED = 300;
const WORLD_GRAVITY = 2500;
const PLAYER_GRAVITY = 1800;
const PLAYER_FOOT_LIFT = 2;
const FLOATING_BLOCKS: Array<Rect & { key: string }> = [
  { x: 459, y: 558, width: TILE_SIZE, height: TILE_SIZE, key: 'bricks_brown' },
  { x: 552, y: 558, width: TILE_SIZE, height: TILE_SIZE, key: 'block_exclamation' },
  { x: 645, y: 558, width: TILE_SIZE, height: TILE_SIZE, key: 'bricks_brown' }
];
const DECORATIONS: Array<Rect & { key: string }> = [
  { x: 267, y: 769, width: 64, height: 64, key: 'grass' },
  { x: 1052, y: 772, width: 64, height: 64, key: 'cactus' }
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class MarioScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private background?: Phaser.GameObjects.TileSprite;
  private sceneryObjects: Phaser.GameObjects.GameObject[] = [];
  private layout!: SceneLayout;

  constructor() {
    super({ key: 'MarioScene' });
  }

  preload() {
    const rawDpr = window.devicePixelRatio || 1;
    const textureScale = Math.min(Math.max(2, Math.ceil(rawDpr * 1.5)), 4);
    const characterSize = {
      width: CHARACTER_TEXTURE_SIZE.width * textureScale,
      height: CHARACTER_TEXTURE_SIZE.height * textureScale
    };
    const backgroundSize = {
      width: 1024 * textureScale,
      height: 1024 * textureScale
    };
    const tileSize = {
      width: TILE_SIZE * textureScale,
      height: TILE_SIZE * textureScale
    };
    const decorationSize = {
      width: 64 * textureScale,
      height: 64 * textureScale
    };

    this.load.svg('background_fade_desert', '/assets/kenney/Vector/Backgrounds/background_fade_desert.svg', backgroundSize);
    this.load.svg('terrain_grass_block_top', '/assets/kenney/Vector/backup/Tiles/terrain_grass_block_top.svg', tileSize);
    this.load.svg('terrain_grass_block_center', '/assets/kenney/Vector/backup/Tiles/terrain_grass_block_center.svg', tileSize);
    this.load.svg('bricks_brown', '/assets/kenney/Vector/backup/Tiles/bricks_brown.svg', tileSize);
    this.load.svg('block_exclamation', '/assets/kenney/Vector/Tiles/block_exclamation.svg', tileSize);
    this.load.svg('grass', '/assets/kenney/Vector/Tiles/grass.svg', decorationSize);
    this.load.svg('cactus', '/assets/kenney/Vector/backup/Tiles/cactus.svg', decorationSize);
    this.load.svg('character_pink_idle', '/assets/kenney/Vector/Characters/character_pink_idle.svg', characterSize);
    this.load.svg('character_pink_walk_a', '/assets/kenney/Vector/Characters/character_pink_walk_a.svg', characterSize);
    this.load.svg('character_pink_walk_b', '/assets/kenney/Vector/Characters/character_pink_walk_b.svg', characterSize);
    this.load.svg('character_pink_jump', '/assets/kenney/Vector/Characters/character_pink_jump.svg', characterSize);
  }

  create() {
    this.layout = this.computeLayout();
    this.physics.world.setBounds(0, 0, this.layout.width, this.layout.height);
    this.applyWorldPhysicsScale();
    this.cameras.main.setBackgroundColor('#DDEFFF');

    this.background = this.add
      .tileSprite(0, 0, this.layout.width, this.layout.height, 'background_fade_desert')
      .setOrigin(0, 0)
      .setDepth(0);
    this.applyBackgroundLayout();

    this.platforms = this.physics.add.staticGroup();
    this.createScenery();
    this.createSceneColliders();
    this.createPlayerAnimations();
    this.createPlayer();

    this.physics.add.collider(this.player, this.platforms);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.applyCameraBounds();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
  }

  update() {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const isGrounded = body.touching.down || body.blocked.down;

    if (this.cursors.left.isDown) {
      this.player.setVelocityX(-PLAYER_SPEED * this.getRenderScale());
      this.player.setFlipX(true);
    } else if (this.cursors.right.isDown) {
      this.player.setVelocityX(PLAYER_SPEED * this.getRenderScale());
      this.player.setFlipX(false);
    } else {
      this.player.setVelocityX(0);
    }

    const isMovingHorizontally = Math.abs(body.velocity.x) > 1;

    if ((this.cursors.up.isDown || this.cursors.space.isDown) && isGrounded) {
      this.player.setVelocityY(JUMP_VELOCITY * this.getRenderScale());
      this.player.anims.stop();
      this.player.setTexture('character_pink_jump');
    } else if (!isGrounded) {
      this.player.anims.stop();
      this.player.setTexture('character_pink_jump');
    } else if (isMovingHorizontally) {
      this.player.play('character_pink_walk', true);
    } else {
      this.player.anims.stop();
      this.player.setTexture('character_pink_idle');
    }
  }

  private computeLayout(): SceneLayout {
    const renderScale = this.getRenderScale();
    const width = Math.max(320 * renderScale, this.scale.width || FRAME_WIDTH);
    const height = Math.max(480 * renderScale, this.scale.height || FRAME_HEIGHT);
    const edgePadding = 10 * renderScale;
    const logicalHeight = height / renderScale;
    const tileSize = Math.round(clamp(logicalHeight * (TILE_SIZE / FRAME_HEIGHT), 58, 108) * renderScale);
    const groundTopY = height - tileSize * 2;
    const objectScale = tileSize / TILE_SIZE;
    const characterWidth = Math.round(CHARACTER_DISPLAY.width * objectScale);
    const characterHeight = Math.round(CHARACTER_DISPLAY.height * objectScale);
    const decorationSize = Math.round(64 * objectScale);
    const floatingBlockY = clamp(
      groundTopY - tileSize * ((GROUND_TOP_Y - FLOATING_BLOCKS[0].y) / TILE_SIZE),
      height * 0.26,
      groundTopY - tileSize * 1.35
    );
    const floatingBlockGap = tileSize * ((FLOATING_BLOCKS[1].x - FLOATING_BLOCKS[0].x) / TILE_SIZE);
    const floatingBlockGroupWidth = tileSize + floatingBlockGap * (FLOATING_BLOCKS.length - 1);
    const floatingBlockStartX = clamp(
      width * (FLOATING_BLOCKS[0].x / FRAME_WIDTH),
      tileSize * 0.45,
      Math.max(tileSize * 0.45, width - floatingBlockGroupWidth - tileSize * 0.45)
    );

    return {
      width,
      height,
      tileSize,
      groundTopY,
      playerX: clamp(width * ((51 + 81.52 / 2) / FRAME_WIDTH), characterWidth / 2 + edgePadding, width - characterWidth / 2 - edgePadding),
      playerY: groundTopY - PLAYER_FOOT_LIFT,
      characterWidth,
      characterHeight,
      decorationSize,
      floatingBlockY,
      floatingBlockStartX,
      floatingBlockGap
    };
  }

  private createScenery() {
    const { width, tileSize, groundTopY, decorationSize } = this.layout;
    const columns = Math.ceil(width / tileSize) + 1;
    for (let column = 0; column < columns; column += 1) {
      const x = column * tileSize;
      this.addSceneryTile(x, groundTopY, tileSize, 'terrain_grass_block_top');
      this.addSceneryTile(x, groundTopY + tileSize, tileSize, 'terrain_grass_block_center');
    }

    FLOATING_BLOCKS.forEach((block, index) => {
      this.addSceneryTile(
        this.layout.floatingBlockStartX + this.layout.floatingBlockGap * index,
        this.layout.floatingBlockY,
        tileSize,
        block.key
      );
    });

    DECORATIONS.forEach((decoration) => {
      const x = clamp(
        width * (decoration.x / FRAME_WIDTH),
        decorationSize / 2,
        width - decorationSize / 2
      );
      const y = groundTopY - decorationSize + (decoration.y + decoration.height - GROUND_TOP_Y) * (tileSize / TILE_SIZE);
      const image = this.add
        .image(x, y + decorationSize / 2, decoration.key)
        .setDisplaySize(decorationSize, decorationSize)
        .setDepth(2);
      this.sceneryObjects.push(image);
    });
  }

  private addSceneryTile(x: number, y: number, size: number, key: string) {
    const tile = this.add
      .image(x + size / 2, y + size / 2, key)
      .setDisplaySize(size, size)
      .setDepth(1);
    this.sceneryObjects.push(tile);
  }

  private createSceneColliders() {
    const { width, tileSize, groundTopY } = this.layout;
    const columns = Math.ceil(width / tileSize) + 1;
    for (let column = 0; column < columns; column += 1) {
      const x = column * tileSize;
      this.addStaticCollider({ x, y: groundTopY, width: tileSize, height: tileSize });
      this.addStaticCollider({ x, y: groundTopY + tileSize, width: tileSize, height: tileSize });
    }

    FLOATING_BLOCKS.forEach((block, index) => {
      this.addStaticCollider({
        x: this.layout.floatingBlockStartX + this.layout.floatingBlockGap * index,
        y: this.layout.floatingBlockY,
        width: tileSize,
        height: tileSize
      });
    });
  }

  private addStaticCollider(rect: Rect) {
    const zone = this.add.zone(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width,
      rect.height
    );
    this.physics.add.existing(zone, true);
    const body = zone.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(rect.width, rect.height);
    body.updateFromGameObject();
    this.platforms.add(zone);
  }

  private createPlayerAnimations() {
    if (this.anims.exists('character_pink_walk')) {
      return;
    }

    this.anims.create({
      key: 'character_pink_walk',
      frames: [
        { key: 'character_pink_walk_a' },
        { key: 'character_pink_idle' },
        { key: 'character_pink_walk_b' },
        { key: 'character_pink_idle' }
      ],
      frameRate: 8,
      repeat: -1
    });
  }

  private createPlayer() {
    this.player = this.physics.add
      .sprite(this.layout.playerX, this.layout.playerY, 'character_pink_idle')
      .setOrigin(0.5, 1)
      .setDepth(10);
    this.applyPlayerLayout();
    this.player.setCollideWorldBounds(true);
  }

  private applyPlayerLayout() {
    this.player.setDisplaySize(this.layout.characterWidth, this.layout.characterHeight);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setGravityY(PLAYER_GRAVITY * this.getRenderScale());
    body.setSize(this.player.width * 0.5, this.player.height * 0.62);
    body.setOffset(this.player.width * 0.25, this.player.height * 0.4);
  }

  private applyWorldPhysicsScale() {
    this.physics.world.gravity.y = WORLD_GRAVITY * this.getRenderScale();
  }

  private getRenderScale() {
    return Math.max(1, this.scale.displayScale?.x || window.devicePixelRatio || 1);
  }

  private handleResize() {
    const previousLayout = this.layout;
    const edgePadding = 10 * this.getRenderScale();
    const playerXRatio = this.player ? this.player.x / previousLayout.width : undefined;
    const playerYRatio = this.player ? this.player.y / previousLayout.height : undefined;
    const wasGrounded = this.player
      ? (this.player.body as Phaser.Physics.Arcade.Body).touching.down || (this.player.body as Phaser.Physics.Arcade.Body).blocked.down
      : true;

    this.layout = this.computeLayout();
    this.physics.world.setBounds(0, 0, this.layout.width, this.layout.height);
    this.applyWorldPhysicsScale();
    this.applyCameraBounds();

    this.applyBackgroundLayout();
    this.rebuildSceneryAndColliders();

    if (this.player) {
      this.player.setPosition(
        clamp((playerXRatio ?? 0.07) * this.layout.width, this.layout.characterWidth / 2 + edgePadding, this.layout.width - this.layout.characterWidth / 2 - edgePadding),
        wasGrounded ? this.layout.playerY : clamp((playerYRatio ?? 0.7) * this.layout.height, this.layout.characterHeight, this.layout.groundTopY)
      );
      this.applyPlayerLayout();
    }
  }

  private rebuildSceneryAndColliders() {
    this.sceneryObjects.forEach((object) => object.destroy());
    this.sceneryObjects = [];
    this.platforms.clear(true, true);
    this.createScenery();
    this.createSceneColliders();
  }

  private applyCameraBounds() {
    this.cameras.main.setBounds(0, 0, this.layout.width, this.layout.height);
    this.cameras.main.scrollX = 0;
    this.cameras.main.scrollY = 0;
  }

  private applyBackgroundLayout() {
    if (!this.background) {
      return;
    }

    const source = this.textures.get('background_fade_desert').getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const tileScale = this.layout.height / source.height;
    this.background
      .setSize(this.layout.width, this.layout.height)
      .setTileScale(tileScale)
      .setTilePosition(0, 0);
  }
}
