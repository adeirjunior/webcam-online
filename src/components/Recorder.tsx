'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import init, { rotate_90_clockwise } from "@/wasm-pkg/wasm_video";

const RESOLUTIONS = [
  { label: '480p (854x480)', value: '480p', width: 854, height: 480 },
  { label: '720p (1280x720)', value: '720p', width: 1280, height: 720 },
  { label: '1080p (1920x1080)', value: '1080p', width: 1920, height: 1080 },
];

const VIDEO_BITRATES: Record<string, number> = {
  '480p': 2_500_000,
  '720p': 5_000_000,
  '1080p': 10_000_000,
};

type VideoFormat = 'webm' | 'mp4';

const FORMAT_MIME_TYPES: Record<VideoFormat, string[]> = {
  webm: [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ],
  mp4: [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
  ],
};

const getSupportedMimeType = (format: VideoFormat) => (
  FORMAT_MIME_TYPES[format].find(mimeType => MediaRecorder.isTypeSupported(mimeType)) ?? null
);

export default function Recorder() {
  const [resolution, setResolution] = useState('720p');
  const [videoFormat, setVideoFormat] = useState<VideoFormat>('webm');
  const [isVertical, setIsVertical] = useState(false);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState<string>('');
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  const [isWasmLoaded, setIsWasmLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamAspectRatio, setStreamAspectRatio] = useState(16 / 9);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingName, setRecordingName] = useState('');
  const [streamError, setStreamError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const recordingCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mainWrapperRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const recordingAnimationFrameRef = useRef<number | null>(null);
  const recordingUrlRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const selectedResolution = useMemo(
    () => RESOLUTIONS.find(r => r.value === resolution) ?? RESOLUTIONS[1],
    [resolution],
  );
  const previewAspectRatio = isVertical ? 1 / streamAspectRatio : streamAspectRatio;
  const recordingWidth = isVertical ? selectedResolution.height : selectedResolution.width;
  const recordingHeight = isVertical ? selectedResolution.width : selectedResolution.height;
  const recordingAspectRatio = recordingWidth / recordingHeight;
  const displayAspectRatio = recordingUrl ? recordingAspectRatio : previewAspectRatio;

  const clearRecording = useCallback(() => {
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
    }
    setRecordingUrl(null);
    setRecordingName('');
  }, []);

  const attachLiveStream = useCallback(() => {
    const video = videoRef.current;
    const stream = liveStreamRef.current;
    if (!video || !stream) return;

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    video.play().catch(err => {
      console.error("Error resuming webcam preview:", err);
    });
  }, []);

  const toggleFullscreen = () => {
    if (!mainWrapperRef.current) return;

    if (!document.fullscreenElement) {
      mainWrapperRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    async function loadWasm() {
      try {
        await init({ module_or_path: "/wasm/wasm_video_bg.wasm" });
        setIsWasmLoaded(true);
      } catch (err) {
        console.error("Failed to load Wasm:", err);
      }
    }
    loadWasm();

    async function getDevices() {
      try {
        const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        permissionStream.getTracks().forEach(track => track.stop());
        
        const vDevices = allDevices.filter(device => device.kind === 'videoinput');
        const aDevices = allDevices.filter(device => device.kind === 'audioinput');
        
        setVideoDevices(vDevices);
        setAudioDevices(aDevices);
        
        if (vDevices.length > 0) setSelectedVideoDevice(vDevices[0].deviceId);
        if (aDevices.length > 0) setSelectedAudioDevice(aDevices[0].deviceId);
      } catch (err) {
        console.error("Error getting devices:", err);
      }
    }
    getDevices();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (recordingAnimationFrameRef.current) cancelAnimationFrame(recordingAnimationFrameRef.current);
      liveStreamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  useEffect(() => {
    return () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
  }, [recordingUrl]);

  // Handle recording timer
  useEffect(() => {
    if (isRecording) {
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isRecording]);

  const processFrames = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !outputCanvasRef.current || !isWasmLoaded) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const outputCanvas = outputCanvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const outputCtx = outputCanvas.getContext('2d');

    if (!ctx || !outputCtx) return;

    const render = () => {
      if (video.paused || video.ended) return;

      const width = video.videoWidth;
      const height = video.videoHeight;
      
      if (width === 0 || height === 0) {
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        outputCanvas.width = height; // Rotated
        outputCanvas.height = width;
      }

      ctx.drawImage(video, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      
      // Use Wasm to rotate
      const rotatedData = rotate_90_clockwise(new Uint8Array(imageData.data), width, height);
      
      const rotatedImageData = new ImageData(
        new Uint8ClampedArray(rotatedData),
        height,
        width
      );
      
      outputCtx.putImageData(rotatedImageData, 0, 0);
      
      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);
  }, [isWasmLoaded]);

  const startStream = useCallback(async () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    
    liveStreamRef.current?.getTracks().forEach(track => track.stop());
    liveStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;

    clearRecording();

    const constraints: MediaStreamConstraints = {
      video: {
        deviceId: selectedVideoDevice ? { exact: selectedVideoDevice } : undefined,
        width: { ideal: selectedResolution.width },
        height: { ideal: selectedResolution.height },
        aspectRatio: { ideal: selectedResolution.width / selectedResolution.height },
      },
      audio: {
        deviceId: selectedAudioDevice ? { exact: selectedAudioDevice } : undefined,
      }
    };

    try {
      setStreamError(null);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      liveStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          const video = videoRef.current;
          if (!video) return;
          if (video.videoWidth && video.videoHeight) {
            setStreamAspectRatio(video.videoWidth / video.videoHeight);
          } else {
            setStreamAspectRatio(selectedResolution.width / selectedResolution.height);
          }
          video.play();
          if (isVertical) {
            processFrames();
          }
        };
      }
    } catch (err) {
      console.error("Error accessing webcam with constraints:", err);
      try {
        const fallbackConstraints: MediaStreamConstraints = {
          video: {
            deviceId: selectedVideoDevice ? { exact: selectedVideoDevice } : undefined,
            width: { ideal: selectedResolution.width },
            height: { ideal: selectedResolution.height },
            aspectRatio: { ideal: selectedResolution.width / selectedResolution.height },
          },
          audio: true,
        };
        const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
        liveStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            const video = videoRef.current;
            if (!video) return;
            if (video.videoWidth && video.videoHeight) {
              setStreamAspectRatio(video.videoWidth / video.videoHeight);
            } else {
              setStreamAspectRatio(selectedResolution.width / selectedResolution.height);
            }
            video.play();
            if (isVertical) {
              processFrames();
            }
          };
        }
      } catch (fallbackErr) {
        console.error("Fallback constraints also failed:", fallbackErr);
        setStreamError("Não foi possível iniciar a câmera com os parâmetros selecionados.");
      }
    }
  }, [clearRecording, isVertical, processFrames, selectedAudioDevice, selectedResolution, selectedVideoDevice]);

  useEffect(() => {
    if (recordingUrl) return;
    attachLiveStream();
    if (isVertical) processFrames();
  }, [attachLiveStream, isVertical, processFrames, recordingUrl]);

  useEffect(() => {
    if (selectedVideoDevice || resolution || selectedAudioDevice) {
      const timeoutId = window.setTimeout(() => {
        void startStream();
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [resolution, selectedAudioDevice, selectedVideoDevice, startStream]);

  const drawRecordingFrame = useCallback(() => {
    const source = videoRef.current;
    const canvas = recordingCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!source || !canvas || !ctx || source.videoWidth === 0 || source.videoHeight === 0) {
      return;
    }

    if (canvas.width !== recordingWidth || canvas.height !== recordingHeight) {
      canvas.width = recordingWidth;
      canvas.height = recordingHeight;
    }

    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, recordingWidth, recordingHeight);

    if (isVertical) {
      const scale = Math.max(recordingHeight / source.videoWidth, recordingWidth / source.videoHeight);
      const drawWidth = source.videoWidth * scale;
      const drawHeight = source.videoHeight * scale;
      ctx.translate(recordingWidth / 2, recordingHeight / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    } else {
      const scale = Math.max(recordingWidth / source.videoWidth, recordingHeight / source.videoHeight);
      const drawWidth = source.videoWidth * scale;
      const drawHeight = source.videoHeight * scale;
      ctx.drawImage(
        source,
        (recordingWidth - drawWidth) / 2,
        (recordingHeight - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
    }

    ctx.restore();
  }, [isVertical, recordingHeight, recordingWidth]);

  const stopRecordingRender = useCallback(() => {
    if (recordingAnimationFrameRef.current) {
      cancelAnimationFrame(recordingAnimationFrameRef.current);
      recordingAnimationFrameRef.current = null;
    }
  }, []);

  const startRecording = useCallback(() => {
    clearRecording();
    setRecordingTime(0);
    attachLiveStream();
    chunksRef.current = [];

    const canvas = recordingCanvasRef.current;
    if (!canvas || !videoRef.current || !liveStreamRef.current) return;

    const mimeType = getSupportedMimeType(videoFormat);
    if (!mimeType) {
      setStreamError(`Gravação em ${videoFormat.toUpperCase()} não é suportada neste navegador.`);
      return;
    }

    canvas.width = recordingWidth;
    canvas.height = recordingHeight;
    stopRecordingRender();

    const render = () => {
      drawRecordingFrame();
      recordingAnimationFrameRef.current = requestAnimationFrame(render);
    };
    render();

    const stream = canvas.captureStream(30);

    let finalStream: MediaStream = stream;
    const audioTracks = liveStreamRef.current.getAudioTracks();
    if (audioTracks.length > 0) {
      finalStream = new MediaStream([...stream.getVideoTracks(), ...audioTracks]);
    }

    const mediaRecorder = new MediaRecorder(finalStream, {
      mimeType,
      videoBitsPerSecond: VIDEO_BITRATES[resolution] ?? VIDEO_BITRATES['720p'],
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      stopRecordingRender();
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const name = `recording-${resolution}-${isVertical ? 'vertical' : 'horizontal'}.${videoFormat}`;
      recordingUrlRef.current = url;
      setRecordingUrl(url);
      setRecordingName(name);
      chunksRef.current = [];
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start();
    setStreamError(null);
    setIsRecording(true);
  }, [attachLiveStream, clearRecording, drawRecordingFrame, isVertical, recordingHeight, recordingWidth, resolution, stopRecordingRender, videoFormat]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.repeat || event.key.toLowerCase() !== 'r') return;

      event.preventDefault();

      if (isRecording) {
        stopRecording();
        return;
      }

      startRecording();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording, startRecording, stopRecording]);

  const downloadRecording = () => {
    if (!recordingUrl) return;
    const a = document.createElement('a');
    a.href = recordingUrl;
    a.download = recordingName;
    a.click();
  };

  const discardRecording = () => {
    clearRecording();
    window.setTimeout(() => {
      attachLiveStream();
      if (isVertical) processFrames();
    }, 0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const fullscreenControlsClass = isFullscreen
    ? 'fixed bottom-6 left-1/2 z-[10000] w-[min(92vw,36rem)] -translate-x-1/2 rounded-[28px] border border-zinc-800/80 bg-[#09090b]/85 px-4 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.65)] backdrop-blur-xl'
    : '';

  return (
    <div 
      ref={mainWrapperRef}
      className={`flex flex-col items-center w-full mx-auto transition-all duration-300 ${
        isFullscreen 
          ? 'bg-[#09090b] h-full w-full p-8 justify-center gap-6 overflow-y-auto z-[9999]' 
          : 'max-w-xl px-2'
      }`}
    >
      {/* Video Viewport Container */}
      <div 
        ref={containerRef}
        className={`relative bg-[#0c0c0e] rounded-[24px] overflow-hidden flex items-center justify-center border border-zinc-800/80 shadow-[0_12px_40px_rgba(0,0,0,0.7)] transition-all duration-500 ease-out mx-auto ${
          isFullscreen ? 'max-h-[60vh] w-auto' : 'w-full'
        }`}
        style={isFullscreen ? { 
          aspectRatio: displayAspectRatio,
          height: '60vh',
          maxHeight: '600px',
          width: 'auto'
        } : { 
          maxWidth: isVertical ? '280px' : '100%', 
          aspectRatio: displayAspectRatio 
        }}
      >
        {recordingUrl && (
          /* Recorded Preview Player */
          <video
            src={recordingUrl}
            controls
            className="relative z-10 w-full h-full object-contain rounded-[24px]"
            style={{ aspectRatio: recordingAspectRatio }}
          />
        )}

        {/* Live Stream */}
        <div className={recordingUrl ? 'absolute inset-0 opacity-0 pointer-events-none' : 'contents'}>
            {!isVertical ? (
              <video 
                ref={videoRef} 
                autoPlay 
                muted 
                playsInline 
                className="w-full h-full object-contain scale-x-[-1]"
              />
            ) : (
              <>
                <video ref={videoRef} autoPlay muted playsInline className="hidden" />
                <canvas ref={canvasRef} className="hidden" />
                <canvas 
                  ref={outputCanvasRef} 
                  className="w-full h-full object-contain scale-x-[-1]"
                  style={{ aspectRatio: previewAspectRatio }}
                />
              </>
            )}

            {/* Top Left: Resolution Pill */}
            <div className="absolute top-4 left-4 z-10 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/5 text-[9px] font-mono tracking-widest text-zinc-300 flex items-center gap-1.5">
              <span className="font-semibold">{selectedResolution.value.toUpperCase()}</span>
              <span className="w-1 h-1 rounded-full bg-zinc-600"></span>
              <span>{isVertical ? 'PORTRAIT' : 'LANDSCAPE'}</span>
            </div>

            {/* Top Right: Status / Recording Pill */}
            {isRecording ? (
              <div className="absolute top-4 right-4 z-10 bg-red-950/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-red-800/40 text-[9px] font-mono font-bold tracking-widest text-red-200 flex items-center gap-1.5 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                <span>REC {formatTime(recordingTime)}</span>
              </div>
            ) : (
              <div className="absolute top-4 right-4 z-10 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/5 text-[9px] font-mono tracking-widest text-zinc-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500"></span>
                <span>STANDBY</span>
              </div>
            )}

            {/* Fullscreen Button */}
            <button 
              onClick={toggleFullscreen}
              className="absolute bottom-4 right-4 bg-black/50 hover:bg-black/80 border border-white/5 text-zinc-300 p-2 rounded-xl transition-all cursor-pointer backdrop-blur-sm z-10 hover:scale-105"
              title={isFullscreen ? "Sair da Tela Cheia" : "Tela Cheia"}
            >
              {isFullscreen ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l6-6M10 14l-6 6"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
              )}
            </button>
        </div>
        <canvas ref={recordingCanvasRef} className="hidden" />
      </div>

      {streamError && (
        <p className="text-center text-xs font-medium text-red-500 mt-4 bg-red-950/20 border border-red-900/30 px-4 py-2 rounded-xl w-full">
          {streamError}
        </p>
      )}

      {/* Control Actions Area */}
      {recordingUrl ? (
        /* Actions when video is recorded and ready for preview */
        <div className={`flex flex-col gap-3 w-full items-center mt-6 ${fullscreenControlsClass}`}>
          <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={downloadRecording}
              className="flex items-center justify-center gap-2 bg-white text-black hover:bg-zinc-200 px-6 py-3.5 rounded-xl font-medium transition-all shadow-[0_4px_20px_rgba(255,255,255,0.08)] cursor-pointer text-xs"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
              Salvar Gravação
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={discardRecording}
              className="flex items-center justify-center gap-2 bg-zinc-900/80 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 px-6 py-3.5 rounded-xl font-medium transition-all cursor-pointer text-xs"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              Gravar Novo
            </motion.button>
          </div>
        </div>
      ) : (
        /* Action buttons for standard camera interface */
        <div className={`flex flex-col items-center gap-4 w-full mt-6 ${fullscreenControlsClass}`}>
          <div className="flex items-center justify-center gap-8 relative w-full">
            {/* Gear Button Left */}
            {!isRecording && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowSettings(!showSettings)}
                className={`p-3.5 rounded-full border transition-all cursor-pointer ${
                  showSettings 
                    ? 'bg-white border-white text-black shadow-lg shadow-white/5' 
                    : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
                title="Configurações"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
              </motion.button>
            )}

            {/* Central Recording Button */}
            {!isRecording ? (
              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={startRecording}
                className="relative flex items-center justify-center w-20 h-20 rounded-full bg-[#0c0c0e] border-2 border-zinc-800 hover:border-red-500/80 transition-colors cursor-pointer group shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
              >
                <div className="w-12 h-12 rounded-full bg-red-600 transition-transform duration-300 group-hover:scale-95 shadow-[0_0_15px_rgba(220,38,38,0.25)]" />
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={stopRecording}
                className="relative flex items-center justify-center w-20 h-20 rounded-full bg-[#0c0c0e] border-2 border-red-500/80 cursor-pointer group shadow-[0_6px_20px_rgba(220,38,38,0.15)]"
              >
                <div className="w-6 h-6 rounded-md bg-red-600 transition-transform duration-300 group-hover:scale-95 shadow-[0_0_15px_rgba(220,38,38,0.25)] animate-pulse" />
              </motion.button>
            )}

            {/* Dummy spacer or balance placeholder */}
            {!isRecording && (
              <div className="w-[50px] pointer-events-none opacity-0" />
            )}
          </div>

          {/* Settings panel */}
          <AnimatePresence>
            {showSettings && !isRecording && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden w-full"
              >
                <div className="p-5 rounded-2xl bg-zinc-900/30 border border-zinc-900/60 backdrop-blur-md flex flex-col gap-4 mt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Camera Select */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] font-mono tracking-widest text-zinc-500 uppercase flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
                        Câmera
                      </span>
                      <div className="relative">
                        <select
                          value={selectedVideoDevice}
                          onChange={(e) => setSelectedVideoDevice(e.target.value)}
                          className="w-full bg-zinc-950/60 border border-zinc-800/50 text-zinc-300 text-xs rounded-xl p-2.5 px-3 appearance-none focus:outline-none focus:border-zinc-700 transition-colors cursor-pointer"
                        >
                          {videoDevices.map(d => (
                            <option key={d.deviceId} value={d.deviceId} className="bg-zinc-950 text-zinc-300">
                              {d.label || `Câmera ${d.deviceId.slice(0, 5)}`}
                            </option>
                          ))}
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m6 9 6 6 6-6"/></svg>
                        </div>
                      </div>
                    </div>

                    {/* Microphone Select */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] font-mono tracking-widest text-zinc-500 uppercase flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                        Microfone
                      </span>
                      <div className="relative">
                        <select
                          value={selectedAudioDevice}
                          onChange={(e) => setSelectedAudioDevice(e.target.value)}
                          className="w-full bg-zinc-950/60 border border-zinc-800/50 text-zinc-300 text-xs rounded-xl p-2.5 px-3 appearance-none focus:outline-none focus:border-zinc-700 transition-colors cursor-pointer"
                        >
                          {audioDevices.map(d => (
                            <option key={d.deviceId} value={d.deviceId} className="bg-zinc-950 text-zinc-300">
                              {d.label || `Microfone ${d.deviceId.slice(0, 5)}`}
                            </option>
                          ))}
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m6 9 6 6 6-6"/></svg>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Resolution Selector */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] font-mono tracking-widest text-zinc-500 uppercase">
                        Resolução
                      </span>
                      <div className="grid grid-cols-3 gap-1 bg-zinc-950/60 border border-zinc-800/50 p-1 rounded-xl">
                        {RESOLUTIONS.map((res) => (
                          <button
                            key={res.value}
                            onClick={() => setResolution(res.value)}
                            className={`text-[10px] py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                              resolution === res.value 
                                ? 'bg-zinc-800 text-white shadow-sm' 
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            {res.value.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Orientation Selector */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] font-mono tracking-widest text-zinc-500 uppercase">
                        Orientação
                      </span>
                      <div className="grid grid-cols-2 gap-1 bg-zinc-950/60 border border-zinc-800/50 p-1 rounded-xl">
                        <button
                          onClick={() => setIsVertical(false)}
                          className={`text-[10px] py-1.5 rounded-lg font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                            !isVertical 
                              ? 'bg-zinc-800 text-white shadow-sm' 
                              : 'text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
                          Horizontal
                        </button>
                        <button
                          onClick={() => setIsVertical(true)}
                          className={`text-[10px] py-1.5 rounded-lg font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                            isVertical 
                              ? 'bg-zinc-800 text-white shadow-sm' 
                              : 'text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
                          Vertical
                        </button>
                      </div>
                    </div>

                    {/* Format Selector */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] font-mono tracking-widest text-zinc-500 uppercase">
                        Formato
                      </span>
                      <div className="grid grid-cols-2 gap-1 bg-zinc-950/60 border border-zinc-800/50 p-1 rounded-xl">
                        {(['webm', 'mp4'] as VideoFormat[]).map((format) => (
                          <button
                            key={format}
                            onClick={() => setVideoFormat(format)}
                            className={`text-[10px] py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                              videoFormat === format
                                ? 'bg-zinc-800 text-white shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            {format.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
