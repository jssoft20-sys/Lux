/* Voice message recorder using MediaRecorder + live waveform sampling. */
(function () {
  const Voice = {
    async start(opts) {
      opts = opts || {};
      if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('unsupported');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mime = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mime)) mime = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.start(100);
      const t0 = Date.now();

      // waveform sampling
      const waveform = [];
      let audioCtx, analyser, dataArr, rafId;
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const src = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser(); analyser.fftSize = 256;
        dataArr = new Uint8Array(analyser.frequencyBinCount);
        src.connect(analyser);
        let lastSample = 0;
        const tick = () => {
          analyser.getByteFrequencyData(dataArr);
          const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length / 255;
          const now = Date.now();
          if (now - lastSample > 120) { waveform.push(Math.min(1, avg * 1.8 + 0.1)); lastSample = now; if (waveform.length > 60) waveform.shift(); }
          opts.onLevel && opts.onLevel(avg);
          rafId = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {}

      function cleanup() {
        if (rafId) cancelAnimationFrame(rafId);
        if (audioCtx) audioCtx.close().catch(() => {});
        stream.getTracks().forEach((t) => t.stop());
      }

      return {
        stop() {
          return new Promise((resolve) => {
            rec.onstop = () => {
              cleanup();
              const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
              const duration = Math.max(1, Math.round((Date.now() - t0) / 1000));
              const wf = waveform.length ? waveform : Array.from({ length: 28 }, () => 0.3 + Math.random() * 0.6);
              resolve({ blob, duration, waveform: wf });
            };
            rec.stop();
          });
        },
        cancel() { try { rec.stop(); } catch (e) {} cleanup(); },
      };
    },
  };
  window.Voice = Voice;
})();
