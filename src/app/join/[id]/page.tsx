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
  IconSettings,
  IconChevronDown,
  IconCamera,
  IconVolume,
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
  isSharing?: boolean;
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

  // Pre-join camera preview
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [previewCamOn, setPreviewCamOn] = useState(true);
  const [previewMicOn, setPreviewMicOn] = useState(true);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  // WebRTC state
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [peers, setPeers] = useState<Record<string, PeerInfo>>({});
  const [joined, setJoined] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [activeShareId, setActiveShareId] = useState<string | null>(null);

  // Device selection state
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>("");
  const [selectedAudioId, setSelectedAudioId] = useState<string>("");
  const [selectedOutputId, setSelectedOutputId] = useState<string>("");
  const [showDeviceMenu, setShowDeviceMenu] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<Record<string, PeerInfo>>({});
  const signalChannelRef = useRef<RealtimeChannel | null>(null);
  const pendingIceRef = useRef<Record<string, RTCIceCandidate[]>>({});
  const cleanupRef = useRef<(() => void) | null>(null);
  const hasJoinedRef = useRef(false);
  // Canvas PiP compositor refs
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositeAnimFrameRef = useRef<number | null>(null);
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const screenVideoElRef = useRef<HTMLVideoElement | null>(null);
  const camVideoElRef = useRef<HTMLVideoElement | null>(null);

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

  // Pre-join camera preview — start camera early so user sees themselves before clicking Join
  useEffect(() => {
    if (entered) return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true })
      .then((s) => {
        stream = s;
        setPreviewStream(s);
        if (previewVideoRef.current) previewVideoRef.current.srcObject = s;
      })
      .catch(() => {
        setPreviewCamOn(false);
      });
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      setPreviewStream(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered]);

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
      const existing = peersRef.current[remoteId];
      if (existing) {
        console.log(`[Guest WebRTC] Peer ${remoteId} already exists, returning existing`);
        return existing.pc;
      }

      console.log(`[Guest WebRTC] Creating peer ${remoteId} as ${initiator ? "initiator" : "receiver"}`);

      const pc = new RTCPeerConnection(ICE_SERVERS);
      const remoteStream = new MediaStream();
      peersRef.current[remoteId] = { pc, stream: remoteStream, name: remoteName, lastPing: Date.now() };
      pendingIceRef.current[remoteId] = [];
      updatePeers();

      if (initiator) {
        pc.onnegotiationneeded = async () => {
          try {
            console.log(`[Guest WebRTC] Negotiation needed for ${remoteId}, creating offer...`);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            console.log(`[Guest WebRTC] Sending offer to ${remoteId}`);
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
        console.log(`[Guest WebRTC] ontrack fired for ${remoteId}, streams:`, e.streams?.length, "track:", e.track?.kind);
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
        } else {
          console.log(`[Guest WebRTC] ICE gathering complete for ${remoteId}`);
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[Guest WebRTC] Connection state for ${remoteId}: ${pc.connectionState}`);
        if (pc.connectionState === "failed") {
          pc.restartIce();
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[Guest WebRTC] ICE connection state for ${remoteId}: ${pc.iceConnectionState}`);
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
        console.log(`[Guest Signal] Received join from ${payload.id}, guestId=${guestId}, shouldInitiate=${guestId < payload.id}`);
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
          if (activeShareId === payload.id) setActiveShareId(null);
          updatePeers();
        }
      })
      .on("broadcast", { event: "share" }, ({ payload }) => {
        if (payload.id === guestId) return;
        const p = peersRef.current[payload.id];
        if (p) {
          p.isSharing = true;
          updatePeers();
          setActiveShareId((cur) => cur ?? payload.id);
        }
      })
      .on("broadcast", { event: "unshare" }, ({ payload }) => {
        if (payload.id === guestId) return;
        const p = peersRef.current[payload.id];
        if (p) {
          p.isSharing = false;
          updatePeers();
          if (activeShareId === payload.id) {
            const nextShare = Object.entries(peersRef.current).find(
              ([id, peer]) => peer.isSharing && id !== payload.id
            );
            setActiveShareId(nextShare ? nextShare[0] : null);
          }
        }
      })
      .on("broadcast", { event: "ping" }, ({ payload }) => {
        if (payload.id !== guestId) {
          const p = peersRef.current[payload.id];
          if (p) {
            p.lastPing = Date.now();
          } else if (guestId < payload.id) {
            console.log(`[Guest Signal] Discovered new peer via ping: ${payload.id}`);
            createPeer(payload.id, payload.name, true);
          }
        }
      })
      .on("broadcast", { event: "signal" }, async ({ payload }) => {
        if (payload.to !== guestId) return;
        const { from, fromName, kind, data } = payload;
        console.log(`[Guest Signal] Received ${kind} from ${from}`);

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
        console.log(`[Guest Signal] Channel subscription status: ${status}`);
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

  const startCompositing = (screenStream: MediaStream, camStream: MediaStream): MediaStreamTrack => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    compositeCanvasRef.current = canvas;

    const screenVid = document.createElement("video");
    screenVid.srcObject = screenStream;
    screenVid.autoplay = true;
    screenVid.playsInline = true;
    screenVid.muted = true;
    screenVideoElRef.current = screenVid;

    const camVid = document.createElement("video");
    camVid.srcObject = camStream;
    camVid.autoplay = true;
    camVid.playsInline = true;
    camVid.muted = true;
    camVideoElRef.current = camVid;

    const ctx = canvas.getContext("2d")!;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (screenVid.readyState >= screenVid.HAVE_CURRENT_DATA) {
        ctx.drawImage(screenVid, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (camVid.readyState >= camVid.HAVE_CURRENT_DATA) {
        const pipW = 240, pipH = 135, margin = 16;
        const x = canvas.width - pipW - margin;
        const y = canvas.height - pipH - margin;
        const r = 12;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.lineTo(x + pipW - r, y);
        ctx.quadraticCurveTo(x + pipW, y, x + pipW, y + r);
        ctx.lineTo(x + pipW, y + pipH - r);
        ctx.quadraticCurveTo(x + pipW, y + pipH, x + pipW - r, y + pipH);
        ctx.lineTo(x + r, y + pipH);
        ctx.quadraticCurveTo(x, y + pipH, x, y + pipH - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(camVid, x, y, pipW, pipH);
        ctx.restore();
        ctx.strokeStyle = "rgba(0,212,200,0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.lineTo(x + pipW - r, y);
        ctx.quadraticCurveTo(x + pipW, y, x + pipW, y + r);
        ctx.lineTo(x + pipW, y + pipH - r);
        ctx.quadraticCurveTo(x + pipW, y + pipH, x + pipW - r, y + pipH);
        ctx.lineTo(x + r, y + pipH);
        ctx.quadraticCurveTo(x, y + pipH, x, y + pipH - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.stroke();
      }
      compositeAnimFrameRef.current = requestAnimationFrame(draw);
    };
    screenVid.play().catch(() => {});
    camVid.play().catch(() => {});
    draw();
    const canvasStream = canvas.captureStream(30);
    compositeStreamRef.current = canvasStream;
    return canvasStream.getVideoTracks()[0];
  };

  const stopCompositing = () => {
    if (compositeAnimFrameRef.current !== null) {
      cancelAnimationFrame(compositeAnimFrameRef.current);
      compositeAnimFrameRef.current = null;
    }
    compositeStreamRef.current?.getTracks().forEach((t) => t.stop());
    compositeStreamRef.current = null;
    if (screenVideoElRef.current) { screenVideoElRef.current.srcObject = null; screenVideoElRef.current = null; }
    if (camVideoElRef.current) { camVideoElRef.current.srcObject = null; camVideoElRef.current = null; }
    compositeCanvasRef.current = null;
  };

  const toggleScreenShare = async () => {
    if (sharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      stopCompositing();
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) await replaceVideoTrack(camTrack);
      setSharing(false);
      signalChannelRef.current?.send({
        type: "broadcast",
        event: "unshare",
        payload: { id: guestId },
      });
    } else {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setMediaError("Screen sharing is not available in this browser. You can still use your camera and microphone.");
        return;
      }
      try {
        setMediaError(null);
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 } });
        screenStreamRef.current = screen;
        const camStream = localStreamRef.current ?? new MediaStream();
        const compositeTrack = startCompositing(screen, camStream);

        screen.getVideoTracks()[0].onended = async () => {
          stopCompositing();
          screenStreamRef.current?.getTracks().forEach((t) => t.stop());
          screenStreamRef.current = null;
          const camTrack = localStreamRef.current?.getVideoTracks()[0];
          if (camTrack) await replaceVideoTrack(camTrack);
          setSharing(false);
          signalChannelRef.current?.send({
            type: "broadcast",
            event: "unshare",
            payload: { id: guestId },
          });
        };

        Object.values(peersRef.current).forEach((p) => {
          const sender = p.pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) sender.replaceTrack(compositeTrack);
        });

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = new MediaStream([
            screen.getVideoTracks()[0],
            ...(localStreamRef.current?.getAudioTracks() ?? []),
          ]);
        }

        setSharing(true);
        signalChannelRef.current?.send({
          type: "broadcast",
          event: "share",
          payload: { id: guestId },
        });
      } catch (error) {
        const name = (error as DOMException)?.name;
        if (name !== "NotAllowedError" && name !== "AbortError") {
          setMediaError("Could not start screen sharing. Check browser permissions and try again.");
        }
      }
    }
  };

  const leaveMeeting = () => {
    // Send leave broadcast so host removes our video
    signalChannelRef.current?.send({
      type: "broadcast",
      event: "leave",
      payload: { id: guestId },
    });
    // Close all peer connections
    Object.values(peersRef.current).forEach((p) => { try { p.pc.close(); } catch {} });
    peersRef.current = {};
    // Stop local tracks
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    // Remove channel
    if (signalChannelRef.current) supabase.removeChannel(signalChannelRef.current);
    if (cleanupRef.current) cleanupRef.current();
    // Show meeting ended screen
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
        <img src="/logo.svg" alt="Grid & Logic" className="h-20 w-20 rounded-full" />
        <p className="text-lg font-semibold text-white">Thanks for attending</p>
        <p className="text-sm text-neutral-500">Regards, Grid &amp; Logic</p>
      </div>
    );
  }

  if (!entered) {
    const togglePreviewCam = () => {
      if (!previewStream) return;
      previewStream.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
      setPreviewCamOn((v) => !v);
    };
    const togglePreviewMic = () => {
      if (!previewStream) return;
      previewStream.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
      setPreviewMicOn((v) => !v);
    };

    return (
      <div className="flex min-h-screen flex-col bg-neutral-950 md:flex-row">
        {/* Left hero panel */}
        <div className="relative flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-neutral-900 via-cyan-950/30 to-neutral-900 px-8 py-12 md:w-1/2 md:min-h-screen">
          {/* Background decorative rings */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full border border-cyan-500/10" />
            <div className="absolute -left-12 -top-12 h-48 w-48 rounded-full border border-cyan-500/10" />
            <div className="absolute -right-16 bottom-16 h-56 w-56 rounded-full border border-cyan-500/10" />
          </div>

          <div className="relative flex flex-col items-center text-center">
            <img src="/logo.svg" alt="Grid & Logic" className="mb-6 h-16 w-16 rounded-2xl shadow-lg shadow-cyan-500/20" />
            <h1 className="text-2xl font-bold text-white sm:text-3xl">Grid &amp; Logic</h1>
            <p className="mt-1 text-sm font-medium text-cyan-400">Professional Video Meetings</p>

            {meeting && (
              <div className="mt-8 w-full max-w-xs rounded-2xl border border-neutral-700/60 bg-neutral-800/50 p-5 backdrop-blur-sm">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">You&apos;re joining</p>
                <p className="mt-1 text-lg font-semibold text-white">{meeting.title}</p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs text-green-400">Meeting is live</span>
                </div>
              </div>
            )}

            <div className="mt-8 flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-2">
              <svg className="h-3.5 w-3.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-xs font-medium text-cyan-300">Guest Access</span>
            </div>
          </div>
        </div>

        {/* Right panel — camera preview + join form */}
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 md:w-1/2">
          {/* Camera preview */}
          <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-neutral-800 shadow-xl" style={{ aspectRatio: "16/9" }}>
            {previewCamOn && previewStream ? (
              <video
                ref={(el) => {
                  previewVideoRef.current = el;
                  if (el && previewStream && el.srcObject !== previewStream) el.srcObject = previewStream;
                }}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-800">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-cyan-600 text-2xl font-bold text-white">
                  {guestName?.[0]?.toUpperCase() || "?"}
                </div>
              </div>
            )}
            {/* Cam/Mic toggle buttons overlay */}
            <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center gap-3">
              <button
                onClick={togglePreviewCam}
                title={previewCamOn ? "Turn off camera" : "Turn on camera"}
                className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition ${
                  previewCamOn ? "bg-neutral-700 text-white hover:bg-neutral-600" : "bg-red-500 text-white hover:bg-red-400"
                }`}
              >
                {previewCamOn ? (
                  <IconVideo className="h-5 w-5" />
                ) : (
                  <IconVideoOff className="h-5 w-5" />
                )}
              </button>
              <button
                onClick={togglePreviewMic}
                title={previewMicOn ? "Turn off microphone" : "Turn on microphone"}
                className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition ${
                  previewMicOn ? "bg-neutral-700 text-white hover:bg-neutral-600" : "bg-red-500 text-white hover:bg-red-400"
                }`}
              >
                {previewMicOn ? (
                  <IconMicrophone className="h-5 w-5" />
                ) : (
                  <IconMicrophoneOff className="h-5 w-5" />
                )}
              </button>
            </div>
            {!previewStream && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-xs text-neutral-500">Camera unavailable</p>
              </div>
            )}
          </div>

          {/* Join form */}
          <div className="w-full max-w-sm space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                Your name
              </label>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && joinMeeting()}
                placeholder="Enter your full name"
                autoFocus
                className="w-full rounded-xl border border-neutral-700 bg-neutral-800/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
              />
            </div>
            <button
              onClick={() => {
                // Carry preview cam/mic state into the meeting
                setMicOn(previewMicOn);
                setCamOn(previewCamOn);
                joinMeeting();
              }}
              disabled={!guestName.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-cyan-600/20 transition hover:bg-cyan-500 disabled:opacity-40"
            >
              <IconVideo className="h-4 w-4" />
              Join Meeting
            </button>
          </div>

          <p className="text-center text-[10px] text-neutral-600">
            By joining, you agree to allow camera and microphone access.
            <br />
            Your session is encrypted and private.
          </p>
        </div>
      </div>
    );
  }

  // --- Meeting room ---
  const peerList = Object.entries(peers);
  const totalParticipants = peerList.length + 1;

  // Determine who is screen sharing
  const remoteShares = peerList.filter(([_, p]) => p.isSharing);
  const hasLocalShare = sharing;
  const hasShares = remoteShares.length > 0 || hasLocalShare;

  const allShares: { id: string; name: string; stream: MediaStream | null }[] = [];
  if (hasLocalShare) {
    allShares.push({
      id: guestId,
      name: "You",
      stream: screenStreamRef.current ?? localStreamRef.current,
    });
  }
  remoteShares.forEach(([id, p]) => {
    allShares.push({ id, name: p.name, stream: p.stream });
  });

  const activeShare = allShares.find((s) => s.id === activeShareId) ?? allShares[0];

  const thumbCols =
    totalParticipants <= 2
      ? "grid-cols-2"
      : totalParticipants <= 4
      ? "grid-cols-2 sm:grid-cols-4"
      : totalParticipants <= 6
      ? "grid-cols-3 sm:grid-cols-6"
      : "grid-cols-4 sm:grid-cols-7";

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

      {/* Video area — Google Meet style */}
      {hasShares && activeShare ? (
        <div className="flex flex-1 flex-col overflow-hidden p-2 sm:p-3">
          {/* Share tabs (only if more than one share) */}
          {allShares.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {allShares.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveShareId(s.id)}
                  className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition ${
                    activeShare.id === s.id
                      ? "bg-cyan-600 text-white"
                      : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                  }`}
                >
                  <IconScreenShare className="h-3.5 w-3.5" />
                  {s.name}
                </button>
              ))}
            </div>
          )}

          {/* Center: large screen share */}
          <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
            {activeShare.id === guestId ? (
              <video
                ref={(el) => {
                  localVideoRef.current = el;
                  if (el && screenStreamRef.current) {
                    const screenTrack = screenStreamRef.current.getVideoTracks()[0];
                    if (screenTrack && !(el.srcObject as MediaStream)?.getVideoTracks().includes(screenTrack)) {
                      el.srcObject = new MediaStream([
                        screenTrack,
                        ...(localStreamRef.current?.getAudioTracks() ?? [])
                      ]);
                    }
                  }
                }}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-contain"
              />
            ) : (
              <GuestShareVideo stream={activeShare.stream} />
            )}
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5">
              <IconScreenShare className="h-4 w-4 text-cyan-400" />
              <span className="text-xs font-medium text-white">
                {activeShare.name} is presenting
              </span>
            </div>
          </div>

          {/* Bottom: participant thumbnails — horizontal scroll strip */}
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
            <div className="shrink-0">
              <GuestParticipantThumb
                videoRef={localVideoRef}
                camOn={camOn}
                micOn={micOn}
                name={`You${sharing ? " · presenting" : ""}`}
                initials={guestName?.[0]?.toUpperCase() ?? "?"}
                stream={localStreamRef.current}
                highlight={sharing}
              />
            </div>
            {peerList
              .filter(([id]) => id !== activeShare?.id)
              .map(([id, peer]) => (
                <div key={id} className="shrink-0">
                  <GuestRemoteThumb peer={peer} />
                </div>
              ))}
          </div>
        </div>
      ) : (
        /* Grid layout when no screen share — Google Meet style centered grid */
        <div className={`grid flex-1 content-center items-center gap-2 overflow-y-auto p-2 sm:gap-3 sm:p-4 md:p-6 ${gridCols}`}>
          {/* Local video tile */}
          <div className="relative aspect-video min-h-36 overflow-hidden rounded-xl bg-neutral-800 sm:min-h-40 md:min-h-48">
            <video
              ref={(el) => {
                localVideoRef.current = el;
                if (el && localStreamRef.current && el.srcObject !== localStreamRef.current) {
                  el.srcObject = localStreamRef.current;
                }
              }}
              autoPlay
              muted
              playsInline
              className={`h-full w-full object-cover ${camOn ? "" : "opacity-0"}`}
            />
            {!camOn && (
              <div className="absolute inset-0 flex h-full w-full items-center justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-600 text-lg font-bold text-white sm:h-16 sm:w-16 sm:text-xl md:h-20 md:w-20">
                  {guestName?.[0]?.toUpperCase()}
                </div>
              </div>
            )}
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 sm:left-3">
              {!micOn && <IconMicrophoneOff className="h-3.5 w-3.5 text-red-400" />}
              <span className="text-xs font-medium text-white">
                You (Guest) {sharing && "· presenting"}
              </span>
            </div>
          </div>

          {/* Remote video tiles */}
          {peerList.map(([id, peer]) => (
            <GuestRemoteVideo key={id} peer={peer} />
          ))}
        </div>
      )}

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
    <div className="relative aspect-video min-h-36 overflow-hidden rounded-xl bg-neutral-800 sm:min-h-40 md:min-h-48">
      <video
        ref={ref}
        autoPlay
        playsInline
        className={`h-full w-full object-cover ${hasVideo ? "" : "opacity-0"}`}
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex h-full w-full items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-600 text-lg font-bold text-white sm:h-16 sm:w-16 sm:text-xl md:h-20 md:w-20">
            {initials}
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 sm:left-3">
        <span className="text-xs font-medium text-white">
          {peer.name}{peer.isSharing ? " · presenting" : ""}
        </span>
      </div>
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

function GuestShareVideo({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || !stream) return;
    video.srcObject = stream;
  }, [stream]);

  if (!stream) return null;
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      className="h-full w-full object-contain"
    />
  );
}

function GuestParticipantThumb({
  videoRef,
  camOn,
  micOn,
  name,
  initials,
  stream,
  highlight,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  camOn: boolean;
  micOn: boolean;
  name: string;
  initials: string;
  stream: MediaStream | null;
  highlight?: boolean;
}) {
  return (
    <div className={`relative h-24 w-40 overflow-hidden rounded-xl bg-neutral-800 sm:h-28 sm:w-48 ${highlight ? "ring-2 ring-cyan-500" : ""}`}>
      {camOn ? (
        <video
          ref={(el) => {
            if (videoRef && 'current' in videoRef) {
              (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
            }
            if (el && stream && el.srcObject !== stream) {
              el.srcObject = stream;
            }
          }}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-600 text-sm font-bold text-white sm:h-12 sm:w-12">
            {initials}
          </div>
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5">
        {!micOn && <IconMicrophoneOff className="h-3 w-3 text-red-400" />}
        <span className="text-[10px] font-medium text-white sm:text-xs">{name}</span>
      </div>
    </div>
  );
}

function GuestRemoteThumb({ peer }: { peer: PeerInfo }) {
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
      setHasVideo(tracks.length > 0 && tracks.some((t) => t.enabled && t.readyState === "live" && !t.muted));
    };

    updateStream();
    const interval = setInterval(updateStream, 1000);
    peer.stream.addEventListener("addtrack", updateStream);
    peer.stream.addEventListener("removetrack", updateStream);

    // Instant cam-off detection
    peer.stream.getVideoTracks().forEach((t) => {
      t.onmute = () => setHasVideo(false);
      t.onunmute = () => setHasVideo(true);
    });

    return () => {
      clearInterval(interval);
      peer.stream.removeEventListener("addtrack", updateStream);
      peer.stream.removeEventListener("removetrack", updateStream);
      peer.stream.getVideoTracks().forEach((t) => { t.onmute = null; t.onunmute = null; });
    };
  }, [peer.stream]);

  const initials = peer.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className={`relative h-24 w-40 overflow-hidden rounded-xl bg-neutral-800 sm:h-28 sm:w-48 ${peer.isSharing ? "ring-2 ring-cyan-500" : ""}`}>
      <video
        ref={ref}
        autoPlay
        playsInline
        className={`h-full w-full object-cover ${hasVideo ? "" : "opacity-0"}`}
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex h-full w-full items-center justify-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-600 text-sm font-bold text-white sm:h-12 sm:w-12">
            {initials}
          </div>
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5">
        <span className="text-[10px] font-medium text-white sm:text-xs">
          {peer.name}{peer.isSharing ? " · presenting" : ""}
        </span>
      </div>
    </div>
  );
}
