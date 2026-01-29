// =======================================================
// 🐰 圣诞兔兔跳一跳 (Christmas Bunny Jump)
// =======================================================
// 版本特性：
// 1. 核心玩法：垂直跳跃平台跳跃
// 2. 进阶机制：3000分后解锁连击、飞鸟、特殊铃铛
// 3. 社交系统：星星获取、送出与复活机制
// =======================================================

/**
 * 帧循环封装：兼容小游戏环境(requestAnimationFrame)与普通环境
 */
const raf = (typeof requestAnimationFrame === 'function')
  ? function (cb) { return requestAnimationFrame(cb); }
  : function (cb) { return setTimeout(cb, 1000 / 60); };

// --- 屏幕 & Canvas 初始化 ---
const isWeChat = typeof wx !== 'undefined';

let screenWidth, screenHeight;
let canvas, ctx;

// 适配微信小游戏环境
if (isWeChat) {
  const sysInfo = wx.getSystemInfoSync();
  screenWidth = sysInfo.windowWidth;
  screenHeight = sysInfo.windowHeight;
  canvas = wx.createCanvas();
  canvas.width = screenWidth;
  canvas.height = screenHeight;
  ctx = canvas.getContext('2d');
} else {
  // 适配浏览器调试环境
  screenWidth = window.innerWidth;
  screenHeight = window.innerHeight;
  canvas = document.getElementById('gameCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'gameCanvas';
    document.body.style.margin = '0';
    document.body.appendChild(canvas);
  }
  canvas.width = screenWidth;
  canvas.height = screenHeight;
  ctx = canvas.getContext('2d');
}

const GAMEOVER_RESTART_DELAY = 1500;

/**
 * 游戏常量配置
 */
const CONSTANTS = {
  // 物理参数
  GRAVITY: 0.15,          // 重力加速度
  JUMP_FORCE: -8.5,       // 普通跳跃力度
  BOOST_FORCE: -12.5,     // 强力跳跃力度
  MOVE_SPEED: 0.18,       // 左右移动灵敏度
  BELL_SPAWN_RATE: 70,    // 铃铛生成的垂直间距

  // 颜色配置
  COLORS: {
    bgStart: '#0b1026',   // 背景渐变上色
    bgEnd: '#2b3266',     // 背景渐变下色
    snow: '#ffffff',
    bellNormal: '#f8fafc',
    bellBoost: '#dc2626', // 红色
    bellGold: '#fbbf24',  // 金色
    bellIce: '#67e8f9',   // 冰蓝色
    bellMoving: '#a855f7',// 紫色
    bow: '#facc15'
  },

  // 进阶玩法配置 (3000分后)
  ADVANCED_MECHANICS: {
    LATEGAME_START_SCORE: 3000,
    COMBO_DECAY_TIME: 2500,       // 连击失效时间(ms)
    COMBO_MAX_BONUS: 3.0,         // 最大连击加成倍率
    BIRD_SPAWN_RATE: 0.008,       // 飞鸟生成概率/帧
    BIRD_SPEED_MIN: 1.5,
    BIRD_SPEED_MAX: 3.0,
    MOVING_BELL_PROBABILITY: 0.12,
    GOLD_BELL_PROBABILITY: 0.06,
    ICE_BELL_PROBABILITY: 0.04,
    MOVING_BELL_SPEED: 0.8,
    ICE_EFFECT_DURATION: 1500
  },

  // 社交玩法配置
  SOCIAL: {
    FIRST_STAR_SCORE: 2000,       // 首次获得星星的分数门槛
    MAX_STARS: 1,                 // 最大持有星星数
    STAR_SEND_BONUS: 100,         // 送星奖励分
    // 假玩家名字库，用于显示"XXX送来星星"
    FAKE_PLAYER_NAMES: ['小雪', '星星', '暖暖', '冬冬', '乐乐', '美美', '天天', '开心', '快乐', '幸运'],
    STAR_RECEIVE_PROBABILITY: 1.0, // 收到星星复活的概率 (1.0 = 100%)
    RESPAWN_Y_OFFSET: 200,         // 复活时向上托起的高度
    RESPAWN_GRACE_TIME: 3000       // 复活后的无敌时间
  }
};

/**
 * 音频控制器
 * 使用 WebAudio API 实时合成音效，无需加载外部音频文件，减少包体积
 */
class AudioController {
  constructor() {
    this.ctx = null;
    this.bgm = null;

    // 初始化 AudioContext
    if (isWeChat && typeof wx !== 'undefined' && typeof wx.createWebAudioContext === 'function') {
      try { this.ctx = wx.createWebAudioContext(); } catch (e) { }
    } else if (typeof window !== 'undefined') {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (typeof AC === 'function') { try { this.ctx = new AC(); } catch (e) { } }
    }

    this.initBGM();
  }

  // 初始化背景音乐 (使用 InnerAudioContext)
  initBGM() {
    try {
      if (isWeChat && typeof wx !== 'undefined' && typeof wx.createInnerAudioContext === 'function') {
        this.bgm = wx.createInnerAudioContext();
        this.bgm.src = 'audio/bgm.mp3';
        this.bgm.loop = true;
        this.bgm.volume = 0.4;
      } else if (typeof Audio !== 'undefined') {
        this.bgm = new Audio('audio/bgm.mp3');
        this.bgm.loop = true;
        this.bgm.volume = 0.4;
      }
    } catch (e) { }
  }

  playBGM() {
    if (!this.bgm || typeof this.bgm.play !== 'function') return;
    try { this.bgm.play(); } catch (e) { }
  }

  stopBGM() {
    if (!this.bgm) return;
    try {
      if (typeof this.bgm.stop === 'function') this.bgm.stop();
      else if (typeof this.bgm.pause === 'function') {
        this.bgm.pause();
        this.bgm.currentTime = 0;
      }
    } catch (e) { }
  }

  // 合成跳跃音效
  playJump(type) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    let duration = 1.0;
    // 根据铃铛类型改变音色
    if (type === 'BOOST' || type === 'MOVING') {
      osc.type = 'triangle'; // 三角波
      osc.frequency.setValueAtTime(1100, t);
      osc.frequency.linearRampToValueAtTime(1105, t + 0.1);
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.5);
      duration = 1.5;
    } else if (type === 'GOLD') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1320, t);
      osc.frequency.exponentialRampToValueAtTime(660, t + 1.2);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.2);
      duration = 1.2;
    } else if (type === 'ICE') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1760, t);
      osc.frequency.linearRampToValueAtTime(880, t + 0.8);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.8);
      duration = 0.8;
    } else {
      osc.type = 'sine'; // 正弦波
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(440, t + 1.0);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.0);
    }
    try { osc.start(t); osc.stop(t + duration); } catch (e) { }
  }

  // 合成掉落音效 (锯齿波)
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
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.linearRampToValueAtTime(0.01, t + 0.8);
    try { osc.start(t); osc.stop(t + 0.8); } catch (e) { }
  }

  // 合成连击音效 (音调随 Combo 升高)
  playCombo(combo) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    const baseFreq = 880 + (combo * 50);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.setValueAtTime(baseFreq * 1.1, t + 0.05);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    try { osc.start(t); osc.stop(t + 0.3); } catch (e) { }
  }
}

/**
 * 辅助函数：绘制圆角矩形
 */
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

class Main {
    constructor() {
        this.audio = new AudioController();
      
        this.rabbitAssets = {
          idle: [],
          jump: [],
          fall: []
        };
      
        this.animConfig = {
          idleCount: 11,
          jumpCount: 1,
          fallCount: 1,
          speed: 0.05
        };
      
        this.rabbitImagesLoaded = false;
        this.loadRabbitImages();
      
        this.titleImage = null;
        this.titleImageLoaded = false;
      
        this.state = 'MENU';
        this.difficulty = 0;
        this.baseBellSpacing = CONSTANTS.BELL_SPAWN_RATE;
        this.bellSpacing = this.baseBellSpacing;
      
        this.canRestart = true;
        this.lastGameOverTime = 0;
        this.gameOverUIAlpha = 0;
        // 游戏结束阶段：'star_send'（星星送出阶段）或 'restart'（重开阶段）
        this.gameOverPhase = 'star_send';
        this.hasHandledStar = false;

        // 界面过渡动画
        this.transition = {
          active: false,
          fromState: null,
          toState: null,
          progress: 0,
          duration: 500,
          phase: 'none'  // 'fade_out', 'fade_in'
        };

        this.score = 0;
        this.highScore = 0;
      
        this.rabbit = null;
        this.cameraY = 0;
        this.groundY = 0;
        this.hasStartedGame = false;
        this.targetX = undefined;
      
        this.bells = [];
        this.particles = [];
        this.scorePopups = [];
        this.backgroundStars = [];
        this.snowflakes = [];
        this.trees = [];
      
        this.birds = [];
        this.combo = 0;
        this.maxCombo = 0;
        this.comboTimer = 0;
        this.iceEffectTimer = 0;
        this.activeEffects = [];
        this.lastComboScore = 0;
      
        this.stars = 0;
        this.peopleHelped = 0;  // 统计帮助过的人数
        this.receiveStarAvailable = false;
        this.respawnGraceTimer = 0;
        this.respawnAnimation = null;
        this.isRespawning = false;
        this.hasReceivedStarThisGame = false;
        this.canGetStar = true;
        this.sendButtonArea = null;
        this.respawnButtonArea = null;
        this.showHelpPopup = false;  // 是否显示游戏开始时的帮助人弹窗
        this.helpPopupAlpha = 0;  // 弹窗透明度动画
        this.hasHelpPopupToShow = false;  // 是否有待显示的帮助人弹窗（送出星星后）
      
        // ==============================
        // ✅✅✅ 下面是你缺失的关键代码
        // ==============================
      
        // 1) 标题图（你写了函数但没调用）
        this.loadTitleImage();
      
        // 2) 初始化游戏世界（否则 this.rabbit 是 null，会导致 drawRabbit 报错/不画）
        this.reset();
      
        // 3) 绑定 this，防止 requestAnimationFrame 后 this 丢失
        this.loop = this.loop.bind(this);
        this.touchHandler = this.touchHandler.bind(this);

        // 3.5) 检查是否需要在启动时显示帮助弹窗
        if (this.hasHelpPopupToShow) {
          this.showHelpPopup = true;
          this.helpPopupAlpha = 0;
        }
      
        // 4) 绑定触摸事件（否则点击没有任何效果）
        if (isWeChat && typeof wx !== 'undefined') {
          wx.onTouchStart(this.touchHandler);
          wx.onTouchMove(this.touchHandler);
        } else {
          // H5 调试用
          window.addEventListener('touchstart', this.touchHandler);
          window.addEventListener('touchmove', this.touchHandler);
          window.addEventListener('mousedown', (e) => {
            this.touchHandler({
              type: 'touchstart',
              touches: [{ clientX: e.clientX, clientY: e.clientY }]
            });
          });
          window.addEventListener('mousemove', (e) => {
            this.touchHandler({
              type: 'touchmove',
              touches: [{ clientX: e.clientX, clientY: e.clientY }]
            });
          });
        }
      
        // 5) ✅启动主循环（否则永远黑屏）
        this.loop();
      }
      

  loadRabbitImages() {
    const self = this;
    const totalImages = this.animConfig.idleCount + this.animConfig.jumpCount + this.animConfig.fallCount;
    let loadedCount = 0;

    const loadGroup = (prefix, count, targetArray, padZero = false) => {
      for (let i = 0; i < count; i++) {
        let indexStr = i.toString();
        if (padZero) indexStr = indexStr.padStart(2, '0');
        const src = 'images/' + prefix + '_' + indexStr + '.png'; 
        
        let img;
        if (isWeChat && typeof wx !== 'undefined' && typeof wx.createImage === 'function') {
          img = wx.createImage();
        } else {
          img = new Image();
        }

        img.onload = function () {
          loadedCount++;
          if (loadedCount >= totalImages) {
            self.rabbitImagesLoaded = true;
            console.log('所有兔子动画资源加载完毕');
          }
        };
        img.onerror = function (e) {
          console.warn('图片加载失败:', src, e);
        };

        img.src = src;
        targetArray.push(img);
      }
    };

    loadGroup('rabbit_idle', this.animConfig.idleCount, this.rabbitAssets.idle, true);
    loadGroup('rabbit_jump', this.animConfig.jumpCount, this.rabbitAssets.jump, false);
    loadGroup('rabbit_fall', this.animConfig.fallCount, this.rabbitAssets.fall, false);
  }

  loadTitleImage() {
    const self = this;
    const src = 'images/title.png';
    if (isWeChat && typeof wx !== 'undefined' && typeof wx.createImage === 'function') {
      const img = wx.createImage();
      img.onload = function () { self.titleImage = img; self.titleImageLoaded = true; };
      img.src = src;
    } else if (typeof Image !== 'undefined') {
      const img = new Image();
      img.onload = function () { self.titleImage = img; self.titleImageLoaded = true; };
      img.src = src;
    }
  }

  // --- 游戏重置 ---
  reset(resetRabbit = true) {
    this.score = 0;
    // 从本地存储读取数据
    if (isWeChat && typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      this.highScore = Number(wx.getStorageSync('highscore') || 0);
      this.stars = Number(wx.getStorageSync('stars') || 0);
      this.peopleHelped = Number(wx.getStorageSync('peopleHelped') || 0);
      this.hasHelpPopupToShow = wx.getStorageSync('hasHelpPopupToShow') === 'true';
    } else if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('highscore');
      this.highScore = stored ? Number(stored) : 0;
      this.stars = Number(localStorage.getItem('stars') || 0);
      this.peopleHelped = Number(localStorage.getItem('peopleHelped') || 0);
      this.hasHelpPopupToShow = localStorage.getItem('hasHelpPopupToShow') === 'true';
    } else {
      this.highScore = 0;
      this.stars = 0;
      this.peopleHelped = 0;
      this.hasHelpPopupToShow = false;
    }

    // 初始化兔子位置（仅在完全重置时）
    if (resetRabbit) {
      this.rabbit = {
        x: screenWidth / 2,
        y: screenHeight - 135,
        vx: 0,
        vy: 0,
        width: 77, 
        height: 77,
        rotation: 0,
        facing: 1
      };
      this.cameraY = 0;
      this.groundY = screenHeight - 100;
      this.hasStartedGame = false;
    } else {
      // 只重置相机和地面
      this.cameraY = 0;
      this.groundY = screenHeight - 100;
    }

    this.difficulty = 0;
    this.bellSpacing = this.baseBellSpacing;

    // 清空实体数组
    this.bells = [];
    this.particles = [];
    this.scorePopups = [];
    // 背景装饰不完全清空，避免闪烁
    if (!this.backgroundStars || this.backgroundStars.length === 0) {
      this.backgroundStars = [];
      for (let i = 0; i < 60; i++) {
        this.backgroundStars.push({ x: Math.random() * screenWidth, y: Math.random() * screenHeight, size: Math.random() * 2, alpha: Math.random() });
      }
    }
    if (!this.snowflakes || this.snowflakes.length === 0) {
      this.snowflakes = [];
      for (let i = 0; i < 50; i++) {
        this.snowflakes.push({ x: Math.random() * screenWidth, y: Math.random() * screenHeight, size: 2 + Math.random() * 3, speed: 0.2 + Math.random() * 0.8, swayOffset: Math.random() * Math.PI * 2 });
      }
    }
    this.trees = [];
    this.birds = [];
    
    // 重置状态
    this.combo = 0;
    this.maxCombo = 0;
    this.comboTimer = 0;
    this.iceEffectTimer = 0;
    this.activeEffects = [];
    this.lastComboScore = 0;
    
    // 重置社交状态
    this.receiveStarAvailable = false;
    this.respawnGraceTimer = 0;
    this.respawnAnimation = null;
    this.isRespawning = false;
    this.hasReceivedStarThisGame = false;
    this.canGetStar = true;
    this.sendButtonArea = null;
    this.respawnButtonArea = null;
    
    this.gameOverUIAlpha = 0;
    // 游戏结束阶段重置
    this.gameOverPhase = 'star_send';
    this.hasHandledStar = false;
    this.initWorld();
  }

  // 初始化世界场景
  initWorld() {
    // 背景装饰
    for (let i = 0; i < 60; i++) {
      this.backgroundStars.push({ x: Math.random() * screenWidth, y: Math.random() * screenHeight, size: Math.random() * 2, alpha: Math.random() });
    }
    for (let i = 0; i < 50; i++) {
      this.snowflakes.push({ x: Math.random() * screenWidth, y: Math.random() * screenHeight, size: 2 + Math.random() * 3, speed: 0.2 + Math.random() * 0.8, swayOffset: Math.random() * Math.PI * 2 });
    }
    // 初始铃铛
    for (let i = 0; i < 10; i++) {
      this.spawnBell(screenHeight - 250 - (i * this.baseBellSpacing));
    }
    // 地面装饰树
    for (let i = 0; i < 6; i++) {
      this.trees.push({ x: Math.random() * screenWidth, y: this.groundY + 15, width: 50 + Math.random() * 40, height: 100 + Math.random() * 80, color: i % 2 === 0 ? '#14532d' : '#166534' });
    }
  }

  // --- 生成逻辑 ---
  
  // 生成铃铛（平台）
  spawnBell(y) {
    const difficulty = this.difficulty || 0;
    const SCORE_LEVEL_THRESHOLDS = [0, 3000, 5000, 7000, 9000, 11000];
    const SIZE_LEVEL_VALUES = [30, 28, 26, 25, 24, 23];

    let level = 0;
    for (let i = 1; i < SCORE_LEVEL_THRESHOLDS.length; i++) {
      if (this.score >= SCORE_LEVEL_THRESHOLDS[i]) level = i; else break;
    }
    const size = SIZE_LEVEL_VALUES[Math.min(level, SIZE_LEVEL_VALUES.length - 1)];
    const oscBase = 0.02 + Math.random() * 0.03;
    const oscSpeed = oscBase * (1 + difficulty * 0.5);
    
    let bellType = 'NORMAL';
    let bellData = {
      x: Math.random() * (screenWidth - 80) + 40,
      y,
      type: bellType,
      width: size,
      height: size,
      hitRadius: size * 0.75,
      active: true,
      oscillation: Math.random() * Math.PI,
      oscSpeed
    };

    const isLateGame = this.score >= CONSTANTS.ADVANCED_MECHANICS.LATEGAME_START_SCORE;
    const rand = Math.random();

    // 进阶阶段的特殊铃铛生成
    if (isLateGame) {
      if (this.score >= 6000 && rand < CONSTANTS.ADVANCED_MECHANICS.GOLD_BELL_PROBABILITY) {
        bellData.type = 'GOLD';
        bellData.hitRadius = size * 0.85;
      } else if (this.score >= 9000 && rand < CONSTANTS.ADVANCED_MECHANICS.ICE_BELL_PROBABILITY) {
        bellData.type = 'ICE';
        bellData.hitRadius = size * 0.7;
      } else if (rand < CONSTANTS.ADVANCED_MECHANICS.MOVING_BELL_PROBABILITY) {
        bellData.type = 'MOVING';
        bellData.moveDir = Math.random() > 0.5 ? 1 : -1;
        bellData.moveSpeed = CONSTANTS.ADVANCED_MECHANICS.MOVING_BELL_SPEED * (1 + difficulty * 0.3);
      } else if (rand > 0.9 - difficulty * 0.1) {
        bellData.type = 'BOOST';
      }
    } else {
      const isBoost = rand > 0.9;
      if (isBoost) {
        bellData.type = 'BOOST';
      }
    }

    this.bells.push(bellData);
  }

  // 生成飞鸟（敌人）
  spawnBird(y) {
    const config = CONSTANTS.ADVANCED_MECHANICS;
    const fromLeft = Math.random() > 0.5;
    const speed = config.BIRD_SPEED_MIN + Math.random() * (config.BIRD_SPEED_MAX - config.BIRD_SPEED_MIN);
    
    this.birds.push({
      x: fromLeft ? -40 : screenWidth + 40,
      y: y,
      width: 35,
      height: 25,
      speed: speed * (fromLeft ? 1 : -1),
      wingAngle: 0,
      active: true
    });
  }

  spawnParticles(x, y, color) {
    const count = 12;
    const speed = 15.0;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1.0, color, age: 0 });
    }
  }

  spawnEffectPopup(text, color) {
    this.activeEffects.push({
      text: text,
      color: color,
      life: 1.5,
      age: 0,
      y: screenHeight * 0.3
    });
  }

  // --- 输入处理 ---
  touchHandler(e) {
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const isTouchStart = e.type === 'touchstart';

    // 处理帮助人弹窗的点击关闭
    if (this.showHelpPopup && isTouchStart) {
      const centerX = screenWidth / 2;
      const centerY = screenHeight / 2;
      const cardW = 280;
      const cardH = 200;
      const cardX = centerX - cardW / 2;
      const cardY = centerY - cardH / 2;

      // 检查是否点击了确认按钮区域
      const confirmBtn = { x: cardX + 40, y: cardY + 155, w: 200, h: 35 };
      if (x >= confirmBtn.x && x <= confirmBtn.x + confirmBtn.w &&
          y >= confirmBtn.y && y <= confirmBtn.y + confirmBtn.h) {
        this.showHelpPopup = false;
        this.hasHelpPopupToShow = false;
        // 清除本地存储的弹窗显示标记
        if (isWeChat && typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
          wx.setStorageSync('hasHelpPopupToShow', 'false');
        } else if (typeof localStorage !== 'undefined') {
          localStorage.setItem('hasHelpPopupToShow', 'false');
        }
        return;
      }

      // 点击其他位置不关闭弹窗
      return;
    }

    // 菜单 -> 开始游戏
    if (this.state === 'MENU') {
      // 如果显示帮助弹窗，不处理开始游戏
      if (this.showHelpPopup) {
        if (isTouchStart) {
          this.showHelpPopup = false;
        }
        return;
      }

      if (!isTouchStart) return;

      // 保存点击位置
      const startX = x;

      // 先重置游戏世界（但不重置兔子位置）
      this.reset(false);  // 传入 false 表示不重置兔子位置

      // 设置兔子位置为点击位置
      this.rabbit.x = startX;
      this.rabbit.y = screenHeight - 135;  // 重置到初始位置
      this.rabbit.vx = 0;
      this.rabbit.vy = CONSTANTS.JUMP_FORCE;
      this.targetX = startX;
      this.hasStartedGame = true;

      // 切换到 PLAYING 状态
      this.state = 'PLAYING';
      this.audio.playBGM();
      this.audio.playJump('NORMAL');
      return;
    }

    // 游戏结束 -> 按钮交互或重试
    if (this.state === 'GAMEOVER') {
      // 星星送出阶段的交互
      if (this.gameOverPhase === 'star_send') {
        if (this.sendButtonArea && isTouchStart) {
          if (x >= this.sendButtonArea.x && x <= this.sendButtonArea.x + this.sendButtonArea.w &&
              y >= this.sendButtonArea.y && y <= this.sendButtonArea.y + this.sendButtonArea.h) {
            this.sendStar();
            this.sendButtonArea = null;
            return;
          }
        }
        // 检查是否点击跳过按钮区域
        const centerX = screenWidth / 2;
        const centerY = screenHeight / 2;
        const cardW = 320;
        const cardH = 460;
        const cardX = centerX - cardW / 2;
        const cardY = centerY - cardH / 2;
        const skipBtn = { x: cardX + 100, y: cardY + 480, w: 120, h: 40 };

        if (isTouchStart &&
            x >= skipBtn.x && x <= skipBtn.x + skipBtn.w &&
            y >= skipBtn.y && y <= skipBtn.y + skipBtn.h) {
          // 启动过渡动画：界面淡出（延长到1200ms，保持节奏一致）
          this.startTransition('GAMEOVER', 'GAMEOVER', {
            starFly: false,
            duration: 1200
          });

          // 动画完成后切换到重开阶段
          setTimeout(() => {
            this.gameOverPhase = 'restart';
            this.hasHandledStar = true;
            this.sendButtonArea = null;
          }, 600);
          return;
        }
        return; // star_send 阶段不允许其他操作
      }

      // 复活按钮
      if (this.respawnButtonArea && isTouchStart) {
        if (x >= this.respawnButtonArea.x && x <= this.respawnButtonArea.x + this.respawnButtonArea.w &&
            y >= this.respawnButtonArea.y && y <= this.respawnButtonArea.y + this.respawnButtonArea.h) {
          this.respawnWithStar();
          return;
        }
      }

      // restart 阶段允许重开
      if (!this.canRestart || !isTouchStart) return;
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

    // 游戏中 -> 移动
    if (this.state === 'PLAYING') {
      this.targetX = x;
    }
  }

  // --- 游戏逻辑更新 ---
  update() {
    this.updateSnowflakes();

    // 更新界面过渡动画
    this.updateTransition();

    // 更新帮助人弹窗动画
    if (this.showHelpPopup) {
      if (this.helpPopupAlpha < 1) {
        this.helpPopupAlpha += 0.05;
        if (this.helpPopupAlpha > 1) this.helpPopupAlpha = 1;
      }
    }

    // 游戏结束逻辑
    if (this.state === 'GAMEOVER') {
      if (!this.isRespawning) {
        const now = Date.now();
        const timeSinceDeath = now - this.lastGameOverTime;
        if (timeSinceDeath > 600) {
          this.gameOverUIAlpha += 0.03; 
          if (this.gameOverUIAlpha > 1) this.gameOverUIAlpha = 1;
        }
        // 只有在 restart 阶段才能重开
        if (!this.canRestart && this.gameOverPhase === 'restart' && timeSinceDeath > GAMEOVER_RESTART_DELAY) {
          this.canRestart = true;
        }
      }
      // 更新复活动画
      if (this.isRespawning && this.respawnAnimation) {
        this.updateRespawnAnimation();
      }
      return; 
    }

    if (this.state !== 'PLAYING') return;

    const isLateGame = this.score >= CONSTANTS.ADVANCED_MECHANICS.LATEGAME_START_SCORE;
    this.difficulty = Math.min(1.5, this.cameraY / (screenHeight * 4));
    const difficulty = this.difficulty;

    // 移动控制 (冰冻减速)
    let moveMultiplier = 1.0;
    if (this.iceEffectTimer > 0) {
      moveMultiplier = 0.5;
      this.iceEffectTimer -= 16.67;
    }
    
    if (this.targetX !== undefined) {
      const dx = this.targetX - this.rabbit.x;
      this.rabbit.x += dx * CONSTANTS.MOVE_SPEED * moveMultiplier;
      if (dx > 0.5) this.rabbit.facing = 1;
      else if (dx < -0.5) this.rabbit.facing = -1;
    }

    if (this.rabbit.x > screenWidth) this.rabbit.x = 0;
    if (this.rabbit.x < 0) this.rabbit.x = screenWidth;

    // 物理重力
    let currentGravity = CONSTANTS.GRAVITY * (1 + difficulty * 0.4);
    if (Math.abs(this.rabbit.vy) < 1.5) currentGravity *= 0.65;
    this.rabbit.vy += currentGravity;
    this.rabbit.y += this.rabbit.vy;

    this.rabbit.rotation = (this.targetX !== undefined ? this.targetX - this.rabbit.x : 0) * 0.003;

    // 死亡判定 (复活无敌时间)
    const absoluteGroundY = this.groundY + this.cameraY;
    
    if (this.respawnGraceTimer > 0) {
      this.respawnGraceTimer -= 16.67;
    }
    
    if (this.hasStartedGame && this.respawnGraceTimer <= 0) {
      if (this.rabbit.y > screenHeight + 50) this.gameOver();
      if (absoluteGroundY < screenHeight && this.rabbit.y + this.rabbit.height / 2 >= absoluteGroundY) this.gameOver();
    }

    // 连击计时器
    if (isLateGame) {
      if (this.comboTimer > 0) {
        this.comboTimer -= 16.67;
        if (this.comboTimer <= 0) {
          this.combo = 0;
        }
      }
    }

    // 摄像机跟随与分数计算
    const threshold = screenHeight * 0.45;
    if (this.rabbit.y < threshold) {
      const diff = threshold - this.rabbit.y;
      this.rabbit.y = threshold;
      this.cameraY += diff;
      
      let scoreGain = Math.floor(diff * 0.5);
      if (this.combo > 0 && isLateGame) {
        const comboMultiplier = Math.min(CONSTANTS.ADVANCED_MECHANICS.COMBO_MAX_BONUS, 1 + this.combo * 0.1);
        scoreGain = Math.floor(scoreGain * comboMultiplier);
      }
      this.score += scoreGain;

      this.checkStarEarn(); // 检查是否获得星星

      // 更新所有实体位置
      this.bellSpacing = this.baseBellSpacing + difficulty * 40;
      this.bells.forEach(b => { b.y += diff; });
      this.particles.forEach(p => { p.y += diff; });
      if (this.scorePopups) this.scorePopups.forEach(s => { s.y += diff; });
      this.groundY += diff;
      this.trees.forEach(t => { t.y += diff; });
      this.birds.forEach(b => { b.y += diff; });

      const highestBellY = this.bells.length > 0 ? this.bells[this.bells.length - 1].y : 0;
      if (highestBellY > -50) this.spawnBell(highestBellY - this.bellSpacing);

      // 生成飞鸟
      if (isLateGame && Math.random() < CONSTANTS.ADVANCED_MECHANICS.BIRD_SPAWN_RATE * (1 + difficulty * 0.2)) {
        if (this.birds.length < 3) {
          const birdY = this.rabbit.y - 100 - Math.random() * 150;
          this.spawnBird(birdY);
        }
      }
    }

    // 更新移动铃铛
    if (isLateGame) {
      this.bells.forEach(bell => {
        if (bell.type === 'MOVING' && bell.active) {
          bell.x += bell.moveSpeed;
          if (bell.x < 40 || bell.x > screenWidth - 40) {
            bell.moveSpeed *= -1;
          }
        }
      });
    }

    // 更新飞鸟
    this.birds.forEach(bird => {
      bird.x += bird.speed;
      bird.wingAngle += 0.3;
      if (bird.x < -100 || bird.x > screenWidth + 100) {
        bird.active = false;
      }
    });
    this.birds = this.birds.filter(b => b.active);

    // 碰撞检测 (仅下落时)
    if (this.rabbit.vy > 0) {
      // 铃铛碰撞
      this.bells.forEach(bell => {
        if (!bell.active) return;
        const dist = Math.sqrt(Math.pow(this.rabbit.x - bell.x, 2) + Math.pow((this.rabbit.y + 15) - bell.y, 2));
        const hitRadius = bell.hitRadius || (26 - difficulty * 4);
        if (dist < hitRadius) {
          bell.active = false;
          
          let baseForce = CONSTANTS.JUMP_FORCE;
          let particleColor = CONSTANTS.COLORS.bellNormal;
          let comboAdd = 0;
          
          if (bell.type === 'BOOST') {
            baseForce = CONSTANTS.BOOST_FORCE;
            particleColor = CONSTANTS.COLORS.bellBoost;
            comboAdd = 1;
          } else if (bell.type === 'MOVING') {
            baseForce = CONSTANTS.BOOST_FORCE;
            particleColor = CONSTANTS.COLORS.bellMoving;
            comboAdd = 2;
          } else if (bell.type === 'GOLD') {
            baseForce = CONSTANTS.BOOST_FORCE * 1.2;
            particleColor = CONSTANTS.COLORS.bellGold;
            comboAdd = 3;
            this.score += 100;
            this.spawnEffectPopup('+100!', CONSTANTS.COLORS.bellGold);
          } else if (bell.type === 'ICE') {
            baseForce = CONSTANTS.JUMP_FORCE;
            particleColor = CONSTANTS.COLORS.bellIce;
            comboAdd = 1;
            this.iceEffectTimer = CONSTANTS.ADVANCED_MECHANICS.ICE_EFFECT_DURATION;
            this.spawnEffectPopup('FREEZE!', CONSTANTS.COLORS.bellIce);
          }
          
          // 计算最终跳跃力和 Combo
          let jumpForce = baseForce * (1 + difficulty * 0.25);
          if (isLateGame && this.combo > 0) {
            const comboBonus = Math.min(0.3, this.combo * 0.03);
            jumpForce *= (1 + comboBonus);
          }
          
          this.rabbit.vy = jumpForce;
          this.audio.playJump(bell.type);
          this.spawnParticles(bell.x, bell.y, particleColor);
          
          if (isLateGame) {
            this.combo += comboAdd;
            this.comboTimer = CONSTANTS.ADVANCED_MECHANICS.COMBO_DECAY_TIME;
            if (this.combo > this.maxCombo) {
              this.maxCombo = this.combo;
            }
            if (this.combo >= 5) {
              this.audio.playCombo(this.combo);
            }
            if (this.combo > 0) {
              const comboText = this.combo >= 10 ? 'SUPER!' : (this.combo >= 5 ? 'GREAT!' : 'Combo ' + this.combo);
              this.activeEffects.push({
                text: comboText,
                color: this.combo >= 10 ? '#dc2626' : (this.combo >= 5 ? '#fbbf24' : '#ffffff'),
                life: 1.0,
                age: 0,
                y: screenHeight * 0.35
              });
            }
          }
          
          if (!this.scorePopups) this.scorePopups = [];
          this.scorePopups.push({ x: bell.x, y: bell.y, text: this.score.toString(), life: 1.0, age: 0, vy: -1.2 });
        }
      });

      // 飞鸟碰撞检测（任何方向碰撞都导致游戏结束）
      this.birds.forEach(bird => {
        if (!bird.active) return;

        // 定义碰撞盒（更贴近视觉模型）
        const rabbitBox = {
          left: this.rabbit.x - this.rabbit.width * 0.35,  // 缩小到35%
          right: this.rabbit.x + this.rabbit.width * 0.35,
          top: this.rabbit.y - this.rabbit.height * 0.35,
          bottom: this.rabbit.y + this.rabbit.height * 0.35
        };

        // 飞鸟的碰撞盒（椭圆20×12，使用更精确的判定）
        const birdBox = {
          left: bird.x - 15,  // 飞鸟椭圆半径约20，留5px余量
          right: bird.x + 15,
          top: bird.y - 6,    // 飞鸟椭圆半径约12，留6px余量
          bottom: bird.y + 6
        };

        // 检测碰撞盒重叠
        const isOverlapping = rabbitBox.left < birdBox.right &&
                              rabbitBox.right > birdBox.left &&
                              rabbitBox.top < birdBox.bottom &&
                              rabbitBox.bottom > birdBox.top;

        if (isOverlapping && this.respawnGraceTimer <= 0) {
          // 撞到飞鸟，游戏结束
          this.gameOver();
        }
      });
    }

    // 清理逻辑
    this.bells = this.bells.filter(b => b.y < screenHeight + 50);
    this.particles.forEach(p => {
      p.age++;
      if (p.age <= 12) { p.x += p.vx; p.y += p.vy; p.vx *= 0.75; p.vy *= 0.75; }
      if (p.age > 20) p.life -= 0.1;
    });
    this.particles = this.particles.filter(p => p.life > 0);
    if (this.scorePopups) {
      this.scorePopups.forEach(s => { s.age++; s.y += s.vy; s.vy *= 0.9; s.life -= 0.03; });
      this.scorePopups = this.scorePopups.filter(s => s.life > 0);
    }

    this.activeEffects.forEach(e => {
      e.age++;
      e.life -= 0.02;
      e.y -= 0.5;
    });
    this.activeEffects = this.activeEffects.filter(e => e.life > 0);

    // 复活动画更新
    if (this.isRespawning && this.respawnAnimation) {
      this.updateRespawnAnimation();
    }
  }

  updateSnowflakes() {
    this.snowflakes.forEach(s => {
      s.y += s.speed;
      s.x += Math.sin(Date.now() * 0.001 + s.swayOffset) * 0.5;
      if (s.y > screenHeight) { s.y = -10; s.x = Math.random() * screenWidth; }
      if (s.x > screenWidth) s.x = 0;
      if (s.x < 0) s.x = screenWidth;
    });
  }

  // --- 社交玩法逻辑 ---
  
  checkStarEarn() {
    if (!this.canGetStar) return;

    // 获取条件：
    // 1. 首次 >2000分
    // 2. 破纪录且分数 > 2000
    const isNewRecord = this.score > this.highScore;
    const isFirstMilestone = this.stars === 0 && this.score >= CONSTANTS.SOCIAL.FIRST_STAR_SCORE;
    const canEarn = (isNewRecord && this.score >= CONSTANTS.SOCIAL.FIRST_STAR_SCORE) || isFirstMilestone;

    if (canEarn) {
      if (this.stars < CONSTANTS.SOCIAL.MAX_STARS) {
        this.stars = CONSTANTS.SOCIAL.MAX_STARS;
        this.canGetStar = false;
        this.saveSocialData();

        // 显示获得星星的提示
        if (isNewRecord && isFirstMilestone) {
          // 同时打破纪录和首次达到2000分
          this.activeEffects.push({
            text: '🏆 新纪录：' + this.score + '！',
            color: '#fbbf24',
            life: 2.5,
            age: 0,
            y: screenHeight * 0.35
          });
          this.activeEffects.push({
            text: '⭐ 恭喜获得星星！',
            color: '#fbbf24',
            life: 2.5,
            age: 0,
            y: screenHeight * 0.45
          });
        } else if (isFirstMilestone) {
          // 首次达到2000分
          this.activeEffects.push({
            text: '🎯 达成目标：' + this.score + '分！',
            color: '#fbbf24',
            life: 2.5,
            age: 0,
            y: screenHeight * 0.35
          });
          this.activeEffects.push({
            text: '⭐ 恭喜获得星星！',
            color: '#fbbf24',
            life: 2.5,
            age: 0,
            y: screenHeight * 0.45
          });
        } else if (isNewRecord) {
          // 破纪录且分数>2000
          this.activeEffects.push({
            text: '🏆 新纪录：' + this.score + '！',
            color: '#fbbf24',
            life: 2.0,
            age: 0,
            y: screenHeight * 0.4
          });
          this.activeEffects.push({
            text: '⭐ 再次获得星星！',
            color: '#fbbf24',
            life: 2.0,
            age: 0,
            y: screenHeight * 0.5
          });
        }
      }
    }
  }

  gameOver() {
    this.state = 'GAMEOVER';
    this.canRestart = false;
    this.lastGameOverTime = Date.now();
    this.gameOverUIAlpha = 0;
    this.audio.playFall();
    this.audio.stopBGM();
    
    // 更新最高分
    if (this.score > this.highScore) {
      this.highScore = this.score;
      if (isWeChat && typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
        wx.setStorageSync('highscore', this.highScore);
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem('highscore', String(this.highScore));
      }
    }

    // 触发自动复活逻辑 (伪社交)
    if (this.score >= 1000 && !this.hasReceivedStarThisGame && Math.random() < 1.0) {
      const fakeName = CONSTANTS.SOCIAL.FAKE_PLAYER_NAMES[Math.floor(Math.random() * CONSTANTS.SOCIAL.FAKE_PLAYER_NAMES.length)];
      this.startRespawnAnimation(fakeName);
      return;
    }

    // 重置游戏结束阶段
    this.gameOverPhase = 'star_send';
    this.hasHandledStar = false;

    // 设置送出按钮区域（仅在星星送出阶段）
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;
    this.sendButtonArea = this.stars > 0 ? { x: centerX - 100, y: centerY + 120, w: 200, h: 60 } : null;

    // 如果没有星星，直接进入重开阶段
    if (this.stars <= 0) {
      this.gameOverPhase = 'restart';
      this.hasHandledStar = true;
    }
  }

  saveSocialData() {
    if (isWeChat && typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync('stars', this.stars);
      wx.setStorageSync('peopleHelped', this.peopleHelped);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem('stars', String(this.stars));
      localStorage.setItem('peopleHelped', String(this.peopleHelped));
    }
  }

  sendStar() {
    if (this.stars > 0) {
      this.stars--;
      this.saveSocialData();
      this.activeEffects.push({
        text: '✨ 星星已送出！',
        color: '#fbbf24',
        life: 2.0,
        age: 0,
        y: screenHeight * 0.5
      });
      this.sendButtonArea = null;

      // 启动过渡动画：星星旋转飞走，界面淡出（延长到2000ms）
      this.startTransition('GAMEOVER', 'GAMEOVER', {
        starFly: true,
        duration: 2000
      });

      // 动画完成后切换到重开阶段
      setTimeout(() => {
        this.gameOverPhase = 'restart';
        this.hasHandledStar = true;
      }, 2000);

      // 有概率（50%）显示帮助人弹窗
      if (Math.random() < 0.5) {
        this.hasHelpPopupToShow = true;
        // 保存到本地存储
        if (isWeChat && typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
          wx.setStorageSync('hasHelpPopupToShow', 'true');
        } else if (typeof localStorage !== 'undefined') {
          localStorage.setItem('hasHelpPopupToShow', 'true');
        }
      }
    }
  }

  startTransition(fromState, toState, options = {}) {
    this.transition = {
      active: true,
      fromState: fromState,
      toState: toState,
      progress: 0,
      duration: options.duration || 500,
      starFly: options.starFly || false,
      startTime: Date.now()
    };
  }

  updateTransition() {
    if (!this.transition.active) return;

    const now = Date.now();
    const elapsed = now - this.transition.startTime;
    this.transition.progress = Math.min(1, elapsed / this.transition.duration);

    if (this.transition.progress >= 1) {
      this.transition.active = false;
    }
  }

  drawTransition() {
    if (!this.transition.active) return;

    const { progress, starFly, fromState, toState } = this.transition;
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;
    const cardH = 460;  // 星星送出界面的卡片高度

    // 星星飞出动画（仅 star_send 界面）
    if (starFly && this.gameOverPhase === 'star_send') {
      const starY = centerY - cardH / 2 + 100;

      // 缓动函数
      const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
      const easeInCubic = (t) => t * t * t;

      // 第一阶段：变大 + 开始旋转（0-30%）
      if (progress < 0.3) {
        const phaseProgress = progress / 0.3;
        const scale = 1 + phaseProgress * 0.5;  // 1x → 1.5x
        const rotation = phaseProgress * Math.PI * 0.5;  // 0 → 90度（1/4圈）
        const alpha = 1 - progress * 0.15;  // 1 → 0.955

        ctx.save();
        ctx.translate(centerX, starY);
        ctx.rotate(rotation);
        ctx.scale(scale, scale);
        ctx.globalAlpha = alpha;
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 40 + Math.sin(Date.now() * 0.01) * 20;
        ctx.font = 'bold 120px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⭐', 0, 0);
        ctx.restore();
      }
      // 第二阶段：旋转两圈（30-80%）
      else if (progress < 0.8) {
        const phaseProgress = easeOutCubic((progress - 0.3) / 0.5);  // 使用缓动
        const scale = 1.5;  // 保持1.5x
        const rotation = Math.PI * 0.5 + phaseProgress * Math.PI * 4;  // 90度 → 810度（整2圈）
        const alpha = 0.955 - (phaseProgress * 0.1);  // 0.955 → 0.855

        ctx.save();
        ctx.translate(centerX, starY);
        ctx.rotate(rotation);
        ctx.scale(scale, scale);
        ctx.globalAlpha = alpha;
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 40 + Math.sin(Date.now() * 0.01) * 20;
        ctx.font = 'bold 120px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⭐', 0, 0);
        ctx.restore();
      }
      // 第三阶段：变小 + 向上飞走（80-100%）
      else {
        const phaseProgress = easeInCubic((progress - 0.8) / 0.2);  // 加速飞走
        const scale = 1.5 - phaseProgress * 0.5;  // 1.5x → 1x
        const rotation = Math.PI * 0.5 + Math.PI * 4;  // 保持最后的旋转角度（810度）
        const targetY = -300;
        const startY = centerY - cardH / 2 + 100;
        const currentY = startY + (targetY - startY) * phaseProgress;
        const alpha = 0.855 - phaseProgress * 0.855;  // 0.855 → 0

        ctx.save();
        ctx.translate(centerX, currentY);
        ctx.rotate(rotation);
        ctx.scale(scale, scale);
        ctx.globalAlpha = alpha;
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 40 * alpha;
        ctx.font = 'bold 100px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⭐', 0, 0);
        ctx.restore();
      }
    }

    // 界面淡出效果（整个动画期间）
    if (progress < 0.7) {
      // 淡出前半段：保持显示（前70%时间）
    } else {
      // 淡出后半段：逐渐消失（后30%时间）
      const fadeProgress = (progress - 0.7) / 0.3;
      const fadeAlpha = 1 - fadeProgress;

      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      ctx.fillStyle = 'rgba(11, 16, 38, ' + (0.85 * fadeAlpha) + ')';
      ctx.fillRect(0, 0, screenWidth, screenHeight);
      ctx.restore();
    }
  }

  startRespawnAnimation(fromPlayer) {
    this.isRespawning = true;
    this.receivedStarFrom = fromPlayer;

    this.respawnAnimation = {
      phase: 'approach',
      starX: screenWidth / 2 - 300,
      starY: screenHeight + 100,
      targetX: screenWidth / 2,
      targetY: Math.max(200, screenHeight - 400),
      rabbitY: this.rabbit.y,
      progress: 0,
      duration: 2000,
      carryDuration: 1000,
      age: 0
    };

    this.activeEffects.push({
      text: '✨ ' + fromPlayer + ' 送来星星！',
      color: '#fbbf24',
      life: 3.0,
      age: 0,
      y: screenHeight * 0.3
    });
  }

  updateRespawnAnimation() {
    if (!this.respawnAnimation) return;

    const anim = this.respawnAnimation;
    anim.age += 16.67;

    if (anim.phase === 'approach') {
      anim.progress += 16.67 / anim.duration;
      if (anim.progress >= 1) {
        anim.progress = 1;
        anim.phase = 'carry';
        anim.age = 0;
      }
    } else if (anim.phase === 'carry') {
      anim.progress += 16.67 / anim.carryDuration;
      const carryProgress = Math.min(1, anim.progress);
      this.rabbit.x = anim.targetX;
      this.rabbit.y = anim.rabbitY + (anim.targetY - anim.rabbitY) * carryProgress;
      this.rabbit.vy = 0;

      if (anim.progress >= 1) {
        anim.progress = 1;
        anim.phase = 'release';
        anim.age = 0;
      }
    } else if (anim.phase === 'release') {
      anim.progress += 16.67 / 500;
      if (anim.progress >= 1) {
        this.rabbit.vy = CONSTANTS.JUMP_FORCE;
        this.respawnGraceTimer = CONSTANTS.SOCIAL.RESPAWN_GRACE_TIME;
        this.state = 'PLAYING';
        this.isRespawning = false;
        this.respawnAnimation = null;
        this.hasReceivedStarThisGame = true;
        this.audio.playBGM();
        this.audio.playJump('NORMAL');
        this.receiveStarAvailable = false;
        this.respawnButtonArea = null;

        // 收到星星（复活）时，增加帮助人数统计
        this.peopleHelped++;
        this.saveSocialData();
      }
    }
  }

  respawnWithStar() {
    if (this.receiveStarAvailable) {
      this.rabbit.y = Math.max(100, this.rabbit.y - CONSTANTS.SOCIAL.RESPAWN_Y_OFFSET);
      this.rabbit.vy = CONSTANTS.JUMP_FORCE;
      this.rabbit.x = screenWidth / 2;
      this.targetX = this.rabbit.x;

      this.respawnGraceTimer = CONSTANTS.SOCIAL.RESPAWN_GRACE_TIME;
      this.receiveStarAvailable = false;

      this.state = 'PLAYING';
      this.audio.playBGM();
      this.audio.playJump('NORMAL');

      this.respawnAnimation = {
        x: this.rabbit.x,
        y: this.rabbit.y - 50,
        scale: 1.5,
        alpha: 1,
        age: 0
      };

      this.respawnButtonArea = null;
    }
  }

  // --- 绘图函数 ---
  
  drawStarSendUI(detail, alpha = 1) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(11, 16, 38, 0.85)';
    ctx.fillRect(0, 0, screenWidth, screenHeight);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;

    // 绘制卡片背景（半透明）
    const cardW = 320;
    const cardH = 460;
    const cardX = centerX - cardW / 2;
    const cardY = centerY - cardH / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, 20);
    ctx.fill();
    ctx.restore();

    // 绘制星星图标（使用 Emoji）
    const starY = cardY + 100;
    const starScale = 1 + Math.sin(Date.now() * 0.005) * 0.08;
    ctx.save();
    ctx.translate(centerX, starY);
    ctx.scale(starScale, starScale);
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 20;
    ctx.font = 'bold 100px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⭐', 0, 0);
    ctx.restore();

    // 绘制标题
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('游戏结束', centerX, cardY + 180);

    // 绘制得分
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(detail, centerX, cardY + 220);

    // 绘制提示文字
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('你有一颗星星，要送给远方的人吗？', centerX, cardY + 280);

    // 绘制送出星星按钮
    if (this.sendButtonArea) {
      const btn = this.sendButtonArea;
      ctx.save();
      const pulse = 0.8 + Math.sin(Date.now() * 0.008) * 0.2;
      ctx.fillStyle = 'rgba(251, 191, 36, ' + pulse + ')';
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 15;
      ctx.shadowOffsetY = 5;
      drawRoundedRectPath(ctx, btn.x, btn.y, btn.w, btn.h, 30);
      ctx.fill();

      // 绘制黄色星星
      ctx.shadowBlur = 0;
      ctx.save();
      ctx.translate(btn.x + btn.w / 2, btn.y + btn.h / 2);
      ctx.font = 'bold 40px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⭐', 0, 0);
      ctx.restore();


    }

    // 绘制跳过按钮
    const skipBtn = { x: cardX + 100, y: cardY + 480, w: 120, h: 40 };
    ctx.save();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.shadowBlur = 8;
    drawRoundedRectPath(ctx, skipBtn.x, skipBtn.y, skipBtn.w, skipBtn.h, 20);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('跳过', skipBtn.x + skipBtn.w / 2, skipBtn.y + skipBtn.h / 2);
    ctx.restore();

    ctx.restore();
  }

  // 绘制帮助人弹窗
  drawHelpPopup() {
    if (!this.showHelpPopup) return;
    
    ctx.save();
    ctx.globalAlpha = this.helpPopupAlpha;
    ctx.fillStyle = 'rgba(11, 16, 38, 0.85)';
    ctx.fillRect(0, 0, screenWidth, screenHeight);

    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;
    const cardW = 280;
    const cardH = 200;
    const cardX = centerX - cardW / 2;
    const cardY = centerY - cardH / 2;

    // 绘制卡片背景
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, 20);
    ctx.fill();
    ctx.restore();

    // 绘制星星图标
    const starY = cardY + 60;
    const starScale = 1 + Math.sin(Date.now() * 0.005) * 0.08;
    ctx.save();
    ctx.translate(centerX, starY);
    ctx.scale(starScale, starScale);
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 20;
    ctx.font = 'bold 60px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⭐', 0, 0);
    ctx.restore();

    // 绘制提示文字
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('您的星星在远方', centerX, cardY + 110);
    ctx.fillText('帮助了一个人', centerX, cardY + 135);

    // 绘制确认按钮
    const confirmBtn = { x: cardX + 40, y: cardY + 155, w: 200, h: 35 };
    ctx.save();
    const pulse = 0.8 + Math.sin(Date.now() * 0.008) * 0.2;
    ctx.fillStyle = 'rgba(251, 191, 36, ' + pulse + ')';
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    drawRoundedRectPath(ctx, confirmBtn.x, confirmBtn.y, confirmBtn.w, confirmBtn.h, 17);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText('确认', centerX, cardY + 172);
    ctx.restore();

    ctx.restore();
  }

  drawStar(x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const angle = (Math.PI * 2 * i / 5) - Math.PI / 2;
      const innerAngle = angle + Math.PI / 5;
      ctx.lineTo(Math.cos(angle) * size, Math.sin(angle) * size);
      ctx.lineTo(Math.cos(innerAngle) * size * 0.4, Math.sin(innerAngle) * size * 0.4);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawRespawnAnimation() {
    const anim = this.respawnAnimation;
    if (!anim) return;

    ctx.save();

    if (anim.phase === 'approach') {
      const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
      const t = easeOutCubic(anim.progress);

      const starX = anim.starX + (anim.targetX - anim.starX) * t;
      const starY = anim.starY + (anim.targetY - anim.starY) * t;

      const starScale = 1 + Math.sin(Date.now() * 0.01) * 0.1;
      ctx.save();
      ctx.translate(starX, starY);
      ctx.scale(starScale, starScale);
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 30 + Math.sin(Date.now() * 0.008) * 10;
      ctx.font = 'bold 50px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⭐', 0, 0);
      ctx.restore();

      for (let i = 0; i < 8; i++) {
        const trailProgress = (anim.progress * 8 + i) / 8 - 1;
        if (trailProgress > 0 && trailProgress < 1) {
          const trailT = easeOutCubic(trailProgress);
          const trailX = anim.starX + (anim.targetX - anim.starX) * trailT;
          const trailY = anim.starY + (anim.targetY - anim.starY) * trailT;
          const trailScale = 0.5 * (1 - trailProgress);
          const trailAlpha = (1 - trailProgress) * 0.5;
          ctx.globalAlpha = trailAlpha;
          ctx.save();
          ctx.translate(trailX, trailY);
          ctx.scale(trailScale, trailScale);
          ctx.shadowColor = '#fbbf24';
          ctx.shadowBlur = 15;
          ctx.font = 'bold 50px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('⭐', 0, 0);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;

    } else if (anim.phase === 'carry') {
      const starX = anim.targetX;
      const starY = this.rabbit.y - 30;

      const starScale = 1 + Math.sin(Date.now() * 0.012) * 0.15;
      ctx.save();
      ctx.translate(starX, starY);
      ctx.scale(starScale, starScale);
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 40 + Math.sin(Date.now() * 0.01) * 15;
      ctx.font = 'bold 60px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⭐', 0, 0);
      ctx.restore();

      const gradient = ctx.createRadialGradient(starX, starY, 0, starX, starY, 120);
      gradient.addColorStop(0, 'rgba(251, 191, 36, 0.3)');
      gradient.addColorStop(0.5, 'rgba(251, 191, 36, 0.1)');
      gradient.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.globalAlpha = 0.5 + Math.sin(Date.now() * 0.008) * 0.2;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(starX, starY, 120, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      const rabbitScale = 0.8;
      ctx.save();
      ctx.translate(this.rabbit.x, this.rabbit.y);
      ctx.scale(rabbitScale, rabbitScale);
      if (this.rabbitAssets.idle.length > 0) {
        const frameIndex = Math.floor(Date.now() * this.animConfig.speed / 10) % this.rabbitAssets.idle.length;
        const img = this.rabbitAssets.idle[frameIndex];
        if (img) {
          ctx.drawImage(img, -this.rabbit.width / 2, -this.rabbit.height / 2, this.rabbit.width, this.rabbit.height);
        }
      }
      ctx.restore();

      for (let i = 0; i < 6; i++) {
        const angle = (Date.now() * 0.005) + (Math.PI * 2 * i / 6);
        const radius = 60 + Math.sin(Date.now() * 0.01 + i) * 10;
        const particleX = starX + Math.cos(angle) * radius;
        const particleY = starY + Math.sin(angle) * radius;
        const particleScale = 0.3 + Math.sin(Date.now() * 0.02 + i * 2) * 0.1;
        ctx.save();
        ctx.translate(particleX, particleY);
        ctx.scale(particleScale, particleScale);
        ctx.font = 'bold 50px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⭐', 0, 0);
        ctx.restore();
      }

    } else if (anim.phase === 'release') {
      const starX = anim.targetX;
      const starY = this.rabbit.y - 30;
      const starScale = 1 - anim.progress;
      const alpha = 1 - anim.progress;

      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.translate(starX, starY);
      ctx.scale(starScale, starScale);
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 50;
      ctx.font = 'bold 60px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⭐', 0, 0);
      ctx.restore();

      for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 * i / 12) + anim.progress;
        const distance = anim.progress * 100;
        const particleX = starX + Math.cos(angle) * distance;
        const particleY = starY + Math.sin(angle) * distance;
        const particleScale = 0.3 * (1 - anim.progress);
        ctx.save();
        ctx.translate(particleX, particleY);
        ctx.scale(particleScale, particleScale);
        ctx.font = 'bold 50px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⭐', 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  draw() {
    ctx.clearRect(0, 0, screenWidth, screenHeight);

    const grad = ctx.createLinearGradient(0, 0, 0, screenHeight);
    grad.addColorStop(0, CONSTANTS.COLORS.bgStart);
    grad.addColorStop(1, CONSTANTS.COLORS.bgEnd);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, screenWidth, screenHeight);

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

    if (this.groundY < screenHeight + 200) {
      this.drawHouse(screenWidth * 0.2, this.groundY);
      this.trees.forEach(tree => {
        if (tree.y > -200 && tree.y < screenHeight + 200) {
          this.drawPineTree(tree.x, tree.y, tree.width, tree.height, tree.color);
        }
      });
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(0, this.groundY, screenWidth, screenHeight);
      ctx.fillStyle = '#f1f5f9';
      ctx.beginPath();
      ctx.moveTo(0, this.groundY);
      ctx.bezierCurveTo(screenWidth / 3, this.groundY - 10, screenWidth * 2 / 3, this.groundY + 10, screenWidth, this.groundY);
      ctx.lineTo(screenWidth, this.groundY + 30);
      ctx.lineTo(0, this.groundY + 30);
      ctx.fill();
    }

    this.birds.forEach(bird => { if (bird.active) this.drawBird(bird); });
    this.bells.forEach(bell => { if (bell.active) this.drawBell(bell); });

    this.particles.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    if (this.scorePopups && this.scorePopups.length > 0) {
      ctx.save();
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      this.scorePopups.forEach(s => {
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.fillStyle = '#facc15';
        ctx.fillText(s.text, s.x, s.y);
      });
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    if (this.isRespawning && this.respawnAnimation) {
      this.drawRespawnAnimation();
    }

    if (!this.isRespawning) {
      this.drawRabbit(this.rabbit.x, this.rabbit.y, this.rabbit.vy, this.rabbit.rotation);
    }

    ctx.fillStyle = '#ffffff';
    this.snowflakes.forEach(s => {
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.restore();

    if (this.iceEffectTimer > 0) {
      ctx.save();
      ctx.globalAlpha = 0.3 + Math.sin(Date.now() * 0.01) * 0.2;
      ctx.fillStyle = '#67e8f9';
      ctx.fillRect(0, 0, screenWidth, screenHeight);
      ctx.restore();
      
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillStyle = 'rgba(103, 232, 249, 0.9)';
      ctx.fillText('❄️ FREEZE ❄️', screenWidth / 2, 80);
      ctx.restore();
    }

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // 显示最高纪录（在分数上方）
    if (this.highScore > 0) {
      ctx.font = '16px sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText('最高: ' + this.highScore, 20, 25);
    }

    // 显示当前分数
    ctx.font = 'bold 40px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(this.score.toString(), 20, 50);

    if (this.score >= CONSTANTS.ADVANCED_MECHANICS.LATEGAME_START_SCORE && this.combo > 0) {
      ctx.save();
      ctx.textAlign = 'right';
      const comboColor = this.combo >= 10 ? '#dc2626' : (this.combo >= 5 ? '#fbbf24' : '#ffffff');
      
      ctx.font = 'bold 36px sans-serif';
      ctx.fillStyle = comboColor;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 10;
      ctx.fillText(this.combo + 'x', screenWidth - 20, 50);
      
      const barWidth = 100;
      const barHeight = 6;
      const barProgress = this.comboTimer / CONSTANTS.ADVANCED_MECHANICS.COMBO_DECAY_TIME;
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(screenWidth - 20 - barWidth, 95, barWidth, barHeight);
      ctx.fillStyle = comboColor;
      ctx.fillRect(screenWidth - 20 - barWidth, 95, barWidth * barProgress, barHeight);
      ctx.restore();
    }

    this.activeEffects.forEach(e => {
      ctx.save();
      ctx.globalAlpha = e.life;
      ctx.textAlign = 'center';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillStyle = e.color;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 8;
      ctx.fillText(e.text, screenWidth / 2, e.y);
      ctx.restore();
    });

    // 显示星星图标（不显示数量，没有星星时显示暗色）
    ctx.save();
    ctx.textAlign = 'right';
    
    if (this.stars > 0) {
      // 有星星时显示亮色星星
      ctx.font = 'bold 28px sans-serif';
      ctx.fillStyle = '#fbbf24';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 8;
      ctx.fillText('⭐', screenWidth - 20, 20);
    } else {
      // 没有星星时显示暗色星星
      ctx.font = 'bold 28px sans-serif';
      ctx.fillStyle = 'rgba(251, 191, 36, 0.3)';
      ctx.fillText('⭐', screenWidth - 20, 20);
    }

    ctx.restore();

    if (!this.isRespawning) {
      if (this.state === 'MENU') {
        // 如果显示帮助弹窗，主界面变浅
        const menuAlpha = this.showHelpPopup ? 0.3 : 1;
        this.drawUIOverlay('圣诞跳一跳', '点击开始游戏', '最高分: ' + this.highScore, menuAlpha);
      } else if (this.state === 'GAMEOVER') {
        // 根据游戏结束阶段显示不同界面
        if (this.gameOverPhase === 'star_send') {
          // 阶段1：星星送出界面
          let detail = '得分: ' + this.score;
          if (this.score >= CONSTANTS.ADVANCED_MECHANICS.LATEGAME_START_SCORE && this.maxCombo > 5) {
            detail += ' | 最大连击: ' + this.maxCombo + 'x';
          }
          this.drawStarSendUI(detail, this.gameOverUIAlpha);
        } else if (this.gameOverPhase === 'restart') {
          // 阶段2：重开界面
          let detail = '得分: ' + this.score;
          if (this.score >= CONSTANTS.ADVANCED_MECHANICS.LATEGAME_START_SCORE && this.maxCombo > 5) {
            detail += ' | 最大连击: ' + this.maxCombo + 'x';
          }
          this.drawUIOverlay('游戏结束', '点击重试', detail, this.gameOverUIAlpha, false);
        }
      }
    }

    // 绘制界面过渡动画
    this.drawTransition();

    // 绘制帮助人弹窗
    this.drawHelpPopup();

    ctx.restore();
  }

  drawBird(bird) {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    
    if (bird.speed > 0) {
      ctx.scale(-1, 1);
    }
    
    ctx.fillStyle = '#374151';
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    
    const wingOffset = Math.sin(bird.wingAngle) * 8;
    ctx.fillStyle = '#6b7280';
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(-15, -5 + wingOffset);
    ctx.lineTo(-5, -3);
    ctx.closePath();
    ctx.fill();
    
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.moveTo(15, -2);
    ctx.lineTo(25, 0);
    ctx.lineTo(15, 2);
    ctx.closePath();
    ctx.fill();
    
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(10, -3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(11, -3, 1.5, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }

  drawRabbit(x, y, vy, rot) {
    if (!this.rabbitImagesLoaded) return;

    ctx.save();
    ctx.translate(x, y);

    ctx.rotate(rot);

    const dir = this.rabbit.facing || 1; 
    ctx.scale(dir, 1); 

    if (this.iceEffectTimer > 0) {
      ctx.shadowColor = '#67e8f9';
      ctx.shadowBlur = 15;
    }

    let currentSprites = this.rabbitAssets.idle;
    
    if (!this.hasStartedGame) {
      currentSprites = this.rabbitAssets.idle;
    } else {
      if (vy < -0.5) {
        currentSprites = this.rabbitAssets.jump;
      } else if (vy > 0.5) {
        currentSprites = this.rabbitAssets.fall;
      } else {
        currentSprites = this.rabbitAssets.jump;
      }
    }

    if (currentSprites.length > 0) {
      const frameIndex = Math.floor(Date.now() * this.animConfig.speed / 10) % currentSprites.length;
      const img = currentSprites[frameIndex];
      const w = this.rabbit.width;
      const h = this.rabbit.height;
      
      if (img) {
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
    }

    ctx.restore();
  }

  drawUIOverlay(title, subtitle, detail, alpha = 1, showLogo = true) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(11, 16, 38, 0.70)';
    ctx.fillRect(0, 0, screenWidth, screenHeight);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;

    // 游戏结束状态需要更大的卡片来容纳所有信息
    const isGameOver = this.state === 'GAMEOVER' && !this.isRespawning;
    const hasExtraInfo = isGameOver && (this.peopleHelped > 0);
    const cardW = 320;
    const cardH = hasExtraInfo ? 520 : 340;
    const cardX = centerX - cardW / 2;
    const cardY = centerY - cardH / 2;

    if (showLogo && this.titleImage && this.titleImageLoaded) {
      const img = this.titleImage;
      const maxWidth = Math.min(screenWidth * 0.8, img.width);
      const scale = maxWidth / img.width;
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const drawX = centerX - drawW / 2;
      const drawY = centerY - drawH / 2 - 40;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 25;
      ctx.shadowOffsetY = 12;
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      ctx.restore();

      const subtitleY = drawY + drawH + 40;
      const detailY = subtitleY + 40;
      const pulse = 0.6 + Math.abs(Math.sin(Date.now() * 0.003)) * 0.4;
      ctx.font = 'bold 26px sans-serif';
      ctx.fillStyle = 'rgba(239, 68, 68,' + pulse + ')';
      ctx.fillText(subtitle, centerX, subtitleY);
      ctx.fillStyle = '#e5e7eb';
      ctx.font = '20px sans-serif';
      ctx.fillText(detail, centerX, detailY);
    } else {
      // 绘制卡片背景（半透明）
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.2)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetY = 10;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, 20);
      ctx.fill();
      ctx.restore();

      // 根据不同状态计算元素位置
      if (isGameOver) {
        // 游戏结束的布局：所有信息都在卡片内部，从上到下排列
        let currentY = cardY + 60;

        // 1. 标题
        ctx.font = 'bold 42px sans-serif';
        ctx.fillStyle = '#1e293b';
        ctx.fillText(title, centerX, currentY);
        currentY += 50;

        // 2. 得分详情
        ctx.font = '20px sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText(detail, centerX, currentY);
        currentY += 45;

        // 3. 连击信息（如果有）
        if (this.score >= CONSTANTS.ADVANCED_MECHANICS.LATEGAME_START_SCORE && this.maxCombo > 5) {
          ctx.font = '18px sans-serif';
          ctx.fillStyle = '#94a3b8';
          ctx.fillText('最大连击: ' + this.maxCombo + 'x', centerX, currentY);
          currentY += 35;
        }

        // 4. 分割线
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cardX + 30, currentY);
        ctx.lineTo(cardX + cardW - 30, currentY);
        ctx.stroke();
        currentY += 35;

        // 5. 星星状态信息
        if (this.receiveStarAvailable) {
          ctx.font = 'bold 22px sans-serif';
          ctx.fillStyle = '#10b981';
          ctx.fillText('✨ 有机会复活！', centerX, currentY);
          currentY += 55;

          // 复活按钮
          this.respawnButtonArea = { x: centerX - 100, y: currentY - 12, w: 200, h: 50 };
          ctx.save();
          const pulse = 0.8 + Math.sin(Date.now() * 0.008) * 0.2;
          ctx.fillStyle = 'rgba(16, 185, 129, ' + pulse + ')';
          ctx.shadowColor = 'rgba(0,0,0,0.3)';
          ctx.shadowBlur = 10;
          ctx.shadowOffsetY = 3;
          drawRoundedRectPath(ctx, centerX - 100, currentY - 12, 200, 50, 25);
          ctx.fill();
          ctx.shadowBlur = 0;

          ctx.fillStyle = '#fff';
          ctx.font = 'bold 20px sans-serif';
          ctx.fillText('✨ 复活', centerX, currentY + 13);
          ctx.restore();
          currentY += 60;
        } else if (this.stars > 0 || this.canGetStar || this.peopleHelped > 0) {
          // 星星数量
          if (this.stars > 0 || this.canGetStar) {
            ctx.font = '24px sans-serif';
            ctx.fillStyle = '#fbbf24';
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 8;
            ctx.fillText('⭐ ' + this.stars + ' 颗星星', centerX, currentY);
            ctx.shadowBlur = 0;
            currentY += 30;
          }

          // 帮助过的人数
          if (this.peopleHelped > 0) {
            ctx.font = '18px sans-serif';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('您的星星帮助过 ' + this.peopleHelped + ' 人', centerX, currentY);
            currentY += 30;
          }


        }

        // 6. 底部提示
        if (!this.receiveStarAvailable) {
          const pulse = 0.6 + Math.abs(Math.sin(Date.now() * 0.003)) * 0.4;
          ctx.font = 'bold 24px sans-serif';
          ctx.fillStyle = 'rgba(239, 68, 68,' + pulse + ')';
          ctx.fillText(subtitle, centerX, cardY + cardH - 50);
        }
      } else {
        // 菜单等其他状态：简化布局
        ctx.font = 'bold 42px sans-serif';
        ctx.fillStyle = '#1e293b';
        ctx.fillText(title, centerX, cardY + 140);

        const pulse = 0.6 + Math.abs(Math.sin(Date.now() * 0.003)) * 0.4;
        ctx.font = 'bold 28px sans-serif';
        ctx.fillStyle = 'rgba(239, 68, 68,' + pulse + ')';
        ctx.fillText(subtitle, centerX, cardY + 200);

        ctx.fillStyle = '#64748b';
        ctx.font = '20px sans-serif';
        ctx.fillText(detail, centerX, cardY + 250);
      }
    }

    ctx.restore();
  }

  drawHouse(x, y) {
    const houseW = 80;
    const houseH = 60;
    ctx.fillStyle = '#7c2d12';
    ctx.fillRect(x + houseW * 0.55, y - houseH * 1.3, 15, 30);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + houseW * 0.53, y - houseH * 1.35, 19, 8);
    ctx.fillStyle = '#9a3412';
    ctx.fillRect(x, y - houseH, houseW, houseH);
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
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(x - 10, y - houseH);
    ctx.lineTo(x + houseW / 2, y - houseH * 1.5);
    ctx.lineTo(x + houseW + 10, y - houseH);
    ctx.fill();
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

  drawPineTree(x, y, w, h, color) {
    ctx.fillStyle = '#451a03';
    ctx.fillRect(x - w * 0.1, y, w * 0.2, h * 0.25);
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
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.moveTo(x, layerY - layerHeight);
      ctx.lineTo(x + layerWidth / 6, layerY - layerHeight + 10);
      ctx.lineTo(x - layerWidth / 6, layerY);
      ctx.fill();
    }
  }

  drawBell(bell) {
    const { x, y, type, oscillation, width } = bell;
    ctx.save();
    ctx.translate(x, y);
    const swing = Math.sin(Date.now() * 0.003 + oscillation) * 0.15;
    ctx.rotate(swing);
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
    } else if (type === 'GOLD') {
      mainColor = CONSTANTS.COLORS.bellGold;
      strokeColor = '#92400e';
    } else if (type === 'ICE') {
      mainColor = CONSTANTS.COLORS.bellIce;
      strokeColor = '#0e7490';
    } else if (type === 'MOVING') {
      mainColor = CONSTANTS.COLORS.bellMoving;
      strokeColor = '#7c3aed';
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
    if (type === 'BOOST') {
      ctx.save();
      ctx.fillStyle = CONSTANTS.COLORS.bow;
      ctx.shadowColor = 'rgba(0,0,0,0.2)';
      ctx.shadowBlur = 2;
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(-14, -18);
      ctx.lineTo(-14, -4);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(14, -18);
      ctx.lineTo(14, -4);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -10, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (type === 'MOVING') {
      ctx.save();
      ctx.fillStyle = '#c084fc';
      ctx.shadowColor = 'rgba(168, 85, 247, 0.5)';
      ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(-5, -8);
      ctx.lineTo(5, -8);
      ctx.fill();
      ctx.restore();
    }
    
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(-8, -5, 4, 8, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.arc(0, 22, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  loop() {
    this.update();
    this.draw();
    this.aniId = raf(this.loop);
  }
}



export default Main;
