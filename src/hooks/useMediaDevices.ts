"use client";
import { useCallback, useEffect, useRef, useState } from "react";

interface MediaDeviceInfo {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

interface UseMediaDevicesReturn {
  videoDevices: MediaDeviceInfo[];
  audioInputDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  selectedVideoDeviceId: string | null;
  selectedAudioInputDeviceId: string | null;
  selectedAudioOutputDeviceId: string | null;
  setVideoDevice: (deviceId: string) => void;
  setAudioInputDevice: (deviceId: string) => void;
  setAudioOutputDevice: (deviceId: string, stream?: MediaStream) => Promise<void>;
  requestPermissions: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function useMediaDevices(): UseMediaDevicesReturn {
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string | null>(null);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState<string | null>(null);
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const devicesRef = useRef<MediaDeviceInfo[]>([]);

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mediaDevices: MediaDeviceInfo[] = devices.map((d) => ({
        deviceId: d.deviceId,
        label: d.label || `${d.kind} ${d.deviceId.slice(0, 8)}`,
        kind: d.kind,
      }));
      devicesRef.current = mediaDevices;

      setVideoDevices(mediaDevices.filter((d) => d.kind === "videoinput"));
      setAudioInputDevices(mediaDevices.filter((d) => d.kind === "audioinput"));
      setAudioOutputDevices(mediaDevices.filter((d) => d.kind === "audiooutput"));
    } catch (err) {
      console.error("Failed to enumerate devices:", err);
      setError("Failed to enumerate media devices");
    }
  }, []);

  const requestPermissions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Request camera and mic permissions to get device labels
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      stream.getTracks().forEach((t) => t.stop());
      await enumerateDevices();
    } catch (err) {
      console.error("Permission denied:", err);
      setError("Camera/microphone permission denied");
      // Still try to enumerate (might have labels from previous permission)
      await enumerateDevices();
    } finally {
      setIsLoading(false);
    }
  }, [enumerateDevices]);

  useEffect(() => {
    enumerateDevices();
    // Listen for device changes
    navigator.mediaDevices.addEventListener("devicechange", enumerateDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", enumerateDevices);
    };
  }, [enumerateDevices]);

  const setVideoDevice = useCallback((deviceId: string) => {
    setSelectedVideoDeviceId(deviceId);
  }, []);

  const setAudioInputDevice = useCallback((deviceId: string) => {
    setSelectedAudioInputDeviceId(deviceId);
  }, []);

  const setAudioOutputDevice = useCallback(
    async (deviceId: string, stream?: MediaStream) => {
      setSelectedAudioOutputDeviceId(deviceId);
      if (stream && "setSinkId" in HTMLMediaElement.prototype) {
        try {
          // This needs to be called on the audio/video element, not the stream
          // The actual sinkId setting happens on the <video> or <audio> element
        } catch (err) {
          console.warn("Failed to set audio output device:", err);
        }
      }
    },
    []
  );

  return {
    videoDevices,
    audioInputDevices,
    audioOutputDevices,
    selectedVideoDeviceId,
    selectedAudioInputDeviceId,
    selectedAudioOutputDeviceId,
    setVideoDevice,
    setAudioInputDevice,
    setAudioOutputDevice,
    requestPermissions,
    isLoading,
    error,
  };
}

// Hook for managing a media stream with device selection
export function useMediaStream(
  videoDeviceId: string | null,
  audioDeviceId: string | null,
  constraints?: MediaStreamConstraints
) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startStream = useCallback(async () => {
    setError(null);
    try {
      const videoConstraints: MediaTrackConstraints = videoDeviceId
        ? { deviceId: { exact: videoDeviceId } }
        : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } };

      const audioConstraints: MediaTrackConstraints = audioDeviceId
        ? { deviceId: { exact: audioDeviceId } }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: constraints?.video ?? videoConstraints,
        audio: constraints?.audio ?? audioConstraints,
      });

      streamRef.current = newStream;
      setStream(newStream);
    } catch (err) {
      console.error("Failed to get media stream:", err);
      setError("Could not access camera/microphone");
      // Try audio only
      try {
        const audioConstraints: MediaTrackConstraints = audioDeviceId
          ? { deviceId: { exact: audioDeviceId } }
          : { echoCancellation: true, noiseSuppression: true };
        const audioStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: constraints?.audio ?? audioConstraints,
        });
        streamRef.current = audioStream;
        setStream(audioStream);
      } catch {
        setError("Could not access microphone either");
        setStream(new MediaStream());
      }
    }
  }, [videoDeviceId, audioDeviceId, constraints]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const switchVideoDevice = useCallback(
    async (newDeviceId: string) => {
      if (!streamRef.current) return;
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: newDeviceId } },
          audio: false,
        });
        const newVideoTrack = newStream.getVideoTracks()[0];
        const oldVideoTrack = streamRef.current.getVideoTracks()[0];
        if (oldVideoTrack) {
          streamRef.current.removeTrack(oldVideoTrack);
          oldVideoTrack.stop();
        }
        streamRef.current.addTrack(newVideoTrack);
        setStream(new MediaStream(streamRef.current.getTracks()));
      } catch (err) {
        console.error("Failed to switch video device:", err);
      }
    },
    []
  );

  const switchAudioDevice = useCallback(
    async (newDeviceId: string) => {
      if (!streamRef.current) return;
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: { deviceId: { exact: newDeviceId } },
        });
        const newAudioTrack = newStream.getAudioTracks()[0];
        const oldAudioTrack = streamRef.current.getAudioTracks()[0];
        if (oldAudioTrack) {
          streamRef.current.removeTrack(oldAudioTrack);
          oldAudioTrack.stop();
        }
        streamRef.current.addTrack(newAudioTrack);
        setStream(new MediaStream(streamRef.current.getTracks()));
      } catch (err) {
        console.error("Failed to switch audio device:", err);
      }
    },
    []
  );

  useEffect(() => {
    startStream();
    return () => stopStream();
  }, [startStream, stopStream]);

  return { stream, error, startStream, stopStream, switchVideoDevice, switchAudioDevice };
}