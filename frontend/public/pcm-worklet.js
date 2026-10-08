// AudioWorklet: collects mono float frames at the context's sample rate,
// downsamples to 16 kHz and posts Int16 PCM chunks of ~100 ms to the main thread.
class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.buf = []
    this.pos = 0
    this.chunk = 1600 // 100 ms at 16 kHz
    this.out = new Int16Array(this.chunk)
    this.outLen = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true
    const ch = input[0]
    // Linear-interpolation resampler, stateful across render quanta.
    for (let i = 0; i < ch.length; i++) this.buf.push(ch[i])
    while (this.pos + 1 < this.buf.length) {
      const i0 = Math.floor(this.pos)
      const frac = this.pos - i0
      const s = this.buf[i0] * (1 - frac) + this.buf[i0 + 1] * frac
      this.out[this.outLen++] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)))
      if (this.outLen === this.chunk) {
        this.port.postMessage(this.out.slice(0))
        this.outLen = 0
      }
      this.pos += this.ratio
    }
    const drop = Math.floor(this.pos)
    this.buf = this.buf.slice(drop)
    this.pos -= drop
    return true
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler)
