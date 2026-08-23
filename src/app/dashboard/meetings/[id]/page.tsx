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

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<Record<string, PeerInfo>>({});
  const signalChannelRef = useRef<RealtimeChannel | null>(null);

  const myId = profile.id;

  const updatePeers = () => setPeers({ ...peersRef.current });

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
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-500">
        <p className="text-lg font-semibold">This meeting has ended.</p>
        <button
          onClick={() => router.push("/dashboard/meetings")}
          className="rounded-md bg-cyan-600 px-4 py-2 text-sm text-white"
        >
          Back to meetings
        </button>
      </div>
    );
  }

  const peerList = Object.entries(peers);
  const gridCols =
    peerList.length === 0
      ? "grid-cols-1"
      : peerList.length <= 1
      ? "grid-cols-1 md:grid-cols-2"
      : peerList.length <= 3
      ? "grid-cols-2"
      : "grid-cols-2 md:grid-cols-3";

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 p-3">
        <h1 className="truncate font-semibold text-white">
          {meeting?.title ?? "Meeting"}{" "}
          <span className="ml-2 rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
            {joined ? "LIVE" : "Connecting…"}
          </span>
        </h1>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
        >
          <IconUserPlus className="h-4 w-4" /> Invite
        </button>
      </div>

      {mediaError && (
        <p className="bg-amber-500/10 p-2 text-center text-xs text-amber-500">
          {mediaError}
        </p>
      )}

      <div className={`grid flex-1 gap-2 overflow-y-auto p-2 ${gridCols}`}>
        <div className="relative min-h-40 overflow-hidden rounded-xl bg-neutral-900">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
          />
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
            You {sharing && "(sharing screen)"}
          </span>
        </div>
        {peerList.map(([id, peer]) => (
          <RemoteVideo key={id} peer={peer} />
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 border-t border-neutral-800 p-4">
        <ControlButton
          on={micOn}
          onClick={toggleMic}
          onIcon={<IconMicrophone className="h-5 w-5" />}
          offIcon={<IconMicrophoneOff className="h-5 w-5" />}
          label={micOn ? "Mute" : "Unmute"}
        />
        <ControlButton
          on={camOn}
          onClick={toggleCam}
          onIcon={<IconVideo className="h-5 w-5" />}
          offIcon={<IconVideoOff className="h-5 w-5" />}
          label={camOn ? "Camera off" : "Camera on"}
        />
        <ControlButton
          on={!sharing}
          onClick={toggleScreenShare}
          onIcon={<IconScreenShare className="h-5 w-5" />}
          offIcon={<IconScreenShareOff className="h-5 w-5" />}
          label={sharing ? "Stop sharing" : "Share screen"}
        />
        <button
          onClick={() => leaveMeeting(meeting?.created_by === myId)}
          className="flex items-center gap-2 rounded-full bg-red-600 px-5 py-3 text-white hover:bg-red-500"
          title={meeting?.created_by === myId ? "End meeting for all" : "Leave"}
        >
          <IconPhoneOff className="h-5 w-5" />
          <span className="hidden text-sm sm:inline">
            {meeting?.created_by === myId ? "End" : "Leave"}
          </span>
        </button>
      </div>

      {showInvite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowInvite(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-neutral-900 p-4"
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
            <p className="mt-1 text-xs text-neutral-500">
              Only invited people get notified and can join. Everyone else just
              sees that this meeting is being held.
            </p>
            <div className="mt-4 flex max-h-64 flex-col gap-1 overflow-y-auto">
              {members
                .filter((m) => m.id !== myId && m.status === "approved")
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={() => invite(m.id)}
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-600 text-[10px] font-bold text-white">
                      {m.first_name?.[0]}
                      {m.last_name?.[0]}
                    </span>
                    {m.first_name} {m.last_name}
                    <span className="ml-auto text-xs text-cyan-500">Invite</span>
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
  useEffect(() => {
    if (ref.current) ref.current.srcObject = peer.stream;
  }, [peer.stream]);
  return (
    <div className="relative min-h-40 overflow-hidden rounded-xl bg-neutral-900">
      <video ref={ref} autoPlay playsInline className="h-full w-full object-cover" />
      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        {peer.name}
      </span>
    </div>
  );
}

function ControlButton({
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
      className={`rounded-full p-3 transition ${
        on
          ? "bg-neutral-800 text-white hover:bg-neutral-700"
          : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
      }`}
    >
      {on ? onIcon : offIcon}
    </button>
  );
}
