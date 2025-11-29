/**
 * 音频管理器
 * 使用 WebAudio API 合成音效，避免依赖外部资源文件
 * 包含简单的 BGM 管理
 */
export default class AudioContext {
  constructor() {
    this.ctx = wx.createWebAudioContext();
    this.bgm = null;
    this.initBGM();
  }

  initBGM() {
    // 创建背景音乐实例
    // 注意：你需要将一个名为 bgm.mp3 的文件放入 audio 文件夹中才能真正听到音乐
    // 这里做了一个容错处理
    this.bgm = wx.createInnerAudioContext();
    this.bgm.src = 'audio/bgm.mp3'; 
    this.bgm.loop = true;
    this.bgm.volume = 0.4;
    
    // 自动播放尝试
    this.bgm.onCanplay(() => {
      // console.log('BGM Ready');
    });
  }

  playBGM() {
    if (this.bgm) {
      this.bgm.play();
    }
  }

  stopBGM() {
    if (this.bgm) {
      this.bgm.stop();
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

    if (type === 'NORMAL') {
      // 清脆的铃铛声
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(440, t + 1.0);
      
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.0);
      
      osc.start(t);
      osc.stop(t + 1.0);
    } else if (type === 'BOOST') {
      // 更加空灵的高音
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1100, t);
      osc.frequency.linearRampToValueAtTime(1105, t + 0.1); // 颤音
      
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.5);
      
      osc.start(t);
      osc.stop(t + 1.5);
    } else if (type === 'DOUBLE') {
      // 类似小鸟的啾啾声
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, t);
      osc.frequency.linearRampToValueAtTime(2000, t + 0.2);
      
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
      
      osc.start(t);
      osc.stop(t + 0.5);
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
    
    osc.start(t);
    osc.stop(t + 0.8);
  }
}