const socket = io("/");
const videoGrid = document.getElementById("video-grid");
const participantsList = document.getElementById("participants-list");
const videoToggleBtn = document.getElementById("video-toggle");
const audioToggleBtn = document.getElementById("audio-toggle");

let myPeer = null;
let myStream = null;
let isVideoOn = true;
let isAudioOn = true;

// Initialize peer connection
function initializePeer() {
  if (typeof Peer === "undefined") {
    setTimeout(initializePeer, 100);
    return;
  }

  try {
    myPeer = new Peer(undefined, {
      host: "/",
      port: "3001",
    });

    setupPeerEvents();
  } catch (error) {
    console.error("Failed to initialize Peer:", error);
  }
}

function setupPeerEvents() {
  const myVideo = document.createElement("video");
  myVideo.muted = true;
  const peers = {};

  navigator.mediaDevices
    .getUserMedia({
      video: true,
      audio: true,
    })
    .then((stream) => {
      myStream = stream;
      addVideoStream(myVideo, stream);

      myPeer.on("call", (call) => {
        call.answer(stream);
        const video = document.createElement("video");

        call.on("stream", (userVideoStream) => {
          addVideoStream(video, userVideoStream);
        });
      });

      socket.on("user-connected", (userId) => {
        connectToNewUser(userId, stream);
      });
    })
    .catch((err) => {
      console.error("Failed to get local stream:", err);
      alert("Failed to access camera and microphone.");
    });

  socket.on("user-disconnected", (userId) => {
    if (peers[userId]) {
      peers[userId].close();
      delete peers[userId];
    }
  });

  socket.on("update-participants", (participants) => {
    updateParticipantsList(participants);
  });

  myPeer.on("open", (id) => {
    socket.emit("join-room", ROOM_ID, id, GROUP_ID);
  });

  function connectToNewUser(userId, stream) {
    const call = myPeer.call(userId, stream);
    const video = document.createElement("video");

    call.on("stream", (userVideoStream) => {
      addVideoStream(video, userVideoStream);
    });

    call.on("close", () => {
      video.remove();
    });

    peers[userId] = call;
  }
}

function addVideoStream(video, stream) {
  video.srcObject = stream;
  video.addEventListener("loadedmetadata", () => {
    video.play().catch((e) => console.error("Failed to play video:", e));
  });
  videoGrid.append(video);
}

function updateParticipantsList(participants) {
  participantsList.innerHTML = participants
    .map((id) => `<div>Participant ${id.slice(0, 8)}</div>`)
    .join("");
}

// Video toggle
videoToggleBtn.addEventListener("click", () => {
  if (myStream) {
    const videoTrack = myStream.getVideoTracks()[0];
    if (videoTrack) {
      isVideoOn = !isVideoOn;
      videoTrack.enabled = isVideoOn;
      videoToggleBtn.textContent = isVideoOn
        ? "Turn Off Video"
        : "Turn On Video";
      videoToggleBtn.classList.toggle("off");
    }
  }
});

// Audio toggle
audioToggleBtn.addEventListener("click", () => {
  if (myStream) {
    const audioTrack = myStream.getAudioTracks()[0];
    if (audioTrack) {
      isAudioOn = !isAudioOn;
      audioTrack.enabled = isAudioOn;
      audioToggleBtn.textContent = isAudioOn ? "Mute Audio" : "Unmute Audio";
      audioToggleBtn.classList.toggle("off");
    }
  }
});

// Start initialization
initializePeer();
