// Streams 16 kHz Int16 PCM to the backend, from either the microphone or an
// audio file (the "recorded call" fallback). Both go through the same worklet,
// so the backend sees identical input.
// Served from public/ so the worklet loads as a plain same-origin script.
const workletUrl = '/pcm-worklet.js'

export async function startAudioStream({ file, onChunk, onLevel, onEnded }) {
  const ctx = new AudioContext()
  await ctx.audioWorklet.addModule(workletUrl)
  const node = new AudioWorkletNode(ctx, 'pcm-downsampler')
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  let source
  let stream
  let stopped = false

  if (file) {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer())
    source = ctx.createBufferSource()
    source.buffer = buf
    source.connect(ctx.destination) // let the room hear the recorded call
    // source.stop() also fires 'ended'; only report a natural end of the file.
    source.onended = () => {
      if (!stopped) onEnded?.()
    }
    source.start()
  } else {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    })
    source = ctx.createMediaStreamSource(stream)
  }
  source.connect(node)
  source.connect(analyser)
  node.port.onmessage = (e) => onChunk(e.data)

  const data = new Uint8Array(analyser.fftSize)
  let raf = 0
  const tick = () => {
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (const v of data) sum += ((v - 128) / 128) ** 2
    onLevel?.(Math.sqrt(sum / data.length))
    raf = requestAnimationFrame(tick)
  }
  tick()

  return {
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
      try {
        source.stop?.()
      } catch {}
      stream?.getTracks().forEach((t) => t.stop())
      node.disconnect()
      ctx.close()
    },
  }
}
