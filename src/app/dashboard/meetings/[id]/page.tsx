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

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<Record<string, PeerInfo>>({});
  const signalChannelRef = useRef<RealtimeChannel | null>(null);
  const pendingIceRef = useRef<Record<string, RTCIceCandidate[]>>({});
  const cleanupRef = useRef<(() => void) | null>(null);

  const myId = profile.id;

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
      // If peer already exists, return it — do NOT close and recreate.
      const existing = peersRef.current[remoteId];
      if (existing) {
        console.log(`[WebRTC] Peer ${remoteId} already exists, returning existing`);
        return existing.pc;
      }

      console.log(`[WebRTC] Creating peer ${remoteId} as ${initiator ? "initiator" : "receiver"}`);

      const pc = new RTCPeerConnection(ICE_SERVERS);
      const remoteStream = new MediaStream();
      peersRef.current[remoteId] = { pc, stream: remoteStream, name: remoteName, lastPing: Date.now() };
      pendingIceRef.current[remoteId] = [];
      updatePeers();

      // Set negotiation handler BEFORE adding tracks — on fast PCs the event
      // can fire before the handler is set if we add tracks first.
      if (initiator) {
        pc.onnegotiationneeded = async () => {
          try {
            console.log(`[WebRTC] Negotiation needed for ${remoteId}, creating offer...`);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            console.log(`[WebRTC] Sending offer to ${remoteId}`);
            signalChannelRef.current?.send({
              type: "broadcast",
              event: "signal",
              payload: {
                from: myId,
                fromName: `${profile.first_name} ${profile.last_name}`,
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

      // Add local tracks AFTER negotiation handler is set
      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      // Use e.streams[0] when available (most browsers) — this gives us a
      // proper MediaStream from the browser. Fall back to adding e.track to
      // our manually created stream for browsers where e.streams[0] is undefined.
      pc.ontrack = (e) => {
        console.log(`[WebRTC] ontrack fired for ${remoteId}, streams:`, e.streams?.length, "track:", e.track?.kind);
        if (e.streams && e.streams[0]) {
          // Create a NEW peer object with the browser-provided stream so
          // React detects the change and RemoteVideo re-renders.
          const oldPeer = peersRef.current[remoteId];
          peersRef.current[remoteId] = {
            pc,
            stream: e.streams[0],
            name: oldPeer?.name ?? remoteName,
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
              from: myId,
              to: remoteId,
              kind: "ice",
              data: e.candidate,
            },
          });
        } else {
          console.log(`[WebRTC] ICE gathering complete for ${remoteId}`);
        }
      };

      // Never delete peers on connection state changes — only on explicit "leave"
      // broadcast or heartbeat timeout. This prevents auto-kicking when mobile
      // browsers suspend the page or on brief network blips.
      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Connection state for ${remoteId}: ${pc.connectionState}`);
        if (pc.connectionState === "failed") {
          pc.restartIce();
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[WebRTC] ICE connection state for ${remoteId}: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === "failed") {
          pc.restartIce();
        }
      };

      return pc;
    },
    [myId, profile.first_name, profile.last_name]
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
          console.log(`[Signal] Received join from ${payload.id}, myId=${myId}, shouldInitiate=${myId < payload.id}`);
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
            updatePeers();
          }
        })
        .on("broadcast", { event: "ping" }, ({ payload }) => {
          if (payload.id !== myId) {
            const p = peersRef.current[payload.id];
            if (p) {
              p.lastPing = Date.now();
            } else if (myId < payload.id) {
              console.log(`[Signal] Discovered new peer via ping: ${payload.id}`);
              createPeer(payload.id, payload.name, true);
            }
          }
        })
        .on("broadcast", { event: "signal" }, async ({ payload }) => {
          if (payload.to !== myId) return;
          const { from, fromName, kind, data } = payload;
          console.log(`[Signal] Received ${kind} from ${from}`);

          if (kind === "offer") {
            const pc = createPeer(from, fromName ?? "Peer", false);
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            // Flush any ICE candidates that arrived before the offer
            const buffered = pendingIceRef.current[from] || [];
            for (const candidate of buffered) {
              try { await pc.addIceCandidate(candidate); } catch {}
            }
            pendingIceRef.current[from] = [];
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log(`[Signal] Sending answer to ${from}`);
            channel.send({
              type: "broadcast",
              event: "signal",
              payload: {
                from: myId,
                fromName: `${profile.first_name} ${profile.last_name}`,
                to: from,
                kind: "answer",
                data: pc.localDescription,
              },
            });
          } else if (kind === "answer") {
            const p = peersRef.current[from];
            if (p && !p.pc.currentRemoteDescription) {
              await p.pc.setRemoteDescription(new RTCSessionDescription(data));
              // Flush buffered ICE candidates
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
              // Buffer the candidate — peer may not exist yet or remote
              // description may not be set. This fixes the 3rd-person issue
              // where ICE candidates arrive before the offer/answer.
              if (!pendingIceRef.current[from]) pendingIceRef.current[from] = [];
              pendingIceRef.current[from].push(new RTCIceCandidate(data));
            }
          }
        })
        .subscribe((status) => {
          console.log(`[Signal] Channel subscription status: ${status}`);
          if (status === "SUBSCRIBED") {
            // Send join immediately
            channel.send({
              type: "broadcast",
              event: "join",
              payload: {
                id: myId,
                name: `${profile.first_name} ${profile.last_name}`,
              },
            });
            // Also send a ping immediately so late-joining peers discover us
            channel.send({
              type: "broadcast",
              event: "ping",
              payload: {
                id: myId,
                name: `${profile.first_name} ${profile.last_name}`,
              },
            });
            setJoined(true);
          }
        });

      // Heartbeat: ping every 15s so others know we're alive
      const heartbeat = setInterval(() => {
        channel.send({
          type: "broadcast",
          event: "ping",
          payload: {
            id: myId,
            name: `${profile.first_name} ${profile.last_name}`,
          },
        });
      }, 15000);

      // Stale check: remove peers we haven't heard from in 45s
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

      // Subscribe to meeting status changes (ended by host)
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

  const leaveMeeting = async (endForAll: boolean) => {
    // Send leave broadcast so others remove our video
    signalChannelRef.current?.send({
      type: "broadcast",
      event: "leave",
      payload: { id: myId },
    });
    // Close all peers and stop tracks
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
    // Check cooldown
    const lastInvite = invitedUsers[userId];
    if (lastInvite && Date.now() - lastInvite < 10000) return;

    await supabase.from("meeting_participants").upsert(
      { meeting_id: meetingId, user_id: userId, invited: true },
      { onConflict: "meeting_id,user_id" }
    );
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "meeting_invite",
      title: "📞 Meeting invitation",
      body: `${profile.first_name} invited you to "${meeting?.title}"`,
      link: `/dashboard/meetings/${meetingId}`,
    });

    // Set cooldown
    setInvitedUsers((prev) => ({ ...prev, [userId]: Date.now() }));
  };

  const getInviteCooldown = (userId: string): number => {
    const last = invitedUsers[userId];
    if (!last) return 0;
    const remaining = Math.ceil((10000 - (Date.now() - last)) / 1000);
    return remaining > 0 ? remaining : 0;
  };

  const guestLinkBase = typeof window !== "undefined" ? `${window.location.origin}/join/${meetingId}` : "";
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
    <div className="flex flex-1 flex-col overflow-hidden bg-neutral-950">
      {/* Top bar — Google Meet style */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${joined ? "bg-red-500 animate-pulse" : "bg-amber-500"}`} />
            <span className="text-sm font-medium text-white">
              {joined ? formatElapsed(elapsed) : "Connecting…"}
            </span>
          </div>
          <span className="text-neutral-600">|</span>
          <h1 className="truncate text-sm text-neutral-300">
            {meeting?.title ?? "Meeting"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            <IconUserPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Invite</span>
          </button>
          <div className="flex items-center gap-1.5 rounded-lg bg-neutral-800/60 px-3 py-2 text-sm text-neutral-300">
            <IconUsers className="h-4 w-4" />
            {totalParticipants}
          </div>
        </div>
      </div>

      {mediaError && (
        <div className="mx-4 mb-2 rounded-lg bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-400">
          {mediaError}
        </div>
      )}

      {/* Video grid — Google Meet style tiles */}
      <div className={`grid flex-1 gap-2 overflow-y-auto p-2 sm:gap-3 sm:p-3 md:p-4 ${gridCols}`}>
        {/* Local video tile */}
        <div className="relative min-h-36 overflow-hidden rounded-2xl bg-neutral-800 sm:min-h-48 md:min-h-56">
          {camOn ? (
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-600 text-base font-bold text-white sm:h-16 sm:w-16 sm:text-xl md:h-20 md:w-20">
                {profile.first_name?.[0]}
                {profile.last_name?.[0]}
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent sm:h-16" />
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 sm:left-3 sm:gap-2">
            {!micOn && (
              <IconMicrophoneOff className="h-3 w-3 text-red-400 sm:h-3.5 sm:w-3.5" />
            )}
            <span className="text-[10px] font-medium text-white sm:text-xs">
              You {sharing && "· sharing"}
            </span>
          </div>
        </div>

        {/* Remote video tiles */}
        {peerList.map(([id, peer]) => (
          <RemoteVideo key={id} peer={peer} />
        ))}
      </div>

      {/* Bottom control bar — Google Meet style */}
      <div className="flex items-center justify-center gap-1.5 px-2 py-3 sm:gap-2 sm:px-4 sm:py-4 md:gap-3">
        <MeetControlButton
          on={micOn}
          onClick={toggleMic}
          onIcon={<IconMicrophone className="h-5 w-5" />}
          offIcon={<IconMicrophoneOff className="h-5 w-5" />}
          label={micOn ? "Mute" : "Unmute"}
        />
        <MeetControlButton
          on={camOn}
          onClick={toggleCam}
          onIcon={<IconVideo className="h-5 w-5" />}
          offIcon={<IconVideoOff className="h-5 w-5" />}
          label={camOn ? "Camera off" : "Camera on"}
        />
        <MeetControlButton
          on={!sharing}
          onClick={toggleScreenShare}
          onIcon={<IconScreenShare className="h-5 w-5" />}
          offIcon={<IconScreenShareOff className="h-5 w-5" />}
          label={sharing ? "Stop sharing" : "Share screen"}
        />
        <div className="mx-1 h-8 w-px bg-neutral-700 sm:mx-2" />
        {meeting?.created_by === myId ? (
          <>
            <button
              onClick={() => leaveMeeting(false)}
              className="flex items-center gap-2 rounded-full bg-neutral-800 px-4 py-3 text-white transition hover:bg-neutral-700 sm:px-5"
              title="Leave meeting"
            >
              <IconPhoneOff className="h-5 w-5" />
              <span className="hidden text-sm font-medium sm:inline">Leave</span>
            </button>
            <button
              onClick={() => setShowEndConfirm(true)}
              className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-3 text-white transition hover:bg-red-500 sm:px-5"
              title="End meeting for all"
            >
              <span className="text-sm font-medium">End all</span>
            </button>
          </>
        ) : (
          <button
            onClick={() => leaveMeeting(false)}
            className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-3 text-white transition hover:bg-red-500 sm:px-5"
            title="Leave meeting"
          >
            <IconPhoneOff className="h-5 w-5" />
            <span className="hidden text-sm font-medium sm:inline">Leave</span>
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

            {/* Guest link section */}
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

            {/* Team members section */}
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

function RemoteVideo({ peer }: { peer: PeerInfo }) {
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

    // Poll for track changes (covers addtrack/removetrack that might not fire)
    const interval = setInterval(updateStream, 500);

    // Also listen for track events on the stream
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
      <video
        ref={ref}
        autoPlay
        playsInline
        className={`h-full w-full object-cover ${hasVideo ? "" : "opacity-0"}`}
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex h-full w-full items-center justify-center">
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
