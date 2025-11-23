let display;
let currentCallCh = '';
let mediaStream;
let peerConnection;
let queue = [];
let gc = [];

let answered = false;

const micIcons = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><rect x="83" width="90" height="150" rx="45"/><path d="M53 95V105C53 146.421 86.5786 180 128 180C169.421 180 203 146.421 203 105V95" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M128 180V240" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M153 241H103" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M38 218L218 38" stroke-width="40" stroke-linecap="round" fill="none"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256"><rect x="83" width="90" height="150" rx="45"/><path d="M53 95V105C53 146.421 86.5786 180 128 180C169.421 180 203 146.421 203 105V95" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M128 180V240" stroke-width="30" stroke-linecap="round" fill="none"/><path d="M153 241H103" stroke-width="30" stroke-linecap="round" fill="none"/></svg>'
];

function showConnections() {
  if (!display) return;
  backendfetch(`/api/v1/channel/${window.currentChannel}/call`)
    .then(res=>{
      if (!res.active) return;
      display.querySelector('.grid').innerHTML = res.participants
        .map(m=>`<img src="${m.pfp?pfpById(m.pfp):userToDefaultPfp(m)}">`)
        .join('');
    });
}

async function connect() {
  if (peerConnection) return;
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
      case 'disconnected':
      case 'failed':
      case 'closed':
        leaveCall();
        break;
    }
  };

  for (let i=0;i<queue.length;i++) {
    await handleSignal(queue[i]);
  }
  queue = [];

  // Offer
  if (peerConnection.currentRemoteDescription||peerConnection.signalingState!=='stable') return;
  let offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await backendfetch(`/api/v1/channel/${currentCallCh}/call/signal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'offer', data: offer })
  });
}

export async function startCall(channel, ans=false) {
  if (currentCallCh===channel) return;
  // Start
  currentCallCh = channel;
  answered = ans;
  display = document.getElementById('call-display');
  display.style.display = '';
  queue = [];
  showConnections();
  let micButton = document.getElementById('micButton');
  micButton.setAttribute('tlang', 'channel.call.micro.off');
  micButton.innerHTML = micIcons[1];
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

  if (answered) {
    connect();
    return;
  }

  setTimeout(()=>{
    if (!peerConnection&&currentCallCh!=='') leaveCall();
  }, 2*60*1000); // 2 mins
};
export async function event(type, data) {
  if (data.started_by===window.username) return;
  switch(type) {
    case 'start':
      if (!document.hasFocus()) notify('call_start', data);
      let pick = await affirm('channel.callincoming', data.started_by);
      if (pick) startCall(data.channel_id, true);
      break;
    case 'join':
      showConnections();
      if (data.user.username!==window.username) {
        if (peerConnection) {
          answered = true;
        } else {
          connect();
        }
      }
      break;
    case 'left':
      showConnections();
      break;
  }
}
async function handleSignal(data) {
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
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.data));
      } catch(err) {
        // Ignore :3
      }
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
export function signal(data) {
  if (!peerConnection) {
    queue.push(data);
    return;
  }
  handleSignal(data);
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
window.addEventListener('pagehide', ()=>{
  if (currentCallCh==='') return;
  leaveCall();
});