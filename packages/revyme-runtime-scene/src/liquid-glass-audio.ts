/** Analyse a playback stream without rerouting or muting the original media. */
export function observeGlassAudio(doc: Document, sourceId: string) {
  const media = sourceId
    ? Array.from(doc.querySelectorAll<HTMLMediaElement>('audio,video')).find(el => el.getAttribute('data-id') === sourceId)
    : doc.querySelector<HTMLMediaElement>('audio,video');
  let context: AudioContext | undefined;
  let analyser: AnalyserNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let stream: MediaStream | undefined;
  let data: Uint8Array<ArrayBuffer> | undefined;
  let closed = false;
  let state: 'waiting' | 'active' | 'unavailable' = 'waiting';
  const start = () => {
    if (!media || closed || analyser) return;
    const capture = (media as HTMLMediaElement & { captureStream?: () => MediaStream }).captureStream;
    if (!capture || typeof AudioContext === 'undefined') { state = 'unavailable'; return; }
    try {
      stream = capture.call(media);
      if (!stream.getAudioTracks().length) { stream.getTracks().forEach(track => track.stop()); stream = undefined; return; }
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      data = new Uint8Array(analyser.frequencyBinCount);
      void context.resume().then(() => { if (!closed) state = context?.state === 'running' ? 'active' : 'waiting'; });
    } catch { state = 'unavailable'; }
  };
  media?.addEventListener('playing', start);
  const resume = () => { if (context?.state === 'suspended') void context.resume(); };
  doc.addEventListener('pointerdown', resume, { passive: true });
  if (media && !media.paused) start();
  return {
    get state() { return state; },
    get playing() { return !!media && !media.paused && !media.ended; },
    read() {
      if (!analyser || !data || media?.paused) return 0;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (const value of data) sum += value;
      return sum / (data.length * 255);
    },
    destroy() {
      closed = true;
      media?.removeEventListener('playing', start);
      doc.removeEventListener('pointerdown', resume);
      source?.disconnect(); analyser?.disconnect();
      stream?.getTracks().forEach(track => track.stop());
      if (context && context.state !== 'closed') void context.close();
    },
  };
}
