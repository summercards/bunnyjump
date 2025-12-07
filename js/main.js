// =======================================================
// 圣诞兔兔跳一跳 - 微信小游戏版本（无 TS，无 WxAdapter）
// 已保留物理数值 & 特效逻辑，并修复真机触摸/音频兼容问题
// =======================================================

// 帧循环封装：兼容小游戏 + H5
const raf = (typeof requestAnimationFrame === 'function')
  ? function (cb) { return requestAnimationFrame(cb); }
  : function (cb) { return setTimeout(cb, 1000 / 60); };

// 屏幕 & Canvas 初始化
const isWeChat = typeof wx !== 'undefined';

// 屏幕 & Canvas 初始化（兼容 微信小游戏 + H5 浏览器）
let screenWidth, screenHeight;
let canvas, ctx;

if (isWeChat) {
  // 微信小游戏环境：用 wx 的 API
  const sysInfo = wx.getSystemInfoSync();
  screenWidth = sysInfo.windowWidth;
  screenHeight = sysInfo.windowHeight;

  canvas = wx.createCanvas();
  canvas.width = screenWidth;
  canvas.height = screenHeight;
  ctx = canvas.getContext('2d');
} else {
  // 浏览器 / H5 环境
  screenWidth = window.innerWidth;
  screenHeight = window.innerHeight;

  // 尝试获取已有的 <canvas id="gameCanvas">
  canvas = document.getElementById('gameCanvas');
  if (!canvas) {
    // 如果你没写 canvas，就帮你动态创建一个全屏的
    canvas = document.createElement('canvas');
    canvas.id = 'gameCanvas';
    document.body.style.margin = '0';
    document.body.appendChild(canvas);
  }

  canvas.width = screenWidth;
  canvas.height = screenHeight;
  ctx = canvas.getContext('2d');
}

// GameOver 后多久才能重新开始（毫秒）
const GAMEOVER_RESTART_DELAY = 500;

// 常量配置（加快上下速度）
const CONSTANTS = {
  // --- 物理数值调整 ---
  GRAVITY: 0.15,         // 基础重力 (原数值: 0.3)
  JUMP_FORCE: -8.5,      // 基础跳跃力 (原数值: -10.5)
  BOOST_FORCE: -12.5,    // 道具跳跃力 (原数值: -15)
  MOVE_SPEED: 0.18,      // 左右移动平滑度
  BELL_SPAWN_RATE: 70,   // 初始铃铛垂直间距
  COLORS: {
    bgStart: '#0b1026',  // 深夜蓝
    bgEnd: '#2b3266',    // 圣诞夜空
    snow: '#ffffff',
    bellNormal: '#f8fafc', // 普通铃铛改为白色
    bellBoost: '#dc2626',  // 特殊铃铛保持红色
    bow: '#facc15',        // 蝴蝶结保持黄色
    rabbit: '#ffffff'
  }
};

// =======================================================
// 音频控制器（小游戏 + H5 兼容，支持 BGM + 简单合成音效）
// =======================================================
class AudioController {
  constructor() {
    this.ctx = null;   // WebAudio 上下文（合成跳跃/掉落音效）
    this.bgm = null;   // 背景音乐

    // Web Audio：小游戏 & H5 通用
    if (isWeChat && typeof wx.createWebAudioContext === 'function') {
      try {
        this.ctx = wx.createWebAudioContext();
      } catch (e) {
        console.warn('wx.createWebAudioContext 创建失败，关闭合成音效', e);
        this.ctx = null;
      }
    } else if (typeof window !== 'undefined') {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (typeof AC === 'function') {
        try {
          this.ctx = new AC();
        } catch (e) {
          console.warn('Web Audio API 创建失败，关闭合成音效', e);
          this.ctx = null;
        }
      }
    }

    this.initBGM();
  }

  initBGM() {
    // 如果你有 audio/bgm.mp3 就能听到 BGM；没有也不会报错
    try {
      if (isWeChat && typeof wx.createInnerAudioContext === 'function') {
        this.bgm = wx.createInnerAudioContext();
        this.bgm.src = 'audio/bgm.mp3';
        this.bgm.loop = true;
        this.bgm.volume = 0.4;
      } else if (typeof Audio !== 'undefined') {
        this.bgm = new Audio('audio/bgm.mp3');
        this.bgm.loop = true;
        this.bgm.volume = 0.4;
      }
    } catch (e) {
      console.warn('初始化 BGM 失败', e);
      this.bgm = null;
    }
  }

  playBGM() {
    if (!this.bgm || typeof this.bgm.play !== 'function') return;
    try {
      const res = this.bgm.play();
      if (res && typeof res.catch === 'function') {
        res.catch(() => { /* 静默失败，避免未交互播放报错 */ });
      }
    } catch (e) {
      console.warn('播放 BGM 失败', e);
    }
  }

  stopBGM() {
    if (!this.bgm) return;
    try {
      if (typeof this.bgm.stop === 'function') {
        this.bgm.stop();
      } else if (typeof this.bgm.pause === 'function') {
        this.bgm.pause();
        this.bgm.currentTime = 0;
      }
    } catch (e) {
      console.warn('停止 BGM 失败', e);
    }
  }

  /**
   * 播放跳跃音效 (合成正弦波)
   * @param {string} type 'NORMAL' | 'BOOST' | 'DOUBLE'
   */
  playJump(type) {
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    let duration = 1.0;

    if (type === 'BOOST') {
      // 更加空灵的高音
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1100, t);
      osc.frequency.linearRampToValueAtTime(1105, t + 0.1); // 颤音

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.5);
      duration = 1.5;
    } else if (type === 'DOUBLE') {
      // 类似小鸟的啾啾声
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, t);
      osc.frequency.linearRampToValueAtTime(2000, t + 0.2);

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
      duration = 0.5;
    } else {
      // NORMAL：清脆的铃铛声
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(440, t + 1.0);

      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.0);
      duration = 1.0;
    }

    try {
      osc.start(t);
      osc.stop(t + duration);
    } catch (e) {
      console.warn('播放跳跃音效失败', e);
    }
  }

  /**
   * 播放掉落/失败音效
   */
  playFall() {
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.linearRampToValueAtTime(50, t + 0.8);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.linearRampToValueAtTime(0.01, t + 0.8);

    try {
      osc.start(t);
      osc.stop(t + 0.8);
    } catch (e) {
      console.warn('播放掉落音效失败', e);
    }
  }
}

// 绘制圆角矩形路径（代替 ctx.roundRect，防止部分环境不支持）
function drawRoundedRectPath(context, x, y, w, h, r) {
  const minSize = Math.min(w, h);
  if (r > minSize / 2) r = minSize / 2;
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + w - r, y);
  context.quadraticCurveTo(x + w, y, x + w, y + r);
  context.lineTo(x + w, y + h - r);
  context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  context.lineTo(x + r, y + h);
  context.quadraticCurveTo(x, y + h, x, y + h - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

// =======================================================
// 主游戏类
// =======================================================
class Main {
  constructor () {
    this.audio = new AudioController();

    // 状态 & 难度
    this.state = 'MENU';                     // MENU, PLAYING, GAMEOVER
    this.difficulty = 0;                     // 0 ~ 1.5 左右
    this.baseBellSpacing = CONSTANTS.BELL_SPAWN_RATE;
    this.bellSpacing = this.baseBellSpacing;

    // Game Over 后的重开冷却
    this.canRestart = true;
    this.lastGameOverTime = 0;

    // 分数
    this.score = 0;
    this.highScore = 0;

    // 游戏实体
    this.rabbit = null;
    this.cameraY = 0;
    this.groundY = 0;
    this.hasStartedGame = false;
    this.targetX = undefined;

    this.bells = [];
    this.particles = [];
    this.scorePopups = [];      // 铃铛爆开时的分数字特效
    this.backgroundStars = [];
    this.snowflakes = [];
    this.trees = [];

    this.aniId = 0;

    // 初始化游戏世界（只重置数据，不修改 state）
    this.reset();

    // 绑定输入：微信小游戏 + 浏览器 H5
    if (isWeChat && typeof wx !== 'undefined') {
      wx.onTouchStart((e) => {
        // 小游戏的回调参数没有 type，这里手动补上，供 touchHandler 使用
        e.type = 'touchstart';
        this.touchHandler(e);
      });
      wx.onTouchMove((e) => {
        e.type = 'touchmove';
        this.touchHandler(e);
      });
      wx.onTouchEnd(() => {});
      wx.onTouchCancel(() => {});
    } else {
      const self = this;

      // 把鼠标事件包一层，伪装成微信那种 { type, touches: [{clientX, clientY}] } 结构
      function wrapMouseAsTouch(type, e) {
        return {
          type,
          touches: [{ clientX: e.clientX, clientY: e.clientY }]
        };
      }

      // --- 触摸事件（手机浏览器） ---
      canvas.addEventListener('touchstart', function (e) {
        e.preventDefault();
        self.touchHandler(e); // e.touches[0].clientX 在 touchHandler 里照常使用
      }, { passive: false });

      canvas.addEventListener('touchmove', function (e) {
        e.preventDefault();
        self.touchHandler(e);
      }, { passive: false });

      // --- 鼠标事件（PC 浏览器调试用，可选） ---
      let mouseDown = false;

      canvas.addEventListener('mousedown', function (e) {
        mouseDown = true;
        self.touchHandler(wrapMouseAsTouch('touchstart', e));
      });

      canvas.addEventListener('mousemove', function (e) {
        if (!mouseDown) return;
        self.touchHandler(wrapMouseAsTouch('touchmove', e));
      });

      window.addEventListener('mouseup', function () {
        mouseDown = false;
      });
    }

    // 开始循环
    this.loop = this.loop.bind(this);
    this.aniId = raf(this.loop);
  }

  // 只负责重置数据，不修改 this.state
  reset () {
    this.score = 0;

    // 读取最高分：小游戏用 wx 存储，H5 用 localStorage
    if (isWeChat && typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      this.highScore = Number(wx.getStorageSync('highscore') || 0);
    } else if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('highscore');
      this.highScore = stored ? Number(stored) : 0;
    } else {
      this.highScore = 0;
    }

    // 游戏实体
    this.rabbit = {
      x: screenWidth / 2,
      y: screenHeight - 150,
      vx: 0,
      vy: 0,
      width: 40,
      height: 40,
      rotation: 0
    };

    // 摄像机/世界位置
    this.cameraY = 0;
    this.groundY = screenHeight - 100; // 地面Y坐标
    this.hasStartedGame = false;       // 是否已经起跳（脱离地面）

    // 难度相关
    this.difficulty = 0;
    this.bellSpacing = this.baseBellSpacing;

    // 集合
    this.bells = [];
    this.particles = [];
    this.scorePopups = [];      // 清空分数字特效
    this.backgroundStars = [];
    this.snowflakes = [];
    this.trees = [];

    // 初始化生成
    this.initWorld();
  }

  initWorld () {
    // 生成星空
    for (let i = 0; i < 60; i++) {
      this.backgroundStars.push({
        x: Math.random() * screenWidth,
        y: Math.random() * screenHeight,
        size: Math.random() * 2,
        alpha: Math.random()
      });
    }

    // 生成前景雪花
    for (let i = 0; i < 50; i++) {
      this.snowflakes.push({
        x: Math.random() * screenWidth,
        y: Math.random() * screenHeight,
        size: 2 + Math.random() * 3,
        speed: 0.2 + Math.random() * 0.8,
        swayOffset: Math.random() * Math.PI * 2
      });
    }

    // 生成初始铃铛 (从地面上方开始)
    for (let i = 0; i < 10; i++) {
      this.spawnBell(screenHeight - 250 - (i * this.baseBellSpacing));
    }

    // 生成背景雪松 (装饰)
    for (let i = 0; i < 6; i++) {
      this.trees.push({
        x: Math.random() * screenWidth,
        y: this.groundY + 15, // 稍微插在地里
        width: 50 + Math.random() * 40,
        height: 100 + Math.random() * 80,
        color: i % 2 === 0 ? '#14532d' : '#166534' // 深绿色
      });
    }
  }

  // 根据当前分数生成铃铛（越高越难，尺寸分 9 挡）
  spawnBell (y) {
    const difficulty = this.difficulty || 0;

    // --- 尺寸挡位定义 ---
    // level 0: score < 3000      -> 30
    // level 1: score ≥ 3000      -> 28
    // level 2: score ≥ 5000      -> 26
    // level 3: score ≥ 7000      -> 25
    // level 4: score ≥ 9000      -> 24
    // level 5: score ≥ 11000     -> 23
    // level 6: score ≥ 12000     -> 22  (原来的“最小”)
    // level 7: score ≥ 14000     -> 21  (新增档位 1)
    // level 8: score ≥ 16000     -> 20  (新增档位 2，最终最小)
    const SCORE_LEVEL_THRESHOLDS = [0, 3000, 5000, 7000, 9000, 11000, 12000, 14000, 16000];
    const SIZE_LEVEL_VALUES      = [30, 28, 26, 25, 24, 23, 22, 21, 20];

    // 当前分数对应哪一档
    let level = 0;
    for (let i = 1; i < SCORE_LEVEL_THRESHOLDS.length; i++) {
      if (this.score >= SCORE_LEVEL_THRESHOLDS[i]) {
        level = i;
      } else {
        break;
      }
    }

    // 防止越界
    if (level < 0) level = 0;
    if (level >= SIZE_LEVEL_VALUES.length) {
      level = SIZE_LEVEL_VALUES.length - 1;
    }

    const size = SIZE_LEVEL_VALUES[level];

    // 左右摆动速度仍然用 difficulty 来控制（和高度相关）
    const oscBase = 0.02 + Math.random() * 0.03;
    const oscSpeed = oscBase * (1 + difficulty * 0.5);

    const isBoost = Math.random() > 0.9;

    // 判定半径跟随尺寸变化
    const hitRadius = size * 0.75; // 可以按手感 0.7~0.8 微调

    this.bells.push({
      x: Math.random() * (screenWidth - 80) + 40,
      y,
      type: isBoost ? 'BOOST' : 'NORMAL',
      width: size,
      height: size,
      hitRadius,
      active: true,
      oscillation: Math.random() * Math.PI,
      oscSpeed
    });
  }

  spawnParticles (x, y, color) {
    const count = 12;
    const speed = 15.0;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        color,
        age: 0
      });
    }
  }

  touchHandler (e) {
    const x = e.touches[0].clientX;
    const isTouchStart = e.type === 'touchstart';

    // 菜单界面点击开始：只接受 touchstart，避免滑动误触
    if (this.state === 'MENU') {
      if (!isTouchStart) return;

      this.reset();
      this.state = 'PLAYING';
      this.audio.playBGM();

      // 第一次起跳
      this.rabbit.vy = CONSTANTS.JUMP_FORCE;
      this.hasStartedGame = true;

      // 瞬间移动到手指位置方便操作
      this.rabbit.x = x;
      this.targetX = x;

      this.audio.playJump('NORMAL');
      return;
    }

    // GAMEOVER 状态：只在冷却结束后 + touchstart 才能重开
    if (this.state === 'GAMEOVER') {
      if (!this.canRestart || !isTouchStart) {
        return;
      }

      this.reset();
      this.state = 'PLAYING';
      this.audio.playBGM();

      this.rabbit.vy = CONSTANTS.JUMP_FORCE;
      this.hasStartedGame = true;

      this.rabbit.x = x;
      this.targetX = x;

      this.audio.playJump('NORMAL');
      return;
    }

    // 游戏中更新目标位置（start + move 都可以调整）
    if (this.state === 'PLAYING') {
      this.targetX = x;
    }
  }

  update () {
    // 在 GAMEOVER 状态里更新一下“是否可以重开”的时间
    if (this.state === 'GAMEOVER' && !this.canRestart) {
      if (Date.now() - this.lastGameOverTime > GAMEOVER_RESTART_DELAY) {
        this.canRestart = true;
      }
    }

    // 无论什么状态，雪花都飘动
    this.updateSnowflakes();

    if (this.state !== 'PLAYING') return;

    // 难度随高度提升而增加（仍然用于重力、间距、摆动等）
    this.difficulty = Math.min(1.5, this.cameraY / (screenHeight * 4));
    const difficulty = this.difficulty;

    // 1. 兔子水平移动 (平滑跟随)
    if (this.targetX !== undefined) {
      this.rabbit.x += (this.targetX - this.rabbit.x) * CONSTANTS.MOVE_SPEED;
    }

    // 边界处理 (穿墙)
    if (this.rabbit.x > screenWidth) this.rabbit.x = 0;
    if (this.rabbit.x < 0) this.rabbit.x = screenWidth;

    // 2. 兔子垂直物理
    let currentGravity = CONSTANTS.GRAVITY * (1 + difficulty * 0.4);

    if (Math.abs(this.rabbit.vy) < 1.5) {
      currentGravity *= 0.65;
    }

    this.rabbit.vy += currentGravity;
    this.rabbit.y += this.rabbit.vy;

    // 旋转角度 (基于水平速度)
    this.rabbit.rotation = (this.targetX !== undefined ? this.targetX - this.rabbit.x : 0) * 0.003;

    // 3. 地板与死亡逻辑
    const absoluteGroundY = this.groundY + this.cameraY;

    if (this.hasStartedGame) {
      // 掉出屏幕底部 -> 立即 Game Over
      if (this.rabbit.y > screenHeight + 50) {
        this.gameOver();
      }

      // 起跳后又掉回地面
      if (absoluteGroundY < screenHeight &&
          this.rabbit.y + this.rabbit.height / 2 >= absoluteGroundY) {
        this.gameOver();
      }
    }

    // 4. 摄像机跟随 (只能向上)
    const threshold = screenHeight * 0.45;
    if (this.rabbit.y < threshold) {
      const diff = threshold - this.rabbit.y;
      this.rabbit.y = threshold;
      this.cameraY += diff;
      this.score += Math.floor(diff * 0.5);

      // 随高度增加铃铛间距，变得更难
      this.bellSpacing = this.baseBellSpacing + difficulty * 40;

      // 所有铃铛下移
      this.bells.forEach(b => { b.y += diff; });
      // 所有粒子下移
      this.particles.forEach(p => { p.y += diff; });
      // 分数弹出文字也要跟着世界一起下移
      if (this.scorePopups) {
        this.scorePopups.forEach(s => { s.y += diff; });
      }
      // 地板和树下移
      this.groundY += diff;
      this.trees.forEach(t => { t.y += diff; });

      // 生成新铃铛 (在屏幕顶部上方)
      const highestBellY = this.bells.length > 0 ? this.bells[this.bells.length - 1].y : 0;
      if (highestBellY > -50) {
        this.spawnBell(highestBellY - this.bellSpacing);
      }
    }

    // 5. 碰撞检测 (只在下落时触发)
    if (this.rabbit.vy > 0) {
      this.bells.forEach(bell => {
        if (!bell.active) return;

        const bellCx = bell.x;
        const bellCy = bell.y;
        const rabbitFootX = this.rabbit.x;
        const rabbitFootY = this.rabbit.y + 15;

        const dx = rabbitFootX - bellCx;
        const dy = rabbitFootY - bellCy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 判定半径优先使用每个铃铛自己的 hitRadius
        const hitRadius = bell.hitRadius || (26 - difficulty * 4); // 兼容旧逻辑
        if (dist < hitRadius) {
          bell.active = false;

          const baseForce = bell.type === 'BOOST'
            ? CONSTANTS.BOOST_FORCE
            : CONSTANTS.JUMP_FORCE;
          const difficultyScale = 1 + difficulty * 0.25;
          this.rabbit.vy = baseForce * difficultyScale;

          this.audio.playJump(bell.type);

          let particleColor = CONSTANTS.COLORS.bellNormal;
          if (bell.type === 'BOOST') particleColor = CONSTANTS.COLORS.bellBoost;

          // 铃铛散开粒子特效
          this.spawnParticles(bell.x, bell.y, particleColor);

          // 分数弹出特效：在铃铛中心显示当前分数
          if (!this.scorePopups) this.scorePopups = [];
          this.scorePopups.push({
            x: bell.x,
            y: bell.y,
            text: this.score.toString(),  // 当前分数
            life: 1.0,
            age: 0,
            vy: -1.2                      // 向上飘一点
          });

        }
      });
    }

    // 6. 清理多余元素
    this.bells = this.bells.filter(b => b.y < screenHeight + 50);

    // 粒子更新
    this.particles.forEach(p => {
      p.age++;

      if (p.age <= 12) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.75;
        p.vy *= 0.75;
      }
      if (p.age > 20) {
        p.life -= 0.1;
      }
    });
    this.particles = this.particles.filter(p => p.life > 0);

    // 分数弹出文字更新
    if (this.scorePopups) {
      this.scorePopups.forEach(s => {
        s.age++;
        s.y += s.vy;   // 慢慢往上
        // 稍微减速
        s.vy *= 0.9;
        // 缓慢淡出
        s.life -= 0.03;
      });
      this.scorePopups = this.scorePopups.filter(s => s.life > 0);
    }
  }

  updateSnowflakes () {
    this.snowflakes.forEach(s => {
      s.y += s.speed;
      s.x += Math.sin(Date.now() * 0.001 + s.swayOffset) * 0.5;

      if (s.y > screenHeight) {
        s.y = -10;
        s.x = Math.random() * screenWidth;
      }
      if (s.x > screenWidth) s.x = 0;
      if (s.x < 0) s.x = screenWidth;
    });
  }

  gameOver () {
    this.state = 'GAMEOVER';
    this.canRestart = false;
    this.lastGameOverTime = Date.now();

    this.audio.playFall();
    this.audio.stopBGM();

    if (this.score > this.highScore) {
      this.highScore = this.score;

      if (isWeChat && typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
        wx.setStorageSync('highscore', this.highScore);
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem('highscore', String(this.highScore));
      }
    }
  }

  draw () {
    // 清屏
    ctx.clearRect(0, 0, screenWidth, screenHeight);

    // 1. 背景 (星空渐变)
    const grad = ctx.createLinearGradient(0, 0, 0, screenHeight);
    grad.addColorStop(0, CONSTANTS.COLORS.bgStart);
    grad.addColorStop(1, CONSTANTS.COLORS.bgEnd);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, screenWidth, screenHeight);

    // 星星闪烁
    ctx.fillStyle = '#FFF';
    this.backgroundStars.forEach(star => {
      ctx.globalAlpha = 0.3 + Math.sin(Date.now() * 0.005 + star.x) * 0.2;
      const parallaxY = (star.y + this.cameraY * 0.05) % screenHeight;
      const wrappedY = parallaxY < 0 ? parallaxY + screenHeight : parallaxY;

      ctx.beginPath();
      ctx.arc(star.x, wrappedY, star.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    ctx.save();

    // 2. 绘制地板，房子与雪松
    if (this.groundY < screenHeight + 200) {
      // 背景小屋
      this.drawHouse(screenWidth * 0.2, this.groundY);

      // 雪松
      this.trees.forEach(tree => {
        if (tree.y > -200 && tree.y < screenHeight + 200) {
          this.drawPineTree(tree.x, tree.y, tree.width, tree.height, tree.color);
        }
      });

      // 地板
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(0, this.groundY, screenWidth, screenHeight);

      // 积雪层
      ctx.fillStyle = '#f1f5f9';
      ctx.beginPath();
      ctx.moveTo(0, this.groundY);
      ctx.bezierCurveTo(
        screenWidth / 3, this.groundY - 10,
        screenWidth * 2 / 3, this.groundY + 10,
        screenWidth, this.groundY
      );
      ctx.lineTo(screenWidth, this.groundY + 30);
      ctx.lineTo(0, this.groundY + 30);
      ctx.fill();
    }

    // 3. 铃铛（按尺寸缩放）
    this.bells.forEach(bell => {
      if (!bell.active) return;
      this.drawBell(bell);
    });

    // 4. 粒子
    this.particles.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // 4.5 分数弹出文字（显示当前得分）
    if (this.scorePopups && this.scorePopups.length > 0) {
      ctx.save();
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      this.scorePopups.forEach(s => {
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.fillStyle = '#facc15'; // 和蝴蝶结同色，比较亮
        ctx.fillText(s.text, s.x, s.y);
      });
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // 5. 兔子
    this.drawRabbit(this.rabbit.x, this.rabbit.y, this.rabbit.vy, this.rabbit.rotation);

    // 6. 雪花 (前景)
    ctx.fillStyle = '#ffffff';
    this.snowflakes.forEach(s => {
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // 7. UI
    ctx.restore();

    // 分数
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this.score.toString(), 20, 50);

    // 菜单 / 结束 UI
    if (this.state === 'MENU') {
      this.drawUIOverlay('圣诞跳一跳', '点击开始游戏', '最高分: ' + this.highScore);
    } else if (this.state === 'GAMEOVER') {
      this.drawUIOverlay('游戏结束', '点击重试', '得分: ' + this.score);
    }
  }

  drawUIOverlay (title, subtitle, detail) {
    // 整体遮罩
    ctx.fillStyle = 'rgba(11, 16, 38, 0.70)';
    ctx.fillRect(0, 0, screenWidth, screenHeight);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;

    // 卡片背景
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';

    const cardW = 320;
    const cardH = 340;
    const cardX = centerX - cardW / 2;
    const cardY = centerY - cardH / 2;

    drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, 20);
    ctx.fill();
    ctx.restore();

    // 顶部小兔子图标
    const bounceY = Math.sin(Date.now() * 0.005) * 5;
    this.drawRabbitIcon(centerX, cardY + 60 + bounceY);

    // Title
    ctx.font = 'bold 42px sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText(title, centerX, cardY + 140);

    // Subtitle
    const pulse = 0.6 + Math.abs(Math.sin(Date.now() * 0.003)) * 0.4;
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = 'rgba(239, 68, 68,' + pulse + ')';
    ctx.fillText(subtitle, centerX, cardY + 200);

    // Detail
    ctx.fillStyle = '#64748b';
    ctx.font = '20px sans-serif';
    ctx.fillText(detail, centerX, cardY + 250);
  }

  // 简化的兔子图标用于UI
  drawRabbitIcon (x, y) {
    ctx.save();
    ctx.translate(x, y);
    const scale = 1.2;
    ctx.scale(scale, scale);

    // 耳朵
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.ellipse(-10, -25, 6, 18, -0.2, 0, Math.PI * 2);
    ctx.ellipse(10, -25, 6, 18, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // 耳内
    ctx.fillStyle = '#fbcfe8';
    ctx.beginPath();
    ctx.ellipse(-10, -25, 3, 12, -0.2, 0, Math.PI * 2);
    ctx.ellipse(10, -25, 3, 12, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // 头
    ctx.fillStyle = '#f1f5f9';
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();

    // 表情
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(-8, -4, 2.5, 0, Math.PI * 2);
    ctx.arc(8, -4, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.arc(0, 3, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // 绘制背景小屋
  drawHouse (x, y) {
    const houseW = 80;
    const houseH = 60;

    // 烟囱
    ctx.fillStyle = '#7c2d12';
    ctx.fillRect(x + houseW * 0.55, y - houseH * 1.3, 15, 30);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + houseW * 0.53, y - houseH * 1.35, 19, 8);

    // 房子主体
    ctx.fillStyle = '#9a3412';
    ctx.fillRect(x, y - houseH, houseW, houseH);

    // 窗户
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(x + houseW * 0.2, y - houseH * 0.6, 25, 25);
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + houseW * 0.2, y - houseH * 0.6, 25, 25);
    ctx.beginPath();
    ctx.moveTo(x + houseW * 0.2 + 12.5, y - houseH * 0.6);
    ctx.lineTo(x + houseW * 0.2 + 12.5, y - houseH * 0.6 + 25);
    ctx.moveTo(x + houseW * 0.2, y - houseH * 0.6 + 12.5);
    ctx.lineTo(x + houseW * 0.2 + 25, y - houseH * 0.6 + 12.5);
    ctx.stroke();

    // 屋顶
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(x - 10, y - houseH);
    ctx.lineTo(x + houseW / 2, y - houseH * 1.5);
    ctx.lineTo(x + houseW + 10, y - houseH);
    ctx.fill();

    // 烟雾
    const time = Date.now() * 0.001;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    for (let i = 0; i < 3; i++) {
      const puffY = y - houseH * 1.4 - (i * 15) - (time * 10 % 20);
      const puffX = x + houseW * 0.6 + Math.sin(time + i) * 5;
      ctx.beginPath();
      ctx.arc(puffX, puffY, 6 + i * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawPineTree (x, y, w, h, color) {
    // 树干
    ctx.fillStyle = '#451a03';
    ctx.fillRect(x - w * 0.1, y, w * 0.2, h * 0.25);

    // 树冠
    const layers = 3;
    for (let i = 0; i < layers; i++) {
      const layerWidth = w * (1 - i * 0.25);
      const layerHeight = h * 0.4;
      const layerY = y - (i * h * 0.25);

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, layerY - layerHeight);
      ctx.lineTo(x + layerWidth / 2, layerY);
      ctx.lineTo(x - layerWidth / 2, layerY);
      ctx.fill();

      // 树上的积雪装饰
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.moveTo(x, layerY - layerHeight);
      ctx.lineTo(x + layerWidth / 6, layerY - layerHeight + 10);
      ctx.lineTo(x - layerWidth / 6, layerY - layerHeight + 10);
      ctx.fill();
    }
  }

  // 铃铛绘制：根据 bell.width 做缩放
  drawBell (bell) {
    const { x, y, type, oscillation, width } = bell;

    ctx.save();
    ctx.translate(x, y);

    const swing = Math.sin(Date.now() * 0.003 + oscillation) * 0.15;
    ctx.rotate(swing);

    // 以 width 为基准做整体缩放（30 视为基础尺寸）
    const BASE_SIZE = 30;
    const size = width || BASE_SIZE;
    const scale = size / BASE_SIZE;
    ctx.scale(scale, scale);

    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;

    let mainColor = CONSTANTS.COLORS.bellNormal;
    let strokeColor = '#475569';

    if (type === 'BOOST') {
      mainColor = CONSTANTS.COLORS.bellBoost;
      strokeColor = '#7f1d1d';
    }

    ctx.fillStyle = mainColor;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = strokeColor;

    ctx.beginPath();
    ctx.arc(0, 0, 16, Math.PI, 0);
    ctx.bezierCurveTo(16, 16, 18, 18, 20, 22);
    ctx.lineTo(-20, 22);
    ctx.bezierCurveTo(-18, 18, -16, 16, -16, 0);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();

    // BOOST 蝴蝶结
    if (type === 'BOOST') {
      ctx.save();
      ctx.fillStyle = CONSTANTS.COLORS.bow;
      ctx.shadowColor = 'rgba(0,0,0,0.2)';
      ctx.shadowBlur = 2;

      // 左
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(-14, -18);
      ctx.lineTo(-14, -4);
      ctx.fill();
      // 右
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(14, -18);
      ctx.lineTo(14, -4);
      ctx.fill();
      // 中间结
      ctx.beginPath();
      ctx.arc(0, -10, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(-8, -5, 4, 8, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // 铃铛底部的球
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.arc(0, 22, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawRabbit (x, y, vy, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);

    // 挤压拉伸效果
    let scaleX = 1;
    let scaleY = 1;

    const speed = Math.abs(vy);
    if (speed > 1) {
      scaleY = 1 + Math.min(speed * 0.03, 0.2);
      scaleX = 1 - Math.min(speed * 0.03, 0.2);
    } else {
      scaleY = 0.95;
      scaleX = 1.05;
    }
    ctx.scale(scaleX, scaleY);

    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 5;

    // 耳朵
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(-10, -25, 6, 18, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fbcfe8';
    ctx.beginPath();
    ctx.ellipse(-10, -25, 3, 12, -0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(10, -25, 6, 18, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fbcfe8';
    ctx.beginPath();
    ctx.ellipse(10, -25, 3, 12, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // 身体
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 圣诞帽
    ctx.save();
    ctx.rotate(-0.1);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(-16, -18);
    ctx.lineTo(16, -18);
    ctx.lineTo(0, -45);
    ctx.fill();

    ctx.fillStyle = '#f1f5f9';
    drawRoundedRectPath(ctx, -18, -22, 36, 8, 4);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, -45, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 脸部
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(-8, -4, 2.5, 0, Math.PI * 2);
    ctx.arc(8, -4, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 腮红
    ctx.fillStyle = 'rgba(244, 114, 182, 0.4)';
    ctx.beginPath();
    ctx.arc(-12, 2, 4, 0, Math.PI * 2);
    ctx.arc(12, 2, 4, 0, Math.PI * 2);
    ctx.fill();

    // 鼻子
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.arc(0, 3, 3, 0, Math.PI * 2);
    ctx.fill();

    // 手
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-6, 12, 5, 0, Math.PI * 2);
    ctx.arc(6, 12, 5, 0, Math.PI * 2);
    ctx.fill();

    // 脚
    const legOffset = vy < 0 ? 12 : 18;
    ctx.beginPath();
    ctx.ellipse(-10, legOffset, 5, 7, -0.2, 0, Math.PI * 2);
    ctx.ellipse(10, legOffset, 5, 7, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  loop () {
    this.update();
    this.draw();
    this.aniId = raf(this.loop);
  }
}

// 启动游戏
new Main();
