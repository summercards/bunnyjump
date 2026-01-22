/**
 * 音频管理器
 * 使用 WebAudio API 合成音效，避免依赖外部资源文件
 * 包含简单的 BGM 管理
 * ✅ 新增：fadeOutBGM（温柔结束用）
 */
export default class AudioContext {
    constructor() {
      this.ctx = wx.createWebAudioContext();
      this.bgm = null;
      this.initBGM();
    }
  
    initBGM() {
      this.bgm = wx.createInnerAudioContext();
      this.bgm.src = 'audio/bgm.mp3';
      this.bgm.loop = true;
      this.bgm.volume = 0.4;
  
      this.bgm.onCanplay(() => {});
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
  
    // ✅ 温柔退场：BGM 淡出
    fadeOutBGM(duration = 600) {
      if (!this.bgm) return;
  
      const startVolume = this.bgm.volume || 0.4;
      const startTime = Date.now();
  
      const tick = () => {
        const p = Math.min(1, (Date.now() - startTime) / duration);
        const v = startVolume * (1 - p);
  
        try {
          this.bgm.volume = Math.max(0, v);
        } catch (e) {}
  
        if (p < 1) {
          setTimeout(tick, 16);
        } else {
          this.stopBGM();
          try {
            this.bgm.volume = startVolume;
          } catch (e) {}
        }
      };
  
      tick();
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
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.exponentialRampToValueAtTime(440, t + 1.0);
  
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 1.0);
  
        osc.start(t);
        osc.stop(t + 1.0);
      } else if (type === 'BOOST') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1100, t);
        osc.frequency.linearRampToValueAtTime(1105, t + 0.1);
  
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 1.5);
  
        osc.start(t);
        osc.stop(t + 1.5);
      } else if (type === 'DOUBLE') {
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
  