/** Plays synthesized samples and reports the playback position (R5.1, R5.2, R8.4). */
export class Player {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startTime = 0;

  /**
   * Creates or resumes the AudioContext. Call it synchronously from a user
   * gesture: Safari loses the gesture after an await (autoplay policy, R8.4).
   */
  unlock(): void {
    this.ctx ??= new AudioContext();
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  async play(samples: Float32Array<ArrayBuffer>, sampleRate: number): Promise<void> {
    this.stop();
    const ctx = (this.ctx ??= new AudioContext());
    if (ctx.state !== 'running') await ctx.resume();

    const buffer = new AudioBuffer({ length: samples.length, sampleRate });
    buffer.copyToChannel(samples, 0);
    const source = new AudioBufferSourceNode(ctx, { buffer });
    source.connect(ctx.destination);
    source.onended = () => {
      if (this.source === source) this.source = null;
    };
    this.source = source;
    this.startTime = ctx.currentTime + 0.02;
    source.start(this.startTime);
  }

  stop(): void {
    const source = this.source;
    if (!source) return;
    this.source = null;
    source.onended = null;
    source.stop();
    source.disconnect();
  }

  /** Seconds of audio the listener has heard so far, compensated for output latency (D7). */
  position(): number {
    if (!this.ctx) return 0;
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return this.ctx.currentTime - this.startTime - latency;
  }
}
