let display;
let currentCallCh = '';
let mediaStream;
let peerConnection;
let gc = [];

const micIcons = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><rect x="83" width="90" height="150" rx="45"/><path d="M53 95V105C53 146.421 86.5786 180 128 180C169.421 180 203 146.421 203 105V95" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M128 180V240" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M153 241H103" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M38 218L218 38" stroke-width="40" stroke-linecap="round" fill="none"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><rect x="83" width="90" height="150" rx="45"/><path d="M53 95V105C53 146.421 86.5786 180 128 180C169.421 180 203 146.421 203 105V95" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M128 180V240" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M153 241H103" stroke-width="30" stroke-linecap="round" fill="none"/></svg>'
];

async function connect() {
  // Connect
  let servers = window.serverData[getCurrentServerUrl()].calls.stun_servers.map(url=>({urls:[url]}));
  if (window.serverData[getCurrentServerUrl()].calls.turn_servers.length) servers.push({
    urls: [window.serverData[getCurrentServerUrl()].calls.turn_servers],
    username: window.serverData[getCurrentServerUrl()].calls.turn_username,
    credential: window.serverData[getCurrentServerUrl()].calls.turn_password
  });
  let config = { iceServers: servers };
  peerConnection = new RTCPeerConnection(config);

  if (mediaStream) {
    mediaStream.getTracks().forEach(track=>{
      peerConnection.addTrack(track, mediaStream);
    });
  }

  peerConnection.onicecandidate = (evt)=>{
    if (!evt.candidate) return;
    backendfetch(`/api/v1/channel/${currentCallCh}/call/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ice', data: evt.candidate })
    });
  };
  peerConnection.ontrack = (evt)=>{
    switch(evt.track.kind) {
      case 'audio':
        if (!evt.streams||!evt.streams[0]) return;
        let audio = new Audio();
        gc.push(audio);
        audio.autoplay = true;
        audio.playsinline = true;
        audio.srcObject = evt.streams[0];
        break;
    }
  };
  peerConnection.onconnectionstatechange = ()=>{
    switch (peerConnection.connectionState) {
      case 'connected':
      case 'completed':
        break;
      case 'disconnected':
      case 'failed':
      case 'closed':
        leaveCall();
        break;
    }
  };

  // Offer
  let offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await backendfetch(`/api/v1/channel/${currentCallCh}/call/signal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'offer', data: offer })
  });
}

export async function startCall(channel) {
  if (currentCallCh===channel) return;
  // Start
  currentCallCh = channel;
  display = document.getElementById('call-display');
  display.style.display = '';
  let micButton = document.getElementById('micButton');
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    window.toggleMic = ()=>{
      let audioTrack = mediaStream.getAudioTracks()[0];
      audioTrack.enabled = !audioTrack.enabled;
      micButton.setAttribute('tlang', 'channel.call.micro.'+(audioTrack.enabled?'off':'on'));
      micButton.innerHTML = micIcons[Number(audioTrack.enabled)];
    };
    micButton.disabled = false;
  } catch(err) {
    micButton.disabled = true;
  }
  await backendfetch(`/api/v1/channel/${channel}/call`, {
    method: 'POST'
  });

  let attemps = 0;
  let int;
  int = setInterval(async()=>{
    if (attemps>=60) { // ~2 mins
      clearInterval(int);
      leaveCall();
      return;
    }
    attemps += 1;
    let stat = await backendfetch(`/api/v1/channel/${channel}/call`);

    if (stat.answered) {
      clearInterval(int);
      connect();
    }
  }, 2000);
};
export async function event(type, data) {
  if (data.started_by===window.username) return;
  if (type==='start') {
    let pick = await affirm('channel.callincoming', data.started_by);
    if (pick) startCall(data.channel_id);
  }
}
export async function signal(data) {
  if (!peerConnection) return;
  switch(data.type) {
    case 'offer':
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.data));
      let answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await backendfetch(`/api/v1/channel/${currentCallCh}/call/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type:'answer', data: answer })
      });
      break;
    case 'answer':
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.data));
      break;
    case 'ice':
      if (!data.data) return;
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.data));
      } catch(err) {
        // Ignore :3
      }
      break;
  }
}
export function leaveCall() {
  if (currentCallCh==='') return;
  backendfetch(`/api/v1/channel/${currentCallCh}/call`, {
    method: 'DELETE'
  })
    .then(()=>{
      currentCallCh = '';
      display.style.display = 'none';
      peerConnection?.close();
      peerConnection = null;
      mediaStream?.getTracks().forEach(track=>track.stop());
      mediaStream = null;
      gc.forEach(garbage=>garbage.remove());
    });
}