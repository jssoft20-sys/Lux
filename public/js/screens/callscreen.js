/* In-call full-screen UI. window.CallUI.open(opts) -> controller */
(function () {
  const UI = window.UI, h = UI.h, Icons = window.Icons;

  const CallUI = {
    open(opts) {
      const overlay = h('div', { class: 'call-screen ' + (opts.video ? 'video' : '') + (opts.incoming ? ' ringing' : '') });
      const remoteVideo = h('video', { class: 'remote-video', autoplay: true, playsinline: true });
      const localVideo = h('video', { class: 'local-video', autoplay: true, playsinline: true, muted: true });
      if (opts.video) { overlay.appendChild(remoteVideo); overlay.appendChild(localVideo); }

      const av = UI.avatar(opts.peer || {}, 120);
      const ring = h('div', { class: 'pulse-ring', style: { width: '120px', height: '120px' } });
      const avatarWrap = h('div', { style: { position: 'relative' } }, ring, av);
      const status = h('div', { class: 'c-status', text: opts.incoming ? (opts.video ? 'Входящий видеозвонок' : 'Входящий звонок') : 'Вызов…' });
      const top = h('div', { class: 'call-top' }, avatarWrap,
        h('div', { class: 'c-name', text: (opts.peer && (opts.peer.name + (opts.peer.lastName ? ' ' + opts.peer.lastName : ''))) || 'Звонок' }),
        status, h('div', { class: 'c-encrypt', html: Icons.lock() + ' сквозное шифрование' }));
      overlay.appendChild(top);

      const controls = h('div', { class: 'call-controls' });
      let muted = false, videoOn = opts.video, speaker = true;
      function ctlBtn(icon, label, onClick, cls) { return h('button', { class: 'call-btn ' + (cls || ''), onClick }, UI.svg(icon), h('span', { text: label })); }

      const muteBtn = ctlBtn('micOff', 'Микрофон', () => { muted = !muted; muteBtn.classList.toggle('active', muted); opts.onToggleMute && opts.onToggleMute(muted); });
      const videoBtn = ctlBtn('video', 'Камера', () => { videoOn = !videoOn; videoBtn.classList.toggle('active', !videoOn); opts.onToggleVideo && opts.onToggleVideo(videoOn); });
      const speakerBtn = ctlBtn('speaker', 'Динамик', () => { speaker = !speaker; speakerBtn.classList.toggle('active', speaker); opts.onToggleSpeaker && opts.onToggleSpeaker(speaker); });
      const hangupBtn = h('button', { class: 'call-btn hangup', onClick: () => opts.onHangup && opts.onHangup() }, UI.svg('hangup'));

      function renderControls(state) {
        UI.clear(controls);
        if (state === 'incoming') {
          const decline = h('button', { class: 'call-btn hangup', onClick: () => opts.onDecline && opts.onDecline() }, UI.svg('hangup'));
          const accept = h('button', { class: 'call-btn answer', onClick: () => opts.onAccept && opts.onAccept() }, UI.svg('phone'));
          controls.appendChild(decline); controls.appendChild(accept);
        } else {
          controls.appendChild(muteBtn);
          if (opts.video) controls.appendChild(videoBtn);
          controls.appendChild(speakerBtn);
          controls.appendChild(hangupBtn);
        }
      }
      renderControls(opts.incoming ? 'incoming' : 'active');
      overlay.appendChild(controls);

      App.el.overlayLayer.appendChild(overlay);
      overlay.style.pointerEvents = 'auto';

      let durTimer, dur = 0;
      const controller = {
        setStatus(t) { status.textContent = t; },
        startTimer() { if (durTimer) return; ring.remove(); durTimer = setInterval(() => { dur++; status.textContent = UI.duration(dur); }, 1000); renderControls('active'); },
        attachRemote(stream) { if (opts.video) { remoteVideo.srcObject = stream; } else { let a = overlay._remoteAudio; if (!a) { a = h('audio', { autoplay: true }); overlay.appendChild(a); overlay._remoteAudio = a; } a.srcObject = stream; } },
        attachLocal(stream) { if (opts.video) localVideo.srcObject = stream; },
        setIncoming(v) { renderControls(v ? 'incoming' : 'active'); },
        destroy() { clearInterval(durTimer); overlay.classList.add('exit-active'); overlay.style.opacity = 0; overlay.style.transition = 'opacity .3s'; setTimeout(() => overlay.remove(), 300); },
      };
      return controller;
    },
  };
  window.CallUI = CallUI;
})();
