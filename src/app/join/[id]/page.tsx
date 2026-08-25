"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Meeting } from "@/lib/types";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  IconMicrophone,
  IconMicrophoneOff,
  IconVideo,
  IconVideoOff,
  IconScreenShare,
  IconScreenShareOff,
  IconPhoneOff,
  IconUsers,
  IconCopy,
  IconCheck,
} from "@tabler/icons-react";

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

type PeerInfo = {
  pc: RTCPeerConnection;
  stream: MediaStream;
  name: string;
  lastPing: number;
};

export default function GuestJoinPage() {
  const params = useParams<{ id: string }>();
  const meetingId = params.id;
  const router = useRouter();
  const supabase = createClient();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [guestName, setGuestName] = useState("");
  const [entered, setEntered] = useState(false);
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);

  // WebRTC state
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [peers, setPeers] = useState<Record<string, PeerInfo>>({});
  const [joined, setJoined] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<Record<string, PeerInfo>>({});
  const signalChannelRef = useRef<RealtimeChannel | null>(null);
  const pendingIceRef = useRef<Record<string, RTCIceCandidate[]>>({});
  const cleanupRef = useRef<(() => void) | null>(null);
  const hasJoinedRef = useRef(false);

  const guestId = useRef(`guest-${Math.random().toString(36).slice(2, 11)}`).current;

  // Check meeting exists, status, and link expiry
  useEffect(() => {
    const check = async () => {
      // Check link expiry (5 minutes = 300000 ms)
      if (typeof window !== "undefined") {
        const urlParams = new URLSearchParams(window.location.search);
        const linkTime = urlParams.get("t");
        if (linkTime) {
          const elapsed = Date.now() - parseInt(linkTime, 10);
          if (elapsed > 5 * 60 * 1000) {
            setLinkExpired(true);
            return;
          }
        }
      }

      const { data: mtg } = await supabase
        .from("meetings")
        .select("*")
        .eq("id", meetingId)
        .single();
      if (!mtg) {
        setNotFound(true);
        return;
      }
      setMeeting(mtg as Meeting);
      if (mtg.status === "ended") {
        setMeetingEnded(true);
      }
    };
    check();

    const meetingChannel = supabase
      .channel(`guest-meeting-status-${meetingId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "meetings",
          filter: `id=eq.${meetingId}`,
        },
        (payload) => {
          const updated = payload.new as Meeting;
          if (updated.status === "ended") {
            setMeetingEnded(true);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(meetingChannel);
    };
  }, [meetingId, supabase]);

  const updatePeers = useCallback(() => {
    setPeers({ ...peersRef.current });
  }, []);

  useEffect(() => {
    if (!joined) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [joined]);

  const formatElapsed = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const createPeer = useCallback(
    (remoteId: string, remoteName: string, initiator: boolean) => {
      // If peer already exists, return it — do NOT close and recreate.
      const existing = peersRef.current[remoteId];
      if (existing) {
        return existing.pc;
      }

      const pc = new RTCPeerConnection(ICE_SERVERS);
      const remoteStream = new MediaStream();
      peersRef.current[remoteId] = { pc, stream: remoteStream, name: remoteName, lastPing: Date.now() };
      pendingIceRef.current[remoteId] = [];
      updatePeers();

      if (initiator) {
        pc.onnegotiationneeded = async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            signalChannelRef.current?.send({
              type: "broadcast",
              event: "signal",
              payload: {
                from: guestId,
                fromName: guestName,
                to: remoteId,
                kind: "offer",
                data: pc.localDescription,
              },
            });
          } catch (e) {
            console.error("Negotiation error:", e);
          }
        };
      }

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      pc.ontrack = (e) => {
        if (e.streams && e.streams[0]) {
          const oldPeer = peersRef.current[remoteId];
          peersRef.current[remoteId] = {
            pc,
            stream: e.streams[0],
            name: oldPeer?.name ?? "Peer",
            lastPing: oldPeer?.lastPing ?? Date.now(),
          };
          e.streams[0].onremovetrack = () => updatePeers();
        } else if (e.track) {
          if (!remoteStream.getTracks().some((rt) => rt.id === e.track.id)) {
            remoteStream.addTrack(e.track);
          }
          e.track.onended = () => {
            remoteStream.removeTrack(e.track);
            updatePeers();
          };
        }
        updatePeers();
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          signalChannelRef.current?.send({
            type: "broadcast",
            event: "signal",
            payload: {
              from: guestId,
              to: remoteId,
              kind: "ice",
              data: e.candidate,
            },
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          pc.restartIce();
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          pc.restartIce();
        }
      };

      return pc;
    },
    [guestId, guestName, updatePeers]
  );

  const joinMeeting = async () => {
    if (!guestName.trim() || hasJoinedRef.current) return;
    hasJoinedRef.current = true;
    setEntered(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    } catch {
      setMediaError("Could not access camera/microphone. Check permissions.");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        localStreamRef.current = stream;
        setCamOn(false);
      } catch {
        localStreamRef.current = new MediaStream();
        setCamOn(false);
        setMicOn(false);
      }
    }

    const channel = supabase.channel(`meeting-${meetingId}`, {
      config: { broadcast: { self: false } },
    });
    signalChannelRef.current = channel;

    channel
      .on("broadcast", { event: "join" }, ({ payload }) => {
        // Only the side with the smaller ID initiates (prevents glare)
        if (payload.id !== guestId && guestId < payload.id) {
          createPeer(payload.id, payload.name, true);
        }
      })
      .on("broadcast", { event: "leave" }, ({ payload }) => {
        if (payload.id === guestId) return;
        const p = peersRef.current[payload.id];
        if (p) {
          try { p.pc.close(); } catch {}
          delete peersRef.current[payload.id];
          delete pendingIceRef.current[payload.id];
          updatePeers();
        }
      })
      .on("broadcast", { event: "ping" }, ({ payload }) => {
        if (payload.id !== guestId) {
          const p = peersRef.current[payload.id];
          if (p) {
            p.lastPing = Date.now();
          } else if (guestId < payload.id) {
            createPeer(payload.id, payload.name, true);
          }
        }
      })
      .on("broadcast", { event: "signal" }, async ({ payload }) => {
        if (payload.to !== guestId) return;
        const { from, fromName, kind, data } = payload;

        if (kind === "offer") {
          const pc = createPeer(from, fromName ?? "Peer", false);
          await pc.setRemoteDescription(new RTCSessionDescription(data));
          const buffered = pendingIceRef.current[from] || [];
          for (const candidate of buffered) {
            try { await pc.addIceCandidate(candidate); } catch {}
          }
          pendingIceRef.current[from] = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          channel.send({
            type: "broadcast",
            event: "signal",
            payload: {
              from: guestId,
              fromName: guestName,
              to: from,
              kind: "answer",
              data: pc.localDescription,
            },
          });
        } else if (kind === "answer") {
          const p = peersRef.current[from];
          if (p && !p.pc.currentRemoteDescription) {
            await p.pc.setRemoteDescription(new RTCSessionDescription(data));
            const buffered = pendingIceRef.current[from] || [];
            for (const candidate of buffered) {
              try { await p.pc.addIceCandidate(candidate); } catch {}
            }
            pendingIceRef.current[from] = [];
          }
        } else if (kind === "ice") {
          const p = peersRef.current[from];
          if (p && p.pc.currentRemoteDescription) {
            try {
              await p.pc.addIceCandidate(new RTCIceCandidate(data));
            } catch {}
          } else {
            if (!pendingIceRef.current[from]) pendingIceRef.current[from] = [];
            pendingIceRef.current[from].push(new RTCIceCandidate(data));
          }
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Send join immediately
          channel.send({
            type: "broadcast",
            event: "join",
            payload: { id: guestId, name: guestName, isGuest: true },
          });
          // Also send a ping immediately so late-joining peers discover us
          channel.send({
            type: "broadcast",
            event: "ping",
            payload: { id: guestId, name: guestName, isGuest: true },
          });
          setJoined(true);
        }
      });

    const heartbeat = setInterval(() => {
      channel.send({
        type: "broadcast",
        event: "ping",
        payload: { id: guestId, name: guestName, isGuest: true },
      });
    }, 15000);

    const staleCheck = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, p] of Object.entries(peersRef.current)) {
        if (now - p.lastPing > 45000) {
          try { p.pc.close(); } catch {}
          delete peersRef.current[id];
          delete pendingIceRef.current[id];
          changed = true;
        }
      }
      if (changed) updatePeers();
    }, 20000);

    cleanupRef.current = () => {
      clearInterval(heartbeat);
      clearInterval(staleCheck);
    };
  };

  useEffect(() => {
    return () => {
      if (cleanupRef.current) cleanupRef.current();
      signalChannelRef.current?.send({
        type: "broadcast",
        event: "leave",
        payload: { id: guestId },
      });
      Object.values(peersRef.current).forEach((p) => { try { p.pc.close(); } catch {} });
      peersRef.current = {};
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (signalChannelRef.current) supabase.removeChannel(signalChannelRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMicOn(track.enabled);
    }
  };

  const toggleCam = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCamOn(track.enabled);
    }
  };

  const replaceVideoTrack = async (newTrack: MediaStreamTrack) => {
    Object.values(peersRef.current).forEach((p) => {
      const sender = p.pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) sender.replaceTrack(newTrack);
    });
    if (localVideoRef.current) {
      const display = new MediaStream([
        newTrack,
        ...(localStreamRef.current?.getAudioTracks() ?? []),
      ]);
      localVideoRef.current.srcObject = display;
    }
  };

  const toggleScreenShare = async () => {
    if (sharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) await replaceVideoTrack(camTrack);
      setSharing(false);
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screen;
        const screenTrack = screen.getVideoTracks()[0];
        screenTrack.onended = async () => {
          const camTrack = localStreamRef.current?.getVideoTracks()[0];
          if (camTrack) await replaceVideoTrack(camTrack);
          setSharing(false);
        };
        await replaceVideoTrack(screenTrack);
        setSharing(true);
      } catch {}
    }
  };

  const leaveMeeting = () => {
    // Show meeting ended screen instead of redirecting to login
    setMeetingEnded(true);
  };

  // --- Landing screen: enter name ---
  if (linkExpired) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 text-neutral-400">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/10">
          <IconPhoneOff className="h-10 w-10 text-amber-500" />
        </div>
        <p className="text-lg font-semibold text-white">Link expired</p>
        <p className="text-sm text-neutral-500">This invite link has expired (valid for 5 minutes). Ask the host for a new link.</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 text-neutral-400">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10">
          <IconPhoneOff className="h-10 w-10 text-red-500" />
        </div>
        <p className="text-lg font-semibold text-white">Meeting not found</p>
        <p className="text-sm text-neutral-500">This meeting link is invalid or has expired.</p>
      </div>
    );
  }

  if (meetingEnded) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 text-neutral-400">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10">
          <IconPhoneOff className="h-10 w-10 text-red-500" />
        </div>
        <p className="text-lg font-semibold text-white">This meeting has ended</p>
        <p className="text-sm text-neutral-500">The meeting was ended by the host.</p>
      </div>
    );
  }

  if (!entered) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="Grid & Logic" className="h-10 w-10 rounded-full" />
            <div>
              <h2 className="text-lg font-bold text-white">Join Meeting</h2>
              {meeting && (
                <p className="text-xs text-neutral-500">{meeting.title}</p>
              )}
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                Your name
              </label>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && joinMeeting()}
                placeholder="Enter your name"
                autoFocus
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-3 text-sm text-white outline-none focus:border-cyan-500"
              />
            </div>
            <button
              onClick={joinMeeting}
              disabled={!guestName.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 py-3 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:opacity-40"
            >
              <IconVideo className="h-4 w-4" />
              Join Meeting
            </button>
          </div>

          <p className="mt-4 text-center text-[10px] text-neutral-600">
            By joining, you agree to allow camera and microphone access.
          </p>
        </div>
      </div>
    );
  }

  // --- Meeting room ---
  const peerList = Object.entries(peers);
  const totalParticipants = peerList.length + 1;
  const gridCols =
    totalParticipants <= 1
      ? "grid-cols-1"
      : totalParticipants <= 2
      ? "grid-cols-1 md:grid-cols-2"
      : totalParticipants <= 4
      ? "grid-cols-2"
      : totalParticipants <= 6
      ? "grid-cols-2 md:grid-cols-3"
      : "grid-cols-3 md:grid-cols-4";

  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-neutral-950">
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${joined ? "bg-red-500 animate-pulse" : "bg-amber-500"}`} />
            <span className="text-xs font-medium text-white sm:text-sm">
              {joined ? formatElapsed(elapsed) : "Connecting…"}
            </span>
          </div>
          <span className="text-neutral-600">|</span>
          <h1 className="truncate text-xs text-neutral-300 sm:text-sm">
            {meeting?.title ?? "Meeting"}
          </h1>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg bg-neutral-800/60 px-2 py-1.5 text-xs text-neutral-300 sm:px-3 sm:py-2 sm:text-sm">
          <IconUsers className="h-4 w-4" />
          {totalParticipants}
        </div>
      </div>

      {mediaError && (
        <div className="mx-3 mb-2 rounded-lg bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-400 sm:mx-4">
          {mediaError}
        </div>
      )}

      {/* Video grid */}
      <div className={`grid flex-1 gap-2 overflow-y-auto p-2 sm:gap-3 sm:p-3 md:p-4 ${gridCols}`}>
        {/* Local video tile */}
        <div className="relative min-h-36 overflow-hidden rounded-2xl bg-neutral-800 sm:min-h-48 md:min-h-56">
          {camOn ? (
            <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-600 text-base font-bold text-white sm:h-16 sm:w-16 sm:text-xl md:h-20 md:w-20">
                {guestName?.[0]?.toUpperCase()}
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent sm:h-16" />
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 sm:left-3 sm:gap-2">
            {!micOn && <IconMicrophoneOff className="h-3 w-3 text-red-400 sm:h-3.5 sm:w-3.5" />}
            <span className="text-[10px] font-medium text-white sm:text-xs">
              You (Guest) {sharing && "· sharing"}
            </span>
          </div>
        </div>

        {/* Remote video tiles */}
        {peerList.map(([id, peer]) => (
          <GuestRemoteVideo key={id} peer={peer} />
        ))}
      </div>

      {/* Bottom control bar */}
      <div className="flex items-center justify-center gap-1.5 px-2 py-3 sm:gap-2 sm:px-4 sm:py-4 md:gap-3">
        <GuestControlButton
          on={micOn}
          onClick={toggleMic}
          onIcon={<IconMicrophone className="h-5 w-5" />}
          offIcon={<IconMicrophoneOff className="h-5 w-5" />}
        />
        <GuestControlButton
          on={camOn}
          onClick={toggleCam}
          onIcon={<IconVideo className="h-5 w-5" />}
          offIcon={<IconVideoOff className="h-5 w-5" />}
        />
        <GuestControlButton
          on={!sharing}
          onClick={toggleScreenShare}
          onIcon={<IconScreenShare className="h-5 w-5" />}
          offIcon={<IconScreenShareOff className="h-5 w-5" />}
        />
        <div className="mx-1 h-8 w-px bg-neutral-700 sm:mx-2" />
        <button
          onClick={leaveMeeting}
          className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-3 text-white transition hover:bg-red-500 sm:px-5"
          title="Leave meeting"
        >
          <IconPhoneOff className="h-5 w-5" />
          <span className="hidden text-sm font-medium sm:inline">Leave</span>
        </button>
      </div>
    </div>
  );
}

function GuestRemoteVideo({ peer }: { peer: PeerInfo }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const updateStream = () => {
      if (video.srcObject !== peer.stream) {
        video.srcObject = peer.stream;
      }
      const tracks = peer.stream.getVideoTracks();
      const hasVid = tracks.length > 0 && tracks.some((t) => t.enabled && t.readyState === "live");
      setHasVideo(hasVid);
    };

    updateStream();

    const interval = setInterval(updateStream, 500);

    peer.stream.addEventListener("addtrack", updateStream);
    peer.stream.addEventListener("removetrack", updateStream);

    return () => {
      clearInterval(interval);
      peer.stream.removeEventListener("addtrack", updateStream);
      peer.stream.removeEventListener("removetrack", updateStream);
    };
  }, [peer.stream]);

  const initials = peer.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative min-h-36 overflow-hidden rounded-2xl bg-neutral-800 sm:min-h-48 md:min-h-56">
      {hasVideo ? (
        <video ref={ref} autoPlay playsInline className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-600 text-base font-bold text-white sm:h-16 sm:w-16 sm:text-xl md:h-20 md:w-20">
            {initials}
          </div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent sm:h-16" />
      <span className="absolute bottom-2 left-2 text-[10px] font-medium text-white sm:left-3 sm:text-xs">
        {peer.name}
      </span>
    </div>
  );
}

function GuestControlButton({
  on,
  onClick,
  onIcon,
  offIcon,
}: {
  on: boolean;
  onClick: () => void;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-full transition sm:h-12 sm:w-12 md:h-14 md:w-14 ${
        on
          ? "bg-neutral-800 text-white hover:bg-neutral-700"
          : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
      }`}
    >
      {on ? onIcon : offIcon}
    </button>
  );
}
