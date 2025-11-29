import AudioController from './audio.js'

/**
 * 游戏主类
 */

// 使用微信小游戏提供的 wx API 创建画布和获取屏幕信息
const { windowWidth: screenWidth, windowHeight: screenHeight } = wx.getSystemInfoSync()

const canvas = wx.createCanvas()
canvas.width = screenWidth
canvas.height = screenHeight

const ctx = canvas.getContext('2d')

// GameOver 后多久才能重新开始（毫秒）
const GAMEOVER_RESTART_DELAY = 500

// 常量配置（加快上下速度）
const CONSTANTS = {
  GRAVITY: 0.3,          // 基础重力
  JUMP_FORCE: -10.5,     // 基础跳跃力
  BOOST_FORCE: -15,      // 道具跳跃力
  MOVE_SPEED: 0.18,      // 左右移动平滑度
  BELL_SPAWN_RATE: 70,   // 初始铃铛垂直间距
  COLORS: {
    bgStart: '#0b1026',  // 深夜蓝
    bgEnd: '#2b3266',    // 圣诞夜空
    snow: '#ffffff',
    bell: '#fcd34d',
    rabbit: '#ffffff'
  }
}

export default class Main {
  constructor () {
    this.audio = new AudioController()

    // 状态 & 难度
    this.state = 'MENU'                     // MENU, PLAYING, GAMEOVER
    this.difficulty = 0                     // 0 ~ 1.5 左右
    this.baseBellSpacing = CONSTANTS.BELL_SPAWN_RATE
    this.bellSpacing = this.baseBellSpacing

    // Game Over 后的重开冷却
    this.canRestart = true
    this.lastGameOverTime = 0

    // 初始化游戏世界（只重置数据，不修改 state）
    this.reset()

    // 绑定输入
    wx.onTouchStart(this.touchHandler.bind(this))
    wx.onTouchMove(this.touchHandler.bind(this))

    // 开始循环
    this.loop = this.loop.bind(this)
    this.aniId = requestAnimationFrame(this.loop)
  }

  // 只负责重置数据，不修改 this.state
  reset () {
    this.score = 0
    this.highScore = Number(wx.getStorageSync('highscore') || 0)

    // 游戏实体
    this.rabbit = {
      x: screenWidth / 2,
      y: screenHeight - 150,
      vx: 0,
      vy: 0,
      width: 40,
      height: 40,
      rotation: 0
    }

    // 摄像机/世界位置
    this.cameraY = 0
    this.groundY = screenHeight - 100 // 地面Y坐标
    this.hasStartedGame = false       // 是否已经起跳（脱离地面）

    // 难度相关
    this.difficulty = 0
    this.bellSpacing = this.baseBellSpacing

    // 集合
    this.bells = []
    this.particles = []
    this.backgroundStars = []
    this.trees = [] // 装饰性雪松

    // 初始化生成
    this.initWorld()
  }

  initWorld () {
    // 生成星空
    for (let i = 0; i < 60; i++) {
      this.backgroundStars.push({
        x: Math.random() * screenWidth,
        y: Math.random() * screenHeight,
        size: Math.random() * 2,
        alpha: Math.random()
      })
    }

    // 生成初始铃铛 (从地面上方开始)
    for (let i = 0; i < 10; i++) {
      this.spawnBell(screenHeight - 250 - (i * this.baseBellSpacing))
    }

    // 生成背景雪松 (装饰)
    for (let i = 0; i < 8; i++) {
      this.trees.push({
        x: Math.random() * screenWidth,
        y: this.groundY + 15, // 稍微插在地里
        width: 50 + Math.random() * 40,
        height: 100 + Math.random() * 80,
        color: i % 2 === 0 ? '#14532d' : '#166534' // 深绿色
      })
    }
  }

  // 根据当前难度生成铃铛（越高越难）
  spawnBell (y) {
    const difficulty = this.difficulty || 0

    // 铃铛尺寸随难度略微变小
    const size = 30 - difficulty * 6  // 最小大概 21
    const oscBase = 0.02 + Math.random() * 0.03
    // 难度越高，左右摆动越快
    const oscSpeed = oscBase * (1 + difficulty * 0.5)

    this.bells.push({
      x: Math.random() * (screenWidth - 80) + 40,
      y,
      type: Math.random() > 0.9 ? 'BOOST' : 'NORMAL',
      width: size,
      height: size,
      active: true,
      oscillation: Math.random() * Math.PI,
      oscSpeed
    })
  }

  spawnParticles (x, y, color) {
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 1 + Math.random() * 3
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        color
      })
    }
  }

  touchHandler (e) {
    const x = e.touches[0].clientX
    const isTouchStart = e.type === 'touchstart'

    // 菜单界面点击开始：只接受 touchstart，避免滑动误触
    if (this.state === 'MENU') {
      if (!isTouchStart) return

      this.reset()
      this.state = 'PLAYING'
      this.audio.playBGM()

      // 第一次起跳
      this.rabbit.vy = CONSTANTS.JUMP_FORCE
      this.hasStartedGame = true

      // 瞬间移动到手指位置方便操作
      this.rabbit.x = x
      this.targetX = x

      this.audio.playJump('NORMAL')
      return
    }

    // GAMEOVER 状态：只在冷却结束后 + touchstart 才能重开
    if (this.state === 'GAMEOVER') {
      if (!this.canRestart || !isTouchStart) {
        // 冷却中或非点击事件，忽略
        return
      }

      this.reset()
      this.state = 'PLAYING'
      this.audio.playBGM()

      this.rabbit.vy = CONSTANTS.JUMP_FORCE
      this.hasStartedGame = true

      this.rabbit.x = x
      this.targetX = x

      this.audio.playJump('NORMAL')
      return
    }

    // 游戏中更新目标位置（start + move 都可以调整）
    if (this.state === 'PLAYING') {
      this.targetX = x
    }
  }

  update () {
    // 在 GAMEOVER 状态里更新一下“是否可以重开”的时间
    if (this.state === 'GAMEOVER' && !this.canRestart) {
      if (Date.now() - this.lastGameOverTime > GAMEOVER_RESTART_DELAY) {
        this.canRestart = true
      }
    }

    if (this.state !== 'PLAYING') return

    // 难度随高度提升而增加（cameraY 越大越难）
    // 大约升高 4 个屏幕高度接近难度 1，再往上渐进到 ~1.5
    this.difficulty = Math.min(1.5, this.cameraY / (screenHeight * 4))
    const difficulty = this.difficulty

    // 1. 兔子水平移动 (平滑跟随)
    if (this.targetX !== undefined) {
      this.rabbit.x += (this.targetX - this.rabbit.x) * CONSTANTS.MOVE_SPEED
    }

    // 边界处理 (穿墙)
    if (this.rabbit.x > screenWidth) this.rabbit.x = 0
    if (this.rabbit.x < 0) this.rabbit.x = screenWidth

    // 2. 兔子垂直物理
    // 基础重力随难度略微增加（越高掉得越快）
    let currentGravity = CONSTANTS.GRAVITY * (1 + difficulty * 0.4)

    // 在最高点附近减小重力，保留一点“漂浮感”但不会太慢
    if (Math.abs(this.rabbit.vy) < 1.5) {
      currentGravity *= 0.65
    }

    this.rabbit.vy += currentGravity
    this.rabbit.y += this.rabbit.vy

    // 旋转角度 (基于水平速度)
    this.rabbit.rotation = (this.targetX - this.rabbit.x) * 0.003

    // 3. 地板与死亡逻辑
    const absoluteGroundY = this.groundY + this.cameraY

    if (!this.hasStartedGame) {
      // 理论上不会进来
    } else {
      // 掉出屏幕底部 -> 立即 Game Over
      if (this.rabbit.y > screenHeight + 50) {
        this.gameOver()
      }

      // 起跳后又掉回地面
      if (absoluteGroundY < screenHeight &&
          this.rabbit.y + this.rabbit.height / 2 >= absoluteGroundY) {
        this.gameOver()
      }
    }

    // 4. 摄像机跟随 (只能向上)
    const threshold = screenHeight * 0.45
    if (this.rabbit.y < threshold) {
      const diff = threshold - this.rabbit.y
      this.rabbit.y = threshold            // 锁定兔子在屏幕上方
      this.cameraY += diff                 // 增加摄像机位移
      this.score += Math.floor(diff * 0.5) // 增加分数

      // 随高度增加铃铛间距，变得更难
      this.bellSpacing = this.baseBellSpacing + difficulty * 40

      // 所有铃铛下移
      this.bells.forEach(b => { b.y += diff })
      // 所有粒子下移
      this.particles.forEach(p => { p.y += diff })
      // 地板和树下移
      this.groundY += diff
      this.trees.forEach(t => { t.y += diff })

      // 生成新铃铛 (在屏幕顶部上方)
      const highestBellY = this.bells.length > 0 ? this.bells[this.bells.length - 1].y : 0
      if (highestBellY > -50) {
        this.spawnBell(highestBellY - this.bellSpacing)
      }
    }

    // 5. 碰撞检测 (只在下落时触发)
    if (this.rabbit.vy > 0) {
      this.bells.forEach(bell => {
        if (!bell.active) return

        // 简单的圆形碰撞
        const bellCx = bell.x
        const bellCy = bell.y
        const rabbitFootX = this.rabbit.x
        const rabbitFootY = this.rabbit.y + 15

        const dx = rabbitFootX - bellCx
        const dy = rabbitFootY - bellCy
        const dist = Math.sqrt(dx * dx + dy * dy)

        // 碰撞判定范围随难度变小（更难踩中）
        const hitRadius = 26 - difficulty * 4 // 大约 26 ~ 20
        if (dist < hitRadius) {
          // 踩到了
          bell.active = false

          // 跳跃力随难度略增，保证能跳到更稀的铃铛
          const baseForce = bell.type === 'BOOST'
            ? CONSTANTS.BOOST_FORCE
            : CONSTANTS.JUMP_FORCE
          const difficultyScale = 1 + difficulty * 0.25
          this.rabbit.vy = baseForce * difficultyScale

          this.audio.playJump(bell.type)
          this.spawnParticles(bell.x, bell.y, CONSTANTS.COLORS.bell)
        }
      })
    }

    // 6. 清理多余元素
    this.bells = this.bells.filter(b => b.y < screenHeight + 50)

    // 粒子更新
    this.particles.forEach(p => {
      p.x += p.vx
      p.y += p.vy
      p.vy += 0.1 // 粒子重力
      p.life -= 0.02
    })
    this.particles = this.particles.filter(p => p.life > 0)
  }

  gameOver () {
    this.state = 'GAMEOVER'
    this.canRestart = false
    this.lastGameOverTime = Date.now()

    this.audio.playFall()
    this.audio.stopBGM()

    if (this.score > this.highScore) {
      this.highScore = this.score
      wx.setStorageSync('highscore', this.highScore)
    }
  }

  draw () {
    // 清屏
    ctx.clearRect(0, 0, screenWidth, screenHeight)

    // 1. 背景 (星空渐变)
    const grad = ctx.createLinearGradient(0, 0, 0, screenHeight)
    grad.addColorStop(0, CONSTANTS.COLORS.bgStart)
    grad.addColorStop(1, CONSTANTS.COLORS.bgEnd)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, screenWidth, screenHeight)

    // 星星闪烁 (背景层，跟随 cameraY 微动造成视差)
    ctx.fillStyle = '#FFF'
    this.backgroundStars.forEach(star => {
      ctx.globalAlpha = 0.3 + Math.sin(Date.now() * 0.005 + star.x) * 0.2
      const parallaxY = (star.y + this.cameraY * 0.05) % screenHeight
      ctx.beginPath()
      ctx.arc(star.x, parallaxY, star.size, 0, Math.PI * 2)
      ctx.fill()
    })
    ctx.globalAlpha = 1

    ctx.save()

    // 2. 绘制地板与雪松
    if (this.groundY < screenHeight + 200) {
      // 雪松 (位于地板后方)
      this.trees.forEach(tree => {
        if (tree.y > -200 && tree.y < screenHeight + 200) {
          this.drawPineTree(tree.x, tree.y, tree.width, tree.height, tree.color)
        }
      })

      // 地板
      ctx.fillStyle = '#cbd5e1'
      ctx.fillRect(0, this.groundY, screenWidth, screenHeight)
      // 积雪层 (带一点波浪装饰)
      ctx.fillStyle = '#f1f5f9'
      ctx.beginPath()
      ctx.moveTo(0, this.groundY)
      ctx.bezierCurveTo(
        screenWidth / 3, this.groundY - 10,
        screenWidth * 2 / 3, this.groundY + 10,
        screenWidth, this.groundY
      )
      ctx.lineTo(screenWidth, this.groundY + 30)
      ctx.lineTo(0, this.groundY + 30)
      ctx.fill()
    }

    // 3. 铃铛
    this.bells.forEach(bell => {
      if (!bell.active) return
      this.drawBell(bell.x, bell.y, bell.type, bell.oscillation, bell.oscSpeed)
    })

    // 4. 粒子
    this.particles.forEach(p => {
      ctx.globalAlpha = p.life
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
      ctx.fill()
    })
    ctx.globalAlpha = 1

    // 5. 兔子
    this.drawRabbit(this.rabbit.x, this.rabbit.y, this.rabbit.vy, this.rabbit.rotation)

    // 6. UI
    ctx.restore()

    // 分数
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 40px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(this.score.toString(), 20, 50)

    // 菜单 / 结束 UI
    if (this.state === 'MENU') {
      this.drawUIOverlay('Christmas Hop', 'Touch to Start', 'Best: ' + this.highScore)
    } else if (this.state === 'GAMEOVER') {
      this.drawUIOverlay('Game Over', 'Touch to Retry', 'Score: ' + this.score)
    }
  }

  drawUIOverlay (title, subtitle, detail) {
    ctx.fillStyle = 'rgba(11, 16, 38, 0.7)'
    ctx.fillRect(0, 0, screenWidth, screenHeight)

    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Title
    ctx.font = 'bold 44px sans-serif'
    ctx.fillText(title, screenWidth / 2, screenHeight / 2 - 50)

    // Subtitle
    ctx.font = '24px sans-serif'
    ctx.fillStyle = '#fcd34d'
    ctx.fillText(subtitle, screenWidth / 2, screenHeight / 2 + 20)

    // Detail
    ctx.fillStyle = '#94a3b8'
    ctx.font = '20px sans-serif'
    ctx.fillText(detail, screenWidth / 2, screenHeight / 2 + 70)
  }

  drawPineTree (x, y, w, h, color) {
    // 树干
    ctx.fillStyle = '#451a03'
    ctx.fillRect(x - w * 0.1, y, w * 0.2, h * 0.25)

    // 树冠 (三个三角形叠加)
    const layers = 3
    for (let i = 0; i < layers; i++) {
      const layerWidth = w * (1 - i * 0.25)
      const layerHeight = h * 0.4
      const layerY = y - (i * h * 0.25)

      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(x, layerY - layerHeight)
      ctx.lineTo(x + layerWidth / 2, layerY)
      ctx.lineTo(x - layerWidth / 2, layerY)
      ctx.fill()

      // 树上的积雪装饰
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.beginPath()
      ctx.moveTo(x, layerY - layerHeight)
      ctx.lineTo(x + layerWidth / 6, layerY - layerHeight + 10)
      ctx.lineTo(x - layerWidth / 6, layerY - layerHeight + 10)
      ctx.fill()
    }
  }

  drawBell (x, y, type, osc, speed) {
    ctx.save()
    ctx.translate(x, y)

    // 摇摆动画
    const swing = Math.sin(Date.now() * 0.003 + osc) * 0.15
    ctx.rotate(swing)

    // 阴影
    ctx.shadowColor = 'rgba(255, 215, 0, 0.5)'
    ctx.shadowBlur = 10

    // 铃铛本体
    ctx.fillStyle = type === 'BOOST' ? '#60a5fa' : CONSTANTS.COLORS.bell
    ctx.lineWidth = 2
    ctx.strokeStyle = '#b45309'

    ctx.beginPath()
    ctx.arc(0, 0, 16, Math.PI, 0)                // 顶部半圆
    ctx.bezierCurveTo(16, 16, 18, 18, 20, 22)    // 右侧扩口
    ctx.lineTo(-20, 22)
    ctx.bezierCurveTo(-18, 18, -16, 16, -16, 0)  // 左侧收口
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.stroke()

    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.beginPath()
    ctx.ellipse(-8, -5, 4, 8, -0.3, 0, Math.PI * 2)
    ctx.fill()

    // 铃铛底部的球
    ctx.fillStyle = '#78350f'
    ctx.beginPath()
    ctx.arc(0, 22, 5, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  }

  drawRabbit (x, y, vy, rot) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)

    // 挤压拉伸效果
    let scaleX = 1
    let scaleY = 1

    const speed = Math.abs(vy)
    if (speed > 1) {
      scaleY = 1 + Math.min(speed * 0.03, 0.2)
      scaleX = 1 - Math.min(speed * 0.03, 0.2)
    } else {
      // 滞空时稍微胖一点
      scaleY = 0.95
      scaleX = 1.05
    }
    ctx.scale(scaleX, scaleY)

    // 阴影
    ctx.shadowColor = 'rgba(0,0,0,0.2)'
    ctx.shadowBlur = 5
    ctx.shadowOffsetY = 5

    // 1. 耳朵
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.ellipse(-10, -25, 6, 18, -0.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fbcfe8'
    ctx.beginPath()
    ctx.ellipse(-10, -25, 3, 12, -0.2, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.ellipse(10, -25, 6, 18, 0.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fbcfe8'
    ctx.beginPath()
    ctx.ellipse(10, -25, 3, 12, 0.2, 0, Math.PI * 2)
    ctx.fill()

    // 2. 身体
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(0, 0, 22, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0

    // 3. 脸部
    ctx.fillStyle = '#0f172a'
    ctx.beginPath()
    ctx.arc(-8, -4, 2.5, 0, Math.PI * 2)
    ctx.arc(8, -4, 2.5, 0, Math.PI * 2)
    ctx.fill()

    // 腮红
    ctx.fillStyle = 'rgba(244, 114, 182, 0.4)'
    ctx.beginPath()
    ctx.arc(-12, 2, 4, 0, Math.PI * 2)
    ctx.arc(12, 2, 4, 0, Math.PI * 2)
    ctx.fill()

    // 鼻子
    ctx.fillStyle = '#f472b6'
    ctx.beginPath()
    ctx.arc(0, 3, 3, 0, Math.PI * 2)
    ctx.fill()

    // 手
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(-6, 12, 5, 0, Math.PI * 2)
    ctx.arc(6, 12, 5, 0, Math.PI * 2)
    ctx.fill()

    // 脚
    const legOffset = vy < 0 ? 12 : 18
    ctx.beginPath()
    ctx.ellipse(-10, legOffset, 5, 7, -0.2, 0, Math.PI * 2)
    ctx.ellipse(10, legOffset, 5, 7, 0.2, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  }

  loop () {
    this.update()
    this.draw()
    this.aniId = requestAnimationFrame(this.loop)
  }
}
