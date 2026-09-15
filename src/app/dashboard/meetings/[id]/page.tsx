"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApp } from "@/components/providers/app-provider";
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
  IconUserPlus,
  IconX,
  IconUsers,
  IconCopy,
  IconCheck,
  IconLink,
  IconSettings,
  IconCamera,
  IconVolume,
  IconHandStop,
  IconMessageDots,
  IconMaximize,
  IconMinimize,
  IconPin,
  IconSend,
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
  handRaised?: boolean;
};

type MeetingChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
};

// Hook for active speaking detection using WebAudio Analyser
function useAudioLevel(stream: MediaStream | null, enabled: boolean = true) {
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!stream || !enabled) {
      setIsSpeaking(false);
      return;
    }
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || !audioTrack.enabled) {
      setIsSpeaking(false);
      return;
    }

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let animId: number;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContext = new AudioCtx();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkVolume = () => {
        analyser!.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        setIsSpeaking(average > 15);
        animId = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch {
      setIsSpeaking(false);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
      try { source?.disconnect(); } catch {}
      try { audioContext?.close(); } catch {}
    };
  }, [stream, enabled]);

  return isSpeaking;
}

export default function MeetingRoomPage() {
  const params = useParams<{ id: string }>();
  const meetingId = params.id;
  const router = useRouter();
  const { supabase, profile, members } = useApp();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [peers, setPeers] = useState<Record<string, PeerInfo>>({});
  const [showInvite, setShowInvite] = useState(false);
  const [joined, setJoined] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeShareId, setActiveShareId] = useState<string | null>(null);
  
  // New features state
  const [handRaised, setHandRaised] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<MeetingChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  // Device selection
  const [devices, setDevices] = useState({ video: [] as MediaDeviceInfo[], audio: [] as MediaDeviceInfo[], output: [] as MediaDeviceInfo[] });
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
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const myId = profile.id;
  const myName = `${profile.first_name} ${profile.last_name}`;

  // Audio level check for local user
  const isLocalSpeaking = useAudioLevel(localStreamRef.current, micOn);

  // Auto-scroll chat
  useEffect(() => {
    if (showChat) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setUnreadChatCount(0);
    }
  }, [chatMessages, showChat]);

  // Device enumeration and switching
  useEffect(() => {
    const enumerate = async () => {
      try {
        const deviceList = await navigator.mediaDevices.enumerateDevices();
        setDevices({
          video: deviceList.filter((d) => d.kind === "videoinput"),
          audio: deviceList.filter((d) => d.kind === "audioinput"),
          output: deviceList.filter((d) => d.kind === "audiooutput"),
        });
      } catch {}
    };
    enumerate();
    navigator.mediaDevices.addEventListener("devicechange", enumerate);
    return () => navigator.mediaDevices.removeEventListener("devicechange", enumerate);
  }, []);

  const switchVideoDevice = async (deviceId: string) => {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      Object.values(peersRef.current).forEach((p) => {
        const sender = p.pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) sender.replaceTrack(newTrack);
      });
      const videoDisplay = new MediaStream([newTrack, ...(localStreamRef.current?.getAudioTracks() ?? [])]);
      localStreamRef.current?.getVideoTracks().forEach((t) => t.stop());
      localStreamRef.current = videoDisplay;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = videoDisplay;
      }
      setSelectedVideoId(deviceId);
    } catch (e) {
      console.error("Failed to switch camera:", e);
    }
  };

  const switchAudioDevice = async (deviceId: string) => {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      const newTrack = newStream.getAudioTracks()[0];
      Object.values(peersRef.current).forEach((p) => {
        const sender = p.pc.getSenders().find((s) => s.track?.kind === "audio");
        if (sender) sender.replaceTrack(newTrack);
      });
      localStreamRef.current?.getAudioTracks().forEach((t) => t.stop());
      const videoTracks = localStreamRef.current?.getVideoTracks() ?? [];
      localStreamRef.current = new MediaStream([...videoTracks, newTrack]);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      setSelectedAudioId(deviceId);
    } catch (e) {
      console.error("Failed to switch microphone:", e);
    }
  };

  const switchOutputDevice = async (deviceId: string) => {
    try {
      const video = localVideoRef.current;
      if (video && "setSinkId" in video) {
        await (video as HTMLVideoElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(deviceId);
      }
      setSelectedOutputId(deviceId);
    } catch (e) {
      console.error("Failed to switch speaker:", e);
    }
  };

  const updatePeers = () => setPeers({ ...peersRef.current });

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
      if (existing) return existing.pc;

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
                from: myId,
                fromName: myName,
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
            name: oldPeer?.name ?? remoteName,
            lastPing: oldPeer?.lastPing ?? Date.now(),
            isSharing: oldPeer?.isSharing,
            handRaised: oldPeer?.handRaised,
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
              from: myId,
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
    [myId, myName]
  );

  useEffect(() => {
    let cancelled = false;

    const join = async () => {
      const { data: mtg } = await supabase
        .from("meetings")
        .select("*")
        .eq("id", meetingId)
        .single();
      if (!mtg || cancelled) return;
      setMeeting(mtg as Meeting);
      if (mtg.status === "ended") return;

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

      await supabase.from("meeting_participants").upsert(
        {
          meeting_id: meetingId,
          user_id: myId,
          invited: false,
          joined_at: new Date().toISOString(),
        },
        { onConflict: "meeting_id,user_id" }
      );

      const channel = supabase.channel(`meeting-${meetingId}`, {
        config: { broadcast: { self: false } },
      });
      signalChannelRef.current = channel;

      channel
        .on("broadcast", { event: "join" }, ({ payload }) => {
          if (payload.id !== myId && myId < payload.id) {
            createPeer(payload.id, payload.name, true);
          }
        })
        .on("broadcast", { event: "leave" }, ({ payload }) => {
          if (payload.id === myId) return;
          const p = peersRef.current[payload.id];
          if (p) {
            try { p.pc.close(); } catch {}
            delete peersRef.current[payload.id];
            delete pendingIceRef.current[payload.id];
            if (activeShareId === payload.id) setActiveShareId(null);
            if (pinnedId === payload.id) setPinnedId(null);
            updatePeers();
          }
        })
        .on("broadcast", { event: "share" }, ({ payload }) => {
          if (payload.id === myId) return;
          const p = peersRef.current[payload.id];
          if (p) {
            p.isSharing = true;
            updatePeers();
            setActiveShareId((cur) => cur ?? payload.id);
          }
        })
        .on("broadcast", { event: "unshare" }, ({ payload }) => {
          if (payload.id === myId) return;
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
        .on("broadcast", { event: "hand" }, ({ payload }) => {
          if (payload.id === myId) return;
          const p = peersRef.current[payload.id];
          if (p) {
            p.handRaised = payload.handRaised;
            updatePeers();
          }
        })
        .on("broadcast", { event: "chat" }, ({ payload }) => {
          const msg = payload as MeetingChatMessage;
          setChatMessages((prev) => [...prev, msg]);
          setShowChat((showing) => {
            if (!showing) setUnreadChatCount((count) => count + 1);
            return showing;
          });
        })
        .on("broadcast", { event: "ping" }, ({ payload }) => {
          if (payload.id !== myId) {
            const p = peersRef.current[payload.id];
            if (p) {
              p.lastPing = Date.now();
            } else if (myId < payload.id) {
              createPeer(payload.id, payload.name, true);
            }
          }
        })
        .on("broadcast", { event: "signal" }, async ({ payload }) => {
          if (payload.to !== myId) return;
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
                from: myId,
                fromName: myName,
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
            channel.send({
              type: "broadcast",
              event: "join",
              payload: { id: myId, name: myName },
            });
            channel.send({
              type: "broadcast",
              event: "ping",
              payload: { id: myId, name: myName },
            });
            setJoined(true);
          }
        });

      const heartbeat = setInterval(() => {
        channel.send({
          type: "broadcast",
          event: "ping",
          payload: { id: myId, name: myName },
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
            if (pinnedId === id) setPinnedId(null);
            changed = true;
          }
        }
        if (changed) updatePeers();
      }, 20000);

      const meetingChannel = supabase
        .channel(`meeting-status-${meetingId}`)
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
        clearInterval(heartbeat);
        clearInterval(staleCheck);
        supabase.removeChannel(meetingChannel);
      };
    };

    join().then((cleanup) => {
      if (cleanup) cleanupRef.current = cleanup;
    });

    return () => {
      cancelled = true;
      if (cleanupRef.current) cleanupRef.current();
      signalChannelRef.current?.send({
        type: "broadcast",
        event: "leave",
        payload: { id: myId },
      });
      Object.values(peersRef.current).forEach((p) => { try { p.pc.close(); } catch {} });
      peersRef.current = {};
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (signalChannelRef.current) supabase.removeChannel(signalChannelRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

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
      const displayStream = new MediaStream([
        newTrack,
        ...(localStreamRef.current?.getAudioTracks() ?? []),
      ]);
      localVideoRef.current.srcObject = displayStream;
    }
  };

  const toggleScreenShare = async () => {
    if (sharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) await replaceVideoTrack(camTrack);
      setSharing(false);
      signalChannelRef.current?.send({
        type: "broadcast",
        event: "unshare",
        payload: { id: myId },
      });
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screen;
        const screenTrack = screen.getVideoTracks()[0];
        screenTrack.onended = async () => {
          const camTrack = localStreamRef.current?.getVideoTracks()[0];
          if (camTrack) await replaceVideoTrack(camTrack);
          setSharing(false);
          signalChannelRef.current?.send({
            type: "broadcast",
            event: "unshare",
            payload: { id: myId },
          });
        };
        await replaceVideoTrack(screenTrack);
        setSharing(true);
        signalChannelRef.current?.send({
          type: "broadcast",
          event: "share",
          payload: { id: myId },
        });
      } catch {}
    }
  };

  const toggleHandRaise = () => {
    const nextState = !handRaised;
    setHandRaised(nextState);
    signalChannelRef.current?.send({
      type: "broadcast",
      event: "hand",
      payload: { id: myId, handRaised: nextState },
    });
  };

  const sendChatMessage = () => {
    if (!chatInput.trim()) return;
    const msg: MeetingChatMessage = {
      id: Math.random().toString(36).slice(2),
      senderId: myId,
      senderName: myName,
      text: chatInput.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setChatMessages((prev) => [...prev, msg]);
    signalChannelRef.current?.send({
      type: "broadcast",
      event: "chat",
      payload: msg,
    });
    setChatInput("");
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const leaveMeeting = async (endForAll: boolean) => {
    signalChannelRef.current?.send({
      type: "broadcast",
      event: "leave",
      payload: { id: myId },
    });
    Object.values(peersRef.current).forEach((p) => { try { p.pc.close(); } catch {} });
    peersRef.current = {};
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (cleanupRef.current) cleanupRef.current();

    if (endForAll && meeting?.created_by === myId) {
      await supabase
        .from("meetings")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", meetingId);
    }
    router.push("/dashboard/meetings");
  };

  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [invitedUsers, setInvitedUsers] = useState<Record<string, number>>({});
  const [, setTick] = useState(0);

  useEffect(() => {
    const hasActiveCooldown = Object.values(invitedUsers).some(
      (t) => Date.now() - t < 10000
    );
    if (!hasActiveCooldown) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [invitedUsers]);

  const invite = async (userId: string) => {
    const lastInvite = invitedUsers[userId];
    if (lastInvite && Date.now() - lastInvite < 10000) return;

    await supabase.from("meeting_participants").upsert(
      { meeting_id: meetingId, user_id: userId, invited: true },
      { onConflict: "meeting_id,user_id" }
    );

    await supabase.from("notifications").insert({
      user_id: userId,
      type: "meeting_invite",
      title: "📹 Meeting Call",
      body: `${profile.first_name} ${profile.last_name} is calling you to join "${meeting?.title}"`,
      link: `/dashboard/meetings/${meetingId}`,
    });

    fetch("/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        title: "📹 Meeting Call",
        body: `${profile.first_name} ${profile.last_name} is calling you to join "${meeting?.title}"`,
        url: `/dashboard/meetings/${meetingId}`,
      }),
    }).catch(() => {});

    setInvitedUsers((prev) => ({ ...prev, [userId]: Date.now() }));
  };

  const getInviteCooldown = (userId: string): number => {
    const last = invitedUsers[userId];
    if (!last) return 0;
    const remaining = Math.ceil((10000 - (Date.now() - last)) / 1000);
    return remaining > 0 ? remaining : 0;
  };

  const guestLinkBase = typeof window !== "undefined"
    ? `${window.location.origin}/join/${meetingId}`
    : `https://gridandlogicdashboard.vercel.app/join/${meetingId}`;

  const copyGuestLink = async () => {
    const link = `${guestLinkBase}?t=${Date.now()}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {}
  };

  if (meetingEnded || meeting?.status === "ended") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-neutral-950 text-neutral-400">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10">
          <IconPhoneOff className="h-10 w-10 text-red-500" />
        </div>
        <p className="text-lg font-semibold text-white">This meeting has ended</p>
        <p className="text-sm text-neutral-500">The meeting was ended by the host.</p>
        <button
          onClick={() => router.push("/dashboard/meetings")}
          className="mt-2 rounded-lg bg-cyan-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-cyan-500"
        >
          Back to meetings
        </button>
      </div>
    );
  }

  const peerList = Object.entries(peers);
  const totalParticipants = peerList.length + 1;

  const remoteShares = peerList.filter(([_, p]) => p.isSharing);
  const hasLocalShare = sharing;
  const hasShares = remoteShares.length > 0 || hasLocalShare;

  const allShares: { id: string; name: string; stream: MediaStream | null }[] = [];
  if (hasLocalShare) {
    allShares.push({
      id: myId,
      name: "You",
      stream: screenStreamRef.current ?? localStreamRef.current,
    });
  }
  remoteShares.forEach(([id, p]) => {
    allShares.push({ id, name: p.name, stream: p.stream });
  });

  const activeShare = allShares.find((s) => s.id === activeShareId) ?? allShares[0];

  const gridCols =
    pinnedId
      ? "grid-cols-1"
      : totalParticipants <= 1
      ? "grid-cols-1"
      : totalParticipants <= 2
      ? "grid-cols-1 md:grid-cols-2"
      : totalParticipants <= 4
      ? "grid-cols-2"
      : totalParticipants <= 6
      ? "grid-cols-2 md:grid-cols-3"
      : "grid-cols-3 md:grid-cols-4";

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-neutral-950 text-white">
      {/* Top bar — Google Meet style */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${joined ? "bg-green-500 animate-pulse" : "bg-amber-500"}`} />
            <span className="text-sm font-medium text-white">
              {joined ? formatElapsed(elapsed) : "Connecting…"}
            </span>
          </div>
          <span className="text-neutral-700">|</span>
          <h1 className="truncate text-sm font-medium text-neutral-200">
            {meeting?.title ?? "Meeting"}
          </h1>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={toggleFullscreen}
            className="flex items-center gap-1.5 rounded-full bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
            title="Toggle fullscreen"
          >
            {isFullscreen ? <IconMinimize className="h-4 w-4" /> : <IconMaximize className="h-4 w-4" />}
            <span className="hidden sm:inline">{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</span>
          </button>

          <div className="flex items-center gap-1.5 rounded-full bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300">
            <IconUsers className="h-4 w-4" />
            <span>{totalParticipants}</span>
          </div>
        </div>
      </div>

      {mediaError && (
        <div className="mx-4 mb-2 mt-2 rounded-lg bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-400">
          {mediaError}
        </div>
      )}

      {/* Main Body with Video Stage + Slide-out In-Meeting Chat */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main Video stage */}
        <div className="flex flex-1 flex-col overflow-hidden p-2 sm:p-3">
          {hasShares && activeShare ? (
            <div className="flex flex-1 flex-col overflow-hidden">
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

              <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl bg-black">
                {activeShare.id === myId ? (
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
                  <ShareVideo stream={activeShare.stream} />
                )}
                <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 backdrop-blur-sm">
                  <IconScreenShare className="h-4 w-4 text-cyan-400" />
                  <span className="text-sm font-medium text-white">
                    {activeShare.name} is presenting
                  </span>
                </div>
              </div>

              {/* Bottom horizontal thumbnails strip */}
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
                <div className="shrink-0">
                  <ParticipantThumb
                    videoRef={localVideoRef}
                    camOn={camOn}
                    micOn={micOn}
                    name={`You${sharing ? " · presenting" : ""}`}
                    initials={`${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`}
                    stream={localStreamRef.current}
                    highlight={sharing}
                    isSpeaking={isLocalSpeaking}
                    handRaised={handRaised}
                    isPinned={pinnedId === myId}
                    onPin={() => setPinnedId(pinnedId === myId ? null : myId)}
                  />
                </div>
                {peerList
                  .filter(([id]) => id !== activeShare?.id)
                  .map(([id, peer]) => (
                    <div key={id} className="shrink-0">
                      <RemoteThumb
                        peer={peer}
                        isPinned={pinnedId === id}
                        onPin={() => setPinnedId(pinnedId === id ? null : id)}
                      />
                    </div>
                  ))}
              </div>
            </div>
          ) : pinnedId ? (
            /* Pinned Video Stage */
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl bg-black">
                {pinnedId === myId ? (
                  <div className="relative h-full w-full">
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
                      className={`h-full w-full object-contain ${camOn ? "" : "opacity-0"}`}
                    />
                    {!camOn && (
                      <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
                        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-cyan-600 text-3xl font-bold">
                          {profile.first_name?.[0]}
                          {profile.last_name?.[0]}
                        </div>
                      </div>
                    )}
                    <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium">
                      Pinned: You
                    </div>
                  </div>
                ) : (
                  <PinnedRemoteVideo peer={peers[pinnedId]} />
                )}
                <button
                  onClick={() => setPinnedId(null)}
                  className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white hover:bg-neutral-800"
                >
                  <IconPin className="h-4 w-4 text-cyan-400" /> Unpin
                </button>
              </div>

              {/* Thumbnails strip at bottom when pinned */}
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
                {pinnedId !== myId && (
                  <div className="shrink-0">
                    <ParticipantThumb
                      videoRef={localVideoRef}
                      camOn={camOn}
                      micOn={micOn}
                      name={`You${sharing ? " · presenting" : ""}`}
                      initials={`${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`}
                      stream={localStreamRef.current}
                      highlight={sharing}
                      isSpeaking={isLocalSpeaking}
                      handRaised={handRaised}
                      isPinned={false}
                      onPin={() => setPinnedId(myId)}
                    />
                  </div>
                )}
                {peerList
                  .filter(([id]) => id !== pinnedId)
                  .map(([id, peer]) => (
                    <div key={id} className="shrink-0">
                      <RemoteThumb
                        peer={peer}
                        isPinned={false}
                        onPin={() => setPinnedId(id)}
                      />
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            /* Grid layout when no screen share and no pinned video */
            <div className={`grid flex-1 content-center items-center gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-6 md:p-8 ${gridCols}`}>
              {/* Local video tile */}
              <div className={`relative aspect-video min-h-44 overflow-hidden rounded-2xl bg-neutral-800 shadow-lg sm:min-h-48 md:min-h-56 transition-all duration-300 ${
                isLocalSpeaking ? "ring-4 ring-green-500 shadow-green-500/20" : ""
              }`}>
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
                  <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-800">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-cyan-600 text-xl font-bold text-white shadow-lg sm:h-20 sm:w-20 sm:text-2xl md:h-24 md:w-24 md:text-3xl">
                      {profile.first_name?.[0]}
                      {profile.last_name?.[0]}
                    </div>
                  </div>
                )}

                {/* Badges: hand raise, mic, speaker */}
                <div className="absolute top-3 right-3 flex items-center gap-2">
                  {handRaised && (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-lg shadow-lg animate-bounce">
                      ✋
                    </span>
                  )}
                  <button
                    onClick={() => setPinnedId(myId)}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                    title="Pin video"
                  >
                    <IconPin className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-sm">
                  {!micOn && (
                    <IconMicrophoneOff className="h-4 w-4 text-red-400" />
                  )}
                  <span className="text-sm font-medium text-white">
                    You {sharing && "· presenting"}
                  </span>
                </div>
              </div>

              {/* Remote video tiles */}
              {peerList.map(([id, peer]) => (
                <RemoteVideo
                  key={id}
                  peer={peer}
                  isPinned={pinnedId === id}
                  onPin={() => setPinnedId(id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Slide-out In-Meeting Chat Drawer */}
        {showChat && (
          <div className="flex w-80 flex-col border-l border-neutral-800 bg-neutral-900/95 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <div className="flex items-center gap-2">
                <IconMessageDots className="h-5 w-5 text-cyan-400" />
                <h2 className="font-semibold text-white">In-meeting Chat</h2>
              </div>
              <button
                onClick={() => setShowChat(false)}
                className="text-neutral-400 hover:text-white"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.length === 0 ? (
                <div className="mt-12 text-center text-xs text-neutral-500">
                  No messages yet. Send a message to call participants.
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.senderId === myId ? "items-end" : "items-start"}`}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 mb-0.5">
                      <span className="font-medium text-neutral-300">{msg.senderName}</span>
                      <span>•</span>
                      <span>{msg.timestamp}</span>
                    </div>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs font-normal break-words ${
                        msg.senderId === myId
                          ? "bg-cyan-600 text-white rounded-tr-none"
                          : "bg-neutral-800 text-neutral-200 rounded-tl-none"
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
              <div ref={chatBottomRef} />
            </div>

            <div className="border-t border-neutral-800 p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendChatMessage();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim()}
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-40"
                >
                  <IconSend className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Bottom control bar — Google Meet style */}
      <div className="flex items-center justify-center gap-2 border-t border-neutral-800 bg-neutral-950 px-3 py-4 sm:gap-3 sm:px-4">
        <MeetControlButton
          on={micOn}
          onClick={toggleMic}
          onIcon={<IconMicrophone className="h-5 w-5" />}
          offIcon={<IconMicrophoneOff className="h-5 w-5" />}
          label={micOn ? "Turn off microphone" : "Turn on microphone"}
        />
        <MeetControlButton
          on={camOn}
          onClick={toggleCam}
          onIcon={<IconVideo className="h-5 w-5" />}
          offIcon={<IconVideoOff className="h-5 w-5" />}
          label={camOn ? "Turn off camera" : "Turn on camera"}
        />
        <MeetControlButton
          on={!sharing}
          onClick={toggleScreenShare}
          onIcon={<IconScreenShare className="h-5 w-5" />}
          offIcon={<IconScreenShareOff className="h-5 w-5" />}
          label={sharing ? "Stop presenting" : "Present now"}
        />

        {/* Raise Hand Button */}
        <button
          onClick={toggleHandRaise}
          title={handRaised ? "Lower hand" : "Raise hand"}
          className={`flex h-12 w-12 items-center justify-center rounded-full transition sm:h-14 sm:w-14 ${
            handRaised
              ? "bg-amber-500 text-black hover:bg-amber-400"
              : "bg-neutral-800 text-white hover:bg-neutral-700"
          }`}
        >
          <IconHandStop className="h-5 w-5" />
        </button>

        {/* In-Meeting Chat Toggle */}
        <div className="relative">
          <button
            onClick={() => {
              setShowChat(!showChat);
              setUnreadChatCount(0);
            }}
            title="In-meeting chat"
            className={`flex h-12 w-12 items-center justify-center rounded-full transition sm:h-14 sm:w-14 ${
              showChat
                ? "bg-cyan-600 text-white"
                : "bg-neutral-800 text-white hover:bg-neutral-700"
            }`}
          >
            <IconMessageDots className="h-5 w-5" />
          </button>
          {!showChat && unreadChatCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unreadChatCount}
            </span>
          )}
        </div>

        {/* Device selection menu */}
        <div className="relative">
          <button
            onClick={() => setShowDeviceMenu(!showDeviceMenu)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-800 text-white transition hover:bg-neutral-700 sm:h-14 sm:w-14"
            title="Audio & video settings"
          >
            <IconSettings className="h-5 w-5" />
          </button>
          {showDeviceMenu && (
            <div className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-xl animate-in fade-in zoom-in-95 z-50">
              <div className="space-y-4">
                {devices.video.length > 0 && (
                  <div>
                    <label className="flex items-center gap-2 mb-2 text-xs font-medium text-neutral-400">
                      <IconCamera className="h-4 w-4" />
                      Camera
                    </label>
                    <select
                      value={selectedVideoId || ""}
                      onChange={(e) => switchVideoDevice(e.target.value)}
                      className="w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                      <option value="">Default</option>
                      {devices.video.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {devices.audio.length > 0 && (
                  <div>
                    <label className="flex items-center gap-2 mb-2 text-xs font-medium text-neutral-400">
                      <IconMicrophone className="h-4 w-4" />
                      Microphone
                    </label>
                    <select
                      value={selectedAudioId || ""}
                      onChange={(e) => switchAudioDevice(e.target.value)}
                      className="w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                      <option value="">Default</option>
                      {devices.audio.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {devices.output.length > 0 && (
                  <div>
                    <label className="flex items-center gap-2 mb-2 text-xs font-medium text-neutral-400">
                      <IconVolume className="h-4 w-4" />
                      Speaker
                    </label>
                    <select
                      value={selectedOutputId || ""}
                      onChange={(e) => switchOutputDevice(e.target.value)}
                      className="w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                      <option value="">Default</option>
                      {devices.output.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Speaker ${d.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => setShowInvite(true)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-800 text-white transition hover:bg-neutral-700 sm:h-14 sm:w-14"
          title="Add people"
        >
          <IconUserPlus className="h-5 w-5" />
        </button>
        <div className="mx-1 h-8 w-px bg-neutral-700 sm:mx-2" />
        {meeting?.created_by === myId ? (
          <>
            <button
              onClick={() => leaveMeeting(false)}
              className="flex items-center gap-2 rounded-full bg-amber-500 px-5 py-3 text-black transition hover:bg-amber-400"
              title="Leave meeting"
            >
              <IconPhoneOff className="h-5 w-5" />
              <span className="hidden text-sm font-semibold sm:inline">Leave</span>
            </button>
            <button
              onClick={() => setShowEndConfirm(true)}
              className="flex items-center gap-2 rounded-full bg-red-600 px-5 py-3 text-white transition hover:bg-red-500"
              title="End meeting for all"
            >
              <span className="text-sm font-semibold">End call</span>
            </button>
          </>
        ) : (
          <button
            onClick={() => leaveMeeting(false)}
            className="flex items-center gap-2 rounded-full bg-red-600 px-5 py-3 text-white transition hover:bg-red-500"
            title="Leave meeting"
          >
            <IconPhoneOff className="h-5 w-5" />
            <span className="hidden text-sm font-semibold sm:inline">Leave</span>
          </button>
        )}
      </div>

      {showInvite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowInvite(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-neutral-700 bg-neutral-900 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">Invite people</h2>
              <button
                onClick={() => setShowInvite(false)}
                className="text-neutral-400 hover:text-red-500"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Invite teammates to this meeting. They&apos;ll get a notification.
            </p>

            <div className="mt-4 rounded-xl border border-neutral-700 bg-neutral-800/50 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-neutral-300">
                <IconLink className="h-4 w-4 text-cyan-400" />
                Invite a client (no account needed)
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  readOnly
                  value={guestLinkBase}
                  className="flex-1 truncate rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-400 outline-none"
                />
                <button
                  onClick={copyGuestLink}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-600 text-white transition hover:bg-cyan-500"
                  title="Copy link"
                >
                  {copiedLink ? (
                    <IconCheck className="h-4 w-4" />
                  ) : (
                    <IconCopy className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="mt-2 text-[10px] text-neutral-500">
                Share this link with anyone outside your team. They just enter their name to join. Link expires in 5 minutes.
              </p>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-neutral-400">Invite teammates</p>
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {members
                .filter((m) => m.id !== myId && m.status === "approved")
                .map((m) => {
                  const cooldown = getInviteCooldown(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => invite(m.id)}
                      disabled={cooldown > 0}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-600 text-[10px] font-bold text-white">
                        {m.first_name?.[0]}
                        {m.last_name?.[0]}
                      </span>
                      <span className="flex-1">
                        {m.first_name} {m.last_name}
                      </span>
                      <span className={`text-xs font-medium ${cooldown > 0 ? "text-neutral-500" : "text-cyan-500"}`}>
                        {cooldown > 0 ? `Send (${cooldown}s)` : "Invite"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {showEndConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowEndConfirm(false)}
        >
          <div
            className="w-full max-w-xs rounded-2xl border border-neutral-700 bg-neutral-900 p-5 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
              <IconPhoneOff className="h-7 w-7 text-red-500" />
            </div>
            <h2 className="mt-3 font-semibold text-white">End meeting for everyone?</h2>
            <p className="mt-1 text-xs text-neutral-500">
              All participants will be disconnected and the meeting will be marked as ended.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowEndConfirm(false)}
                className="flex-1 rounded-lg bg-neutral-800 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
              >
                Cancel
              </button>
              <button
                onClick={() => leaveMeeting(true)}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white transition hover:bg-red-500"
              >
                End all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RemoteVideo({
  peer,
  isPinned,
  onPin,
}: {
  peer: PeerInfo;
  isPinned: boolean;
  onPin: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const isSpeaking = useAudioLevel(peer.stream, true);

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
    <div className={`relative aspect-video min-h-44 overflow-hidden rounded-2xl bg-neutral-800 shadow-lg sm:min-h-48 md:min-h-56 transition-all duration-300 ${
      isSpeaking ? "ring-4 ring-green-500 shadow-green-500/20" : ""
    }`}>
      <video
        ref={ref}
        autoPlay
        playsInline
        className={`h-full w-full object-cover ${hasVideo ? "" : "opacity-0"}`}
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-800">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-cyan-600 text-xl font-bold text-white shadow-lg sm:h-20 sm:w-20 sm:text-2xl md:h-24 md:w-24 md:text-3xl">
            {initials}
          </div>
        </div>
      )}

      {/* Badges: Hand raise & Pin */}
      <div className="absolute top-3 right-3 flex items-center gap-2">
        {peer.handRaised && (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-lg shadow-lg animate-bounce">
            ✋
          </span>
        )}
        <button
          onClick={onPin}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          title={isPinned ? "Unpin video" : "Pin video"}
        >
          {isPinned ? <IconPin className="h-3.5 w-3.5 text-cyan-400" /> : <IconPin className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-sm">
        <span className="text-sm font-medium text-white">
          {peer.name}{peer.isSharing ? " · presenting" : ""}
        </span>
      </div>
    </div>
  );
}

function PinnedRemoteVideo({ peer }: { peer: PeerInfo }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video || !peer) return;
    video.srcObject = peer.stream;
    const tracks = peer.stream.getVideoTracks();
    setHasVideo(tracks.length > 0 && tracks.some((t) => t.enabled && t.readyState === "live"));
  }, [peer]);

  if (!peer) return null;

  return (
    <div className="relative h-full w-full">
      <video
        ref={ref}
        autoPlay
        playsInline
        className={`h-full w-full object-contain ${hasVideo ? "" : "opacity-0"}`}
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-cyan-600 text-3xl font-bold">
            {peer.name.slice(0, 2).toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium">
        Pinned: {peer.name}
      </div>
    </div>
  );
}

function MeetControlButton({
  on,
  onClick,
  onIcon,
  offIcon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex h-12 w-12 items-center justify-center rounded-full transition sm:h-14 sm:w-14 ${
        on
          ? "bg-neutral-800 text-white hover:bg-neutral-700"
          : "bg-red-500 text-white hover:bg-red-400"
      }`}
    >
      {on ? onIcon : offIcon}
    </button>
  );
}

function ShareVideo({ stream }: { stream: MediaStream | null }) {
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

function ParticipantThumb({
  videoRef,
  camOn,
  micOn,
  name,
  initials,
  stream,
  highlight,
  isSpeaking,
  handRaised,
  isPinned,
  onPin,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  camOn: boolean;
  micOn: boolean;
  name: string;
  initials: string;
  stream: MediaStream | null;
  highlight?: boolean;
  isSpeaking?: boolean;
  handRaised?: boolean;
  isPinned?: boolean;
  onPin?: () => void;
}) {
  return (
    <div className={`relative h-28 w-44 overflow-hidden rounded-2xl bg-neutral-800 shadow-lg sm:h-32 sm:w-52 transition-all duration-300 ${
      highlight ? "ring-2 ring-cyan-500" : isSpeaking ? "ring-4 ring-green-500" : ""
    }`}>
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
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-800">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-600 text-base font-bold text-white sm:h-14 sm:w-14 sm:text-lg">
            {initials}
          </div>
        </div>
      )}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        {handRaised && <span className="text-sm">✋</span>}
        {onPin && (
          <button
            onClick={onPin}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            {isPinned ? <IconPin className="h-3 w-3 text-cyan-400" /> : <IconPin className="h-3 w-3" />}
          </button>
        )}
      </div>
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 backdrop-blur-sm">
        {!micOn && <IconMicrophoneOff className="h-3.5 w-3.5 text-red-400" />}
        <span className="text-xs font-medium text-white">{name}</span>
      </div>
    </div>
  );
}

function RemoteThumb({
  peer,
  isPinned,
  onPin,
}: {
  peer: PeerInfo;
  isPinned?: boolean;
  onPin?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const isSpeaking = useAudioLevel(peer.stream, true);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const updateStream = () => {
      if (video.srcObject !== peer.stream) {
        video.srcObject = peer.stream;
      }
      const tracks = peer.stream.getVideoTracks();
      setHasVideo(tracks.length > 0 && tracks.some((t) => t.enabled && t.readyState === "live"));
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
    <div className={`relative h-28 w-44 overflow-hidden rounded-2xl bg-neutral-800 shadow-lg sm:h-32 sm:w-52 transition-all duration-300 ${
      peer.isSharing ? "ring-2 ring-cyan-500" : isSpeaking ? "ring-4 ring-green-500" : ""
    }`}>
      <video
        ref={ref}
        autoPlay
        playsInline
        className={`h-full w-full object-cover ${hasVideo ? "" : "opacity-0"}`}
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-800">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-600 text-base font-bold text-white sm:h-14 sm:w-14 sm:text-lg">
            {initials}
          </div>
        </div>
      )}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        {peer.handRaised && <span className="text-sm">✋</span>}
        {onPin && (
          <button
            onClick={onPin}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            {isPinned ? <IconPin className="h-3 w-3 text-cyan-400" /> : <IconPin className="h-3 w-3" />}
          </button>
        )}
      </div>
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 backdrop-blur-sm">
        <span className="text-xs font-medium text-white">
          {peer.name}{peer.isSharing ? " · presenting" : ""}
        </span>
      </div>
    </div>
  );
}
