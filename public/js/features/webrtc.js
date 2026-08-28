/* WebRTC call manager. Signaling over Socket.IO via App events. window.WebRTC */
(function () {
  const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

  let active = null; // { callId, pc, localStream, ui, peer, video, role }

  async function getMedia(video) {
    return navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: 'user' } : false });
  }

  function bindPc(pc, callId) {
    pc.onicecandidate = (e) => { if (e.candidate) App.emit('call:ice', { callId, candidate: e.candidate }); };
    pc.ontrack = (e) => { if (active && active.ui) active.ui.attachRemote(e.streams[0]); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected' && active && active.ui) { active.ui.setStatus('Соединение установлено'); active.ui.startTimer(); } };
  }

  const WebRTC = {
    async call(peer, video) {
      if (active) return;
      if (!navigator.mediaDevices) return UI.toast('Звонки не поддерживаются в этом браузере');
      let localStream;
      try { localStream = await getMedia(video); } catch (e) { return UI.toast('Нет доступа к камере/микрофону'); }
      const pc = new RTCPeerConnection(ICE);
      const ui = window.CallUI.open({ peer, video, incoming: false,
        onHangup: () => hangup('ended'),
        onToggleMute: (m) => localStream.getAudioTracks().forEach((t) => t.enabled = !m),
        onToggleVideo: (v) => localStream.getVideoTracks().forEach((t) => t.enabled = v),
        onToggleSpeaker: () => {}, });
      active = { pc, localStream, ui, peer, video, role: 'caller', callId: null };
      ui.attachLocal(localStream);
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
      bindPc(pc, null);
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      App.emit('call:invite', { toId: peer.id, video: !!video, sdp: offer });
      // callId assigned on ringing
      App.bus.emit('__internal'); // noop
    },

    async onIncoming(p) {
      if (active) { App.emit('call:decline', { callId: p.callId }); return; }
      const peer = p.from;
      const ui = window.CallUI.open({ peer, video: p.video, incoming: true,
        onAccept: () => acceptIncoming(p),
        onDecline: () => { App.emit('call:decline', { callId: p.callId }); teardown(); },
        onHangup: () => hangup('ended'),
        onToggleMute: (m) => active && active.localStream.getAudioTracks().forEach((t) => t.enabled = !m),
        onToggleVideo: (v) => active && active.localStream.getVideoTracks().forEach((t) => t.enabled = v),
      });
      active = { ui, peer, video: p.video, role: 'callee', callId: p.callId, offer: p.sdp, pc: null, localStream: null };
      try { new Audio().play(); } catch (e) {}
    },
  };

  async function acceptIncoming(p) {
    if (!active) return;
    let localStream;
    try { localStream = await getMedia(active.video); } catch (e) { UI.toast('Нет доступа к устройствам'); App.emit('call:decline', { callId: p.callId }); teardown(); return; }
    const pc = new RTCPeerConnection(ICE);
    active.pc = pc; active.localStream = localStream;
    active.ui.attachLocal(localStream); active.ui.setIncoming(false); active.ui.setStatus('Соединение…');
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    bindPc(pc, active.callId);
    await pc.setRemoteDescription(new RTCSessionDescription(active.offer));
    const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
    App.emit('call:answer', { callId: active.callId, sdp: answer });
    flushIce();
  }

  const pendingIce = [];
  function flushIce() { if (!active || !active.pc) return; while (pendingIce.length) active.pc.addIceCandidate(new RTCIceCandidate(pendingIce.shift())).catch(() => {}); }

  function hangup(reason) {
    if (active && active.callId) App.emit('call:hangup', { callId: active.callId, reason });
    teardown();
  }
  function teardown() {
    if (!active) return;
    try { active.pc && active.pc.close(); } catch (e) {}
    try { active.localStream && active.localStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    if (active.ui) active.ui.destroy();
    active = null;
    pendingIce.length = 0;
  }

  // signaling listeners
  App.bus.on('call:ringing', (p) => { if (active && active.role === 'caller') { active.callId = p.callId; active.ui.setStatus('Вызов…'); } });
  App.bus.on('call:answered', async (p) => {
    if (!active || active.role !== 'caller') return;
    try { await active.pc.setRemoteDescription(new RTCSessionDescription(p.sdp)); active.ui.setStatus('Соединение…'); flushIce(); } catch (e) { console.warn(e); }
  });
  App.bus.on('call:ice', (p) => {
    if (!active) return;
    if (active.pc && active.pc.remoteDescription) active.pc.addIceCandidate(new RTCIceCandidate(p.candidate)).catch(() => {});
    else pendingIce.push(p.candidate);
  });
  App.bus.on('call:hangup', () => { UI.toast('Звонок завершён'); teardown(); });
  App.bus.on('call:declined', () => { UI.toast('Абонент отклонил вызов'); teardown(); });

  window.WebRTC = WebRTC;
})();
