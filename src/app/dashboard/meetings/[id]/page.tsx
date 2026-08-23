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
  IconDotsVertical,
  IconUsers,
} from "@tabler/icons-react";

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

type PeerInfo = {
  pc: RTCPeerConnection;
  stream: MediaStream;
  name: string;
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

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<Record<string, PeerInfo>>({});
  const signalChannelRef = useRef<RealtimeChannel | null>(null);

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
      if (peersRef.current[remoteId]) return peersRef.current[remoteId].pc;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      const remoteStream = new MediaStream();
      peersRef.current[remoteId] = { pc, stream: remoteStream, name: remoteName };
      updatePeers();

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      pc.ontrack = (e) => {
        e.streams[0]?.getTracks().forEach((t) => {
          if (!remoteStream.getTracks().some((rt) => rt.id === t.id)) {
            remoteStream.addTrack(t);
          }
        });
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
        if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
          delete peersRef.current[remoteId];
          updatePeers();
        }
      };

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
                fromName: `${profile.first_name} ${profile.last_name}`,
                to: remoteId,
                kind: "offer",
                data: pc.localDescription,
              },
            });
          } catch {}
        };
      }

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
          video: true,
          audio: true,
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch {
        setMediaError("Could not access camera/microphone. Check permissions.");
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
          // A new peer joined: existing members initiate offers to them
          if (payload.id !== myId) {
            createPeer(payload.id, payload.name, true);
          }
        })
        .on("broadcast", { event: "leave" }, ({ payload }) => {
          const p = peersRef.current[payload.id];
          if (p) {
            p.pc.close();
            delete peersRef.current[payload.id];
            updatePeers();
          }
        })
        .on("broadcast", { event: "signal" }, async ({ payload }) => {
          if (payload.to !== myId) return;
          const { from, fromName, kind, data } = payload;

          if (kind === "offer") {
            const pc = createPeer(from, fromName ?? "Peer", false);
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
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
            }
          } else if (kind === "ice") {
            const p = peersRef.current[from];
            if (p) {
              try {
                await p.pc.addIceCandidate(new RTCIceCandidate(data));
              } catch {}
            }
          }
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            channel.send({
              type: "broadcast",
              event: "join",
              payload: {
                id: myId,
                name: `${profile.first_name} ${profile.last_name}`,
              },
            });
            setJoined(true);
          }
        });
    };

    join();

    return () => {
      cancelled = true;
      signalChannelRef.current?.send({
        type: "broadcast",
        event: "leave",
        payload: { id: myId },
      });
      Object.values(peersRef.current).forEach((p) => p.pc.close());
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
    if (endForAll && meeting?.created_by === myId) {
      await supabase
        .from("meetings")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", meetingId);
    }
    router.push("/dashboard/meetings");
  };

  const invite = async (userId: string) => {
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
  };

  if (meeting?.status === "ended") {
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
      <div className={`grid flex-1 gap-3 overflow-y-auto p-3 md:p-4 ${gridCols}`}>
        {/* Local video tile */}
        <div className="relative min-h-48 overflow-hidden rounded-2xl bg-neutral-800 md:min-h-56">
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
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-cyan-600 text-xl font-bold text-white md:h-20 md:w-20">
                {profile.first_name?.[0]}
                {profile.last_name?.[0]}
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-2 left-3 flex items-center gap-2">
            {!micOn && (
              <IconMicrophoneOff className="h-3.5 w-3.5 text-red-400" />
            )}
            <span className="text-xs font-medium text-white">
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
      <div className="flex items-center justify-center gap-2 px-4 py-4 md:gap-3">
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
        <button
          className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-800 text-neutral-300 hover:bg-neutral-700 md:hidden"
          title="More"
        >
          <IconDotsVertical className="h-5 w-5" />
        </button>
        <div className="mx-1 h-8 w-px bg-neutral-700 md:mx-2" />
        <button
          onClick={() => leaveMeeting(meeting?.created_by === myId)}
          className="flex items-center gap-2 rounded-full bg-red-600 px-5 py-3 text-white transition hover:bg-red-500"
          title={meeting?.created_by === myId ? "End meeting for all" : "Leave meeting"}
        >
          <IconPhoneOff className="h-5 w-5" />
          <span className="hidden text-sm font-medium sm:inline">
            {meeting?.created_by === myId ? "End" : "Leave"}
          </span>
        </button>
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
            <div className="mt-4 flex max-h-64 flex-col gap-1 overflow-y-auto">
              {members
                .filter((m) => m.id !== myId && m.status === "approved")
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={() => invite(m.id)}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-600 text-[10px] font-bold text-white">
                      {m.first_name?.[0]}
                      {m.last_name?.[0]}
                    </span>
                    <span className="flex-1">
                      {m.first_name} {m.last_name}
                    </span>
                    <span className="text-xs font-medium text-cyan-500">Invite</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RemoteVideo({ peer }: { peer: PeerInfo }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(true);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = peer.stream;
    const checkVideo = () => {
      const tracks = peer.stream.getVideoTracks();
      setHasVideo(tracks.length > 0 && tracks[0].enabled && tracks[0].readyState === "live");
    };
    checkVideo();
    const interval = setInterval(checkVideo, 1000);
    return () => clearInterval(interval);
  }, [peer.stream]);

  const initials = peer.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative min-h-48 overflow-hidden rounded-2xl bg-neutral-800 md:min-h-56">
      {hasVideo ? (
        <video ref={ref} autoPlay playsInline className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-600 text-xl font-bold text-white md:h-20 md:w-20">
            {initials}
          </div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
      <span className="absolute bottom-2 left-3 text-xs font-medium text-white">
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
      className={`flex h-12 w-12 items-center justify-center rounded-full transition md:h-14 md:w-14 ${
        on
          ? "bg-neutral-800 text-white hover:bg-neutral-700"
          : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
      }`}
    >
      {on ? onIcon : offIcon}
    </button>
  );
}
