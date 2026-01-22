// =======================================================
// 圣诞兔兔跳一跳 - 微信小游戏版本（位置下移 + 慢速待机版）
// =======================================================

// 帧循环封装：兼容小游戏 + H5
const raf = (typeof requestAnimationFrame === 'function')
  ? function (cb) { return requestAnimationFrame(cb); }
  : function (cb) { return setTimeout(cb, 1000 / 60); };

// 屏幕 & Canvas 初始化
const isWeChat = typeof wx !== 'undefined';

let screenWidth, screenHeight;
let canvas, ctx;

if (isWeChat) {
  // 微信小游戏环境
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

// GameOver 后多久才能重新开始（毫秒）
const GAMEOVER_RESTART_DELAY = 1500;

// 常量配置
const CONSTANTS = {
  GRAVITY: 0.15,
  JUMP_FORCE: -8.5,
  BOOST_FORCE: -12.5,
  MOVE_SPEED: 0.18,
  BELL_SPAWN_RATE: 70,
  COLORS: {
    bgStart: '#0b1026',
    bgEnd: '#2b3266',
    snow: '#ffffff',
    bellNormal: '#f8fafc',
    bellBoost: '#dc2626',
    bow: '#facc15'
  }
};

// =======================================================
// 音频控制器
// =======================================================
class AudioController {
  constructor() {
    this.ctx = null;
    this.bgm = null;

    if (isWeChat && typeof wx !== 'undefined' && typeof wx.createWebAudioContext === 'function') {
      try { this.ctx = wx.createWebAudioContext(); } catch (e) { }
    } else if (typeof window !== 'undefined') {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (typeof AC === 'function') { try { this.ctx = new AC(); } catch (e) { } }
    }

    this.initBGM();
  }

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

  playJump(type) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    let duration = 1.0;
    if (type === 'BOOST') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1100, t);
      osc.frequency.linearRampToValueAtTime(1105, t + 0.1);
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.5);
      duration = 1.5;
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(440, t + 1.0);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.0);
    }
    try { osc.start(t); osc.stop(t + duration); } catch (e) { }
  }

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
}

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

    // ---------------------------------------------------
    // 动画资源管理 (Idle, Jump, Fall)
    // ---------------------------------------------------
    this.rabbitAssets = {
      idle: [],
      jump: [],
      fall: []
    };

    // 【配置区域】
    this.animConfig = {
      idleCount: 11,  // rabbit_idle_00 ~ rabbit_idle_10
      jumpCount: 1,   // rabbit_jump_0.png
      fallCount: 1,   // rabbit_fall_0.png
      // 【修改点A】速度调整：从 0.15 改为 0.05 (约为原来的 30%)
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

    this.aniId = 0;

    this.reset();
    this.loadTitleImage();

    // 绑定输入
    if (isWeChat && typeof wx !== 'undefined') {
      wx.onTouchStart((e) => { e.type = 'touchstart'; this.touchHandler(e); });
      wx.onTouchMove((e) => { e.type = 'touchmove'; this.touchHandler(e); });
      wx.onTouchEnd(() => {});
    } else {
      const self = this;
      function wrapMouseAsTouch(type, e) {
        return { type, touches: [{ clientX: e.clientX, clientY: e.clientY }] };
      }
      canvas.addEventListener('touchstart', function (e) {
        e.preventDefault(); self.touchHandler(e);
      }, { passive: false });
      canvas.addEventListener('touchmove', function (e) {
        e.preventDefault(); self.touchHandler(e);
      }, { passive: false });
      let mouseDown = false;
      canvas.addEventListener('mousedown', function (e) {
        mouseDown = true; self.touchHandler(wrapMouseAsTouch('touchstart', e));
      });
      canvas.addEventListener('mousemove', function (e) {
        if (!mouseDown) return;
        self.touchHandler(wrapMouseAsTouch('touchmove', e));
      });
      window.addEventListener('mouseup', function () { mouseDown = false; });
    }

    this.loop = this.loop.bind(this);
    this.aniId = raf(this.loop);
  }

  // --- 分类加载兔子序列帧 ---
  loadRabbitImages() {
    const self = this;
    const totalImages = this.animConfig.idleCount + this.animConfig.jumpCount + this.animConfig.fallCount;
    let loadedCount = 0;

    // 修改：增加 padZero 参数，用于控制是否补零 (0 -> 00)
    const loadGroup = (prefix, count, targetArray, padZero = false) => {
      for (let i = 0; i < count; i++) {
        // 构建文件名
        let indexStr = i.toString();
        if (padZero) {
          // 如果需要补零，变成 00, 01, ... 10
          indexStr = indexStr.padStart(2, '0');
        }
        
        const src = `images/${prefix}_${indexStr}.png`; 
        
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

    // 只有 idle 开启了 padZero=true
    loadGroup('rabbit_idle', this.animConfig.idleCount, this.rabbitAssets.idle, true);
    loadGroup('rabbit_jump', this.animConfig.jumpCount, this.rabbitAssets.jump, false);
    loadGroup('rabbit_fall', this.animConfig.fallCount, this.rabbitAssets.fall, false);
  }

  loadTitleImage () {
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

  reset () {
    this.score = 0;
    if (isWeChat && typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      this.highScore = Number(wx.getStorageSync('highscore') || 0);
    } else if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('highscore');
      this.highScore = stored ? Number(stored) : 0;
    } else {
      this.highScore = 0;
    }

    // 【修改点B】兔子位置下移
    // 之前是 screenHeight - 150，现在改为 screenHeight - 135
    // 这样兔子会更贴近地面 (视觉上下移 15px)
    this.rabbit = {
      x: screenWidth / 2,
      y: screenHeight - 135,
      vx: 0,
      vy: 0,
      width: 77, 
      height: 77,
      rotation: 0,
      facing: 1   // 1 = 面向右, -1 = 面向左
    };

    this.cameraY = 0;
    this.groundY = screenHeight - 100;
    this.hasStartedGame = false;

    this.difficulty = 0;
    this.bellSpacing = this.baseBellSpacing;

    this.bells = [];
    this.particles = [];
    this.scorePopups = [];
    this.backgroundStars = [];
    this.snowflakes = [];
    this.trees = [];
    
    this.gameOverUIAlpha = 0;
    this.initWorld();
  }

  initWorld () {
    for (let i = 0; i < 60; i++) {
      this.backgroundStars.push({ x: Math.random() * screenWidth, y: Math.random() * screenHeight, size: Math.random() * 2, alpha: Math.random() });
    }
    for (let i = 0; i < 50; i++) {
      this.snowflakes.push({ x: Math.random() * screenWidth, y: Math.random() * screenHeight, size: 2 + Math.random() * 3, speed: 0.2 + Math.random() * 0.8, swayOffset: Math.random() * Math.PI * 2 });
    }
    for (let i = 0; i < 10; i++) {
      this.spawnBell(screenHeight - 250 - (i * this.baseBellSpacing));
    }
    for (let i = 0; i < 6; i++) {
      this.trees.push({ x: Math.random() * screenWidth, y: this.groundY + 15, width: 50 + Math.random() * 40, height: 100 + Math.random() * 80, color: i % 2 === 0 ? '#14532d' : '#166534' });
    }
  }

  spawnBell (y) {
    const difficulty = this.difficulty || 0;
    const SCORE_LEVEL_THRESHOLDS = [0, 3000, 5000, 7000, 9000, 11000];
    const SIZE_LEVEL_VALUES      = [30, 28, 26, 25, 24, 23];

    let level = 0;
    for (let i = 1; i < SCORE_LEVEL_THRESHOLDS.length; i++) {
      if (this.score >= SCORE_LEVEL_THRESHOLDS[i]) level = i; else break;
    }
    const size = SIZE_LEVEL_VALUES[Math.min(level, SIZE_LEVEL_VALUES.length - 1)];
    const oscBase = 0.02 + Math.random() * 0.03;
    const oscSpeed = oscBase * (1 + difficulty * 0.5);
    const isBoost = Math.random() > 0.9;
    const hitRadius = size * 0.75;

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
      this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1.0, color, age: 0 });
    }
  }

  touchHandler (e) {
    const x = e.touches[0].clientX;
    const isTouchStart = e.type === 'touchstart';

    if (this.state === 'MENU') {
      if (!isTouchStart) return;
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

    if (this.state === 'GAMEOVER') {
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

    if (this.state === 'PLAYING') {
      this.targetX = x;
    }
  }

  update () {
    this.updateSnowflakes();

    if (this.state === 'GAMEOVER') {
      const now = Date.now();
      const timeSinceDeath = now - this.lastGameOverTime;
      if (timeSinceDeath > 600) {
        this.gameOverUIAlpha += 0.03; 
        if (this.gameOverUIAlpha > 1) this.gameOverUIAlpha = 1;
      }
      if (!this.canRestart && timeSinceDeath > GAMEOVER_RESTART_DELAY) this.canRestart = true;
      return; 
    }

    if (this.state !== 'PLAYING') return;

    this.difficulty = Math.min(1.5, this.cameraY / (screenHeight * 4));
    const difficulty = this.difficulty;

    // 1. 移动 & 朝向
    if (this.targetX !== undefined) {
      const dx = this.targetX - this.rabbit.x;
      this.rabbit.x += dx * CONSTANTS.MOVE_SPEED;
      // 根据移动方向改变朝向
      if (dx > 0.5) this.rabbit.facing = 1;
      else if (dx < -0.5) this.rabbit.facing = -1;
    }

    if (this.rabbit.x > screenWidth) this.rabbit.x = 0;
    if (this.rabbit.x < 0) this.rabbit.x = screenWidth;

    // 2. 物理
    let currentGravity = CONSTANTS.GRAVITY * (1 + difficulty * 0.4);
    if (Math.abs(this.rabbit.vy) < 1.5) currentGravity *= 0.65;
    this.rabbit.vy += currentGravity;
    this.rabbit.y += this.rabbit.vy;

    // 3. 旋转 (保留物理倾斜效果)
    this.rabbit.rotation = (this.targetX !== undefined ? this.targetX - this.rabbit.x : 0) * 0.003;

    // 4. 地面 & 死亡判定
    const absoluteGroundY = this.groundY + this.cameraY;
    if (this.hasStartedGame) {
      if (this.rabbit.y > screenHeight + 50) this.gameOver();
      if (absoluteGroundY < screenHeight && this.rabbit.y + this.rabbit.height / 2 >= absoluteGroundY) this.gameOver();
    }

    // 5. 摄像机跟随
    const threshold = screenHeight * 0.45;
    if (this.rabbit.y < threshold) {
      const diff = threshold - this.rabbit.y;
      this.rabbit.y = threshold;
      this.cameraY += diff;
      this.score += Math.floor(diff * 0.5);

      this.bellSpacing = this.baseBellSpacing + difficulty * 40;
      this.bells.forEach(b => { b.y += diff; });
      this.particles.forEach(p => { p.y += diff; });
      if (this.scorePopups) this.scorePopups.forEach(s => { s.y += diff; });
      this.groundY += diff;
      this.trees.forEach(t => { t.y += diff; });

      const highestBellY = this.bells.length > 0 ? this.bells[this.bells.length - 1].y : 0;
      if (highestBellY > -50) this.spawnBell(highestBellY - this.bellSpacing);
    }

    // 6. 碰撞检测
    if (this.rabbit.vy > 0) {
      this.bells.forEach(bell => {
        if (!bell.active) return;
        const dist = Math.sqrt(Math.pow(this.rabbit.x - bell.x, 2) + Math.pow((this.rabbit.y + 15) - bell.y, 2));
        const hitRadius = bell.hitRadius || (26 - difficulty * 4);
        if (dist < hitRadius) {
          bell.active = false;
          const baseForce = bell.type === 'BOOST' ? CONSTANTS.BOOST_FORCE : CONSTANTS.JUMP_FORCE;
          this.rabbit.vy = baseForce * (1 + difficulty * 0.25);
          this.audio.playJump(bell.type);
          let particleColor = (bell.type === 'BOOST') ? CONSTANTS.COLORS.bellBoost : CONSTANTS.COLORS.bellNormal;
          this.spawnParticles(bell.x, bell.y, particleColor);
          if (!this.scorePopups) this.scorePopups = [];
          this.scorePopups.push({ x: bell.x, y: bell.y, text: this.score.toString(), life: 1.0, age: 0, vy: -1.2 });
        }
      });
    }

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
  }

  updateSnowflakes () {
    this.snowflakes.forEach(s => {
      s.y += s.speed;
      s.x += Math.sin(Date.now() * 0.001 + s.swayOffset) * 0.5;
      if (s.y > screenHeight) { s.y = -10; s.x = Math.random() * screenWidth; }
      if (s.x > screenWidth) s.x = 0;
      if (s.x < 0) s.x = screenWidth;
    });
  }

  gameOver () {
    this.state = 'GAMEOVER';
    this.canRestart = false;
    this.lastGameOverTime = Date.now();
    this.gameOverUIAlpha = 0;
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
    ctx.clearRect(0, 0, screenWidth, screenHeight);

    // 1. 背景
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
      ctx.beginPath(); ctx.arc(star.x, wrappedY, star.size, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    ctx.save();

    // 2. 场景
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
      ctx.lineTo(screenWidth, this.groundY + 30); ctx.lineTo(0, this.groundY + 30); ctx.fill();
    }

    // 3. 实体
    this.bells.forEach(bell => { if (bell.active) this.drawBell(bell); });
    this.particles.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    if (this.scorePopups && this.scorePopups.length > 0) {
      ctx.save(); ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      this.scorePopups.forEach(s => {
        ctx.globalAlpha = Math.max(0, s.life); ctx.fillStyle = '#facc15'; ctx.fillText(s.text, s.x, s.y);
      });
      ctx.restore(); ctx.globalAlpha = 1;
    }

    // 4. 绘制兔子 (状态机版)
    this.drawRabbit(this.rabbit.x, this.rabbit.y, this.rabbit.vy, this.rabbit.rotation);

    // 5. 雪花
    ctx.fillStyle = '#ffffff';
    this.snowflakes.forEach(s => {
      ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.restore();

    // 6. UI
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this.score.toString(), 20, 50);

    if (this.state === 'MENU') {
      this.drawUIOverlay('圣诞跳一跳', '点击开始游戏', '最高分: ' + this.highScore, 1);
    } else if (this.state === 'GAMEOVER') {
      this.drawUIOverlay('游戏结束', '点击重试', '得分: ' + this.score, this.gameOverUIAlpha);
    }
  }

  // --- 状态机绘制逻辑 (已去除弹性动画) ---
  drawRabbit (x, y, vy, rot) {
    if (!this.rabbitImagesLoaded) return;

    ctx.save();
    ctx.translate(x, y);

    // 1. 旋转 (保留物理倾斜)
    ctx.rotate(rot);

    // 2. 左右朝向
    const dir = this.rabbit.facing || 1; 
    ctx.scale(dir, 1); 

    // 3. 状态判定
    let currentSprites = this.rabbitAssets.idle;
    
    if (!this.hasStartedGame) {
      // 未开始 -> 待机
      currentSprites = this.rabbitAssets.idle;
    } else {
      // 游戏中 -> 判断垂直速度
      if (vy < -0.5) {
        // 向上 -> 跳跃
        currentSprites = this.rabbitAssets.jump;
      } else if (vy > 0.5) {
        // 向下 -> 下落
        currentSprites = this.rabbitAssets.fall;
      } else {
        // 滞空顶点 -> 倾向于保持跳跃姿态
        currentSprites = this.rabbitAssets.jump;
      }
    }

    // 4. 绘制帧
    if (currentSprites.length > 0) {
      const frameIndex = Math.floor(Date.now() * this.animConfig.speed / 10) % currentSprites.length;
      const img = currentSprites[frameIndex];
      const w = this.rabbit.width;
      const h = this.rabbit.height;
      
      if (img) {
        // 直接绘制，无拉伸效果
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
    }

    ctx.restore();
  }

  drawUIOverlay (title, subtitle, detail, alpha = 1) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(11, 16, 38, 0.70)';
    ctx.fillRect(0, 0, screenWidth, screenHeight);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;

    if (this.titleImage && this.titleImageLoaded) {
      const img = this.titleImage;
      const maxWidth = Math.min(screenWidth * 0.8, img.width);
      const scale = maxWidth / img.width;
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const drawX = centerX - drawW / 2;
      const drawY = centerY - drawH / 2 - 40;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 25; ctx.shadowOffsetY = 12;
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      ctx.restore();

      const subtitleY = drawY + drawH + 40;
      const detailY = subtitleY + 40;
      const pulse = 0.6 + Math.abs(Math.sin(Date.now() * 0.003)) * 0.4;
      ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = 'rgba(239, 68, 68,' + pulse + ')'; ctx.fillText(subtitle, centerX, subtitleY);
      ctx.fillStyle = '#e5e7eb'; ctx.font = '20px sans-serif'; ctx.fillText(detail, centerX, detailY);
    } else {
      const cardW = 320; const cardH = 340;
      const cardX = centerX - cardW / 2; const cardY = centerY - cardH / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 10;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, 20); ctx.fill();
      ctx.restore();

      ctx.font = 'bold 42px sans-serif'; ctx.fillStyle = '#1e293b'; ctx.fillText(title, centerX, cardY + 140);
      const pulse = 0.6 + Math.abs(Math.sin(Date.now() * 0.003)) * 0.4;
      ctx.font = 'bold 28px sans-serif'; ctx.fillStyle = 'rgba(239, 68, 68,' + pulse + ')'; ctx.fillText(subtitle, centerX, cardY + 200);
      ctx.fillStyle = '#64748b'; ctx.font = '20px sans-serif'; ctx.fillText(detail, centerX, cardY + 250);
    }
    ctx.restore();
  }

  drawHouse (x, y) {
    const houseW = 80; const houseH = 60;
    ctx.fillStyle = '#7c2d12'; ctx.fillRect(x + houseW * 0.55, y - houseH * 1.3, 15, 30);
    ctx.fillStyle = '#fff'; ctx.fillRect(x + houseW * 0.53, y - houseH * 1.35, 19, 8);
    ctx.fillStyle = '#9a3412'; ctx.fillRect(x, y - houseH, houseW, houseH);
    ctx.fillStyle = '#fef08a'; ctx.fillRect(x + houseW * 0.2, y - houseH * 0.6, 25, 25);
    ctx.strokeStyle = '#451a03'; ctx.lineWidth = 2; ctx.strokeRect(x + houseW * 0.2, y - houseH * 0.6, 25, 25);
    ctx.beginPath(); ctx.moveTo(x + houseW * 0.2 + 12.5, y - houseH * 0.6); ctx.lineTo(x + houseW * 0.2 + 12.5, y - houseH * 0.6 + 25);
    ctx.moveTo(x + houseW * 0.2, y - houseH * 0.6 + 12.5); ctx.lineTo(x + houseW * 0.2 + 25, y - houseH * 0.6 + 12.5); ctx.stroke();
    ctx.fillStyle = '#f8fafc'; ctx.beginPath(); ctx.moveTo(x - 10, y - houseH); ctx.lineTo(x + houseW / 2, y - houseH * 1.5); ctx.lineTo(x + houseW + 10, y - houseH); ctx.fill();
    const time = Date.now() * 0.001; ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    for (let i = 0; i < 3; i++) {
      const puffY = y - houseH * 1.4 - (i * 15) - (time * 10 % 20);
      const puffX = x + houseW * 0.6 + Math.sin(time + i) * 5;
      ctx.beginPath(); ctx.arc(puffX, puffY, 6 + i * 2, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawPineTree (x, y, w, h, color) {
    ctx.fillStyle = '#451a03'; ctx.fillRect(x - w * 0.1, y, w * 0.2, h * 0.25);
    const layers = 3;
    for (let i = 0; i < layers; i++) {
      const layerWidth = w * (1 - i * 0.25); const layerHeight = h * 0.4; const layerY = y - (i * h * 0.25);
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, layerY - layerHeight); ctx.lineTo(x + layerWidth / 2, layerY); ctx.lineTo(x - layerWidth / 2, layerY); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.moveTo(x, layerY - layerHeight); ctx.lineTo(x + layerWidth / 6, layerY - layerHeight + 10); ctx.lineTo(x - layerWidth / 6, layerY - layerHeight + 10); ctx.fill();
    }
  }

  drawBell (bell) {
    const { x, y, type, oscillation, width } = bell;
    ctx.save(); ctx.translate(x, y);
    const swing = Math.sin(Date.now() * 0.003 + oscillation) * 0.15; ctx.rotate(swing);
    const BASE_SIZE = 30; const size = width || BASE_SIZE; const scale = size / BASE_SIZE;
    ctx.scale(scale, scale);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
    let mainColor = CONSTANTS.COLORS.bellNormal; let strokeColor = '#475569';
    if (type === 'BOOST') { mainColor = CONSTANTS.COLORS.bellBoost; strokeColor = '#7f1d1d'; }
    ctx.fillStyle = mainColor; ctx.lineWidth = 1.5; ctx.strokeStyle = strokeColor;
    ctx.beginPath(); ctx.arc(0, 0, 16, Math.PI, 0); ctx.bezierCurveTo(16, 16, 18, 18, 20, 22); ctx.lineTo(-20, 22); ctx.bezierCurveTo(-18, 18, -16, 16, -16, 0); ctx.fill(); ctx.shadowBlur = 0; ctx.stroke();
    if (type === 'BOOST') {
      ctx.save(); ctx.fillStyle = CONSTANTS.COLORS.bow; ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = 2;
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-14, -18); ctx.lineTo(-14, -4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(14, -18); ctx.lineTo(14, -4); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -10, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.ellipse(-8, -5, 4, 8, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#475569'; ctx.beginPath(); ctx.arc(0, 22, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  loop () {
    this.update();
    this.draw();
    this.aniId = raf(this.loop);
  }
}

// 启动游戏
new Main();