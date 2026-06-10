'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button, Card, Switch } from "@heroui/react";
import init, { rotate_90_clockwise } from "@/wasm-pkg/wasm_video";

const RESOLUTIONS = [
  { label: '480p (854x480)', value: '480p', width: 854, height: 480 },
  { label: '720p (1280x720)', value: '720p', width: 1280, height: 720 },
  { label: '1080p (1920x1080)', value: '1080p', width: 1920, height: 1080 },
];

export default function Recorder() {
  const [resolution, setResolution] = useState('720p');
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
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const recordingUrlRef = useRef<string | null>(null);

  const selectedResolution = useMemo(
    () => RESOLUTIONS.find(r => r.value === resolution) ?? RESOLUTIONS[1],
    [resolution],
  );
  const previewAspectRatio = isVertical ? 1 / streamAspectRatio : streamAspectRatio;

  const clearRecording = useCallback(() => {
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
    }
    setRecordingUrl(null);
    setRecordingName('');
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
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
        // Fix for "using deprecated parameters" warning
        await init({ module_or_path: "/wasm/wasm_video_bg.wasm" });
        setIsWasmLoaded(true);
      } catch (err) {
        console.error("Failed to load Wasm:", err);
      }
    }
    loadWasm();

    async function getDevices() {
      try {
        const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); // Request permission first
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
    };
  }, []);

  useEffect(() => {
    return () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
  }, [recordingUrl]);

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
    
    // Stop current tracks to ensure resolution switch works
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }

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
      // Some browsers reject device-specific audio constraints if the device disappears.
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
        setStreamError("Não foi possível iniciar a câmera com a resolução selecionada.");
      }
    }
  }, [clearRecording, isVertical, processFrames, selectedAudioDevice, selectedResolution, selectedVideoDevice]);

  useEffect(() => {
    if (selectedVideoDevice || resolution || selectedAudioDevice) {
      const timeoutId = window.setTimeout(() => {
        void startStream();
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [resolution, selectedAudioDevice, selectedVideoDevice, startStream]);

  const startRecording = () => {
    clearRecording();

    const stream = isVertical 
      ? outputCanvasRef.current?.captureStream(30)
      : (videoRef.current?.srcObject as MediaStream);

    if (!stream) return;

    let finalStream = stream;
    if (isVertical && videoRef.current?.srcObject) {
      const audioStream = videoRef.current.srcObject as MediaStream;
      const audioTracks = audioStream.getAudioTracks();
      if (audioTracks.length > 0) {
        finalStream = new MediaStream([...stream.getVideoTracks(), ...audioTracks]);
      }
    }

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    const mediaRecorder = new MediaRecorder(finalStream, { mimeType });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const name = `recording-${resolution}-${isVertical ? 'vertical' : 'horizontal'}.webm`;
      recordingUrlRef.current = url;
      setRecordingUrl(url);
      setRecordingName(name);
      chunksRef.current = [];
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (document.fullscreenElement === containerRef.current) {
      void document.exitFullscreen();
    }
  };

  const downloadRecording = () => {
    if (!recordingUrl) return;
    const a = document.createElement('a');
    a.href = recordingUrl;
    a.download = recordingName;
    a.click();
  };

  const discardRecording = () => {
    clearRecording();
  };

  const recordingControls = (
    !isRecording ? (
      <Button 
        size="lg"
        className="bg-blue-600 text-white font-bold px-8 rounded-full hover:bg-blue-700 transition-all shadow-lg" 
        onPress={startRecording}
      >
        Iniciar Gravação
      </Button>
    ) : (
      <Button 
        size="lg"
        className="bg-red-600 text-white font-bold px-8 rounded-full hover:bg-red-700 transition-all shadow-lg" 
        onPress={stopRecording}
      >
        Parar
      </Button>
    )
  );

  return (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl mx-auto">
      <Card className="p-6 bg-white dark:bg-zinc-900 shadow-xl rounded-2xl border border-divider">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-6 items-start">
            <div className="flex flex-col gap-2 flex-1 min-w-[200px]">
              <label className="text-sm font-semibold text-zinc-500">Câmera</label>
              <select 
                className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded-lg border border-divider outline-none"
                value={selectedVideoDevice}
                onChange={(e) => setSelectedVideoDevice(e.target.value)}
              >
                {videoDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Câmera ${device.deviceId.slice(0, 5)}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2 flex-1 min-w-[200px]">
              <label className="text-sm font-semibold text-zinc-500">Microfone</label>
              <select 
                className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded-lg border border-divider outline-none"
                value={selectedAudioDevice}
                onChange={(e) => setSelectedAudioDevice(e.target.value)}
              >
                {audioDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microfone ${device.deviceId.slice(0, 5)}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2 min-w-[150px]">
              <label className="text-sm font-semibold text-zinc-500">Resolução</label>
              <select 
                className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded-lg border border-divider outline-none"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              >
                {RESOLUTIONS.map((res) => (
                  <option key={res.value} value={res.value}>
                    {res.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-zinc-500">Vertical 9:16</span>
              <div className="flex items-center gap-2">
                <Switch 
                  isSelected={isVertical} 
                  onChange={setIsVertical}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              </div>
            </div>
          </div>

          <div 
            ref={containerRef}
            className={`relative bg-zinc-950 rounded-xl overflow-hidden flex items-center justify-center border border-divider shadow-inner transition-all duration-300 ${isFullscreen ? 'w-full h-full' : 'aspect-video'}`}
            style={isFullscreen ? undefined : { aspectRatio: previewAspectRatio }}
          >
             {!isVertical ? (
               <video 
                 ref={videoRef} 
                 autoPlay 
                 muted 
                 playsInline 
                 className="w-full h-full object-contain"
               />
             ) : (
               <>
                 <video ref={videoRef} autoPlay muted playsInline className="hidden" />
                 <canvas ref={canvasRef} className="hidden" />
                 <canvas 
                   ref={outputCanvasRef} 
                   className="w-full h-full object-contain"
                   style={{ aspectRatio: previewAspectRatio }}
                 />
               </>
             )}
             
             {/* Botão de Fullscreen */}
             <button 
               onClick={toggleFullscreen}
               className="absolute bottom-4 right-4 bg-black/50 hover:bg-black/80 text-white p-2 rounded-lg transition-colors z-10"
               title={isFullscreen ? "Sair da Tela Cheia" : "Tela Cheia"}
             >
               {isFullscreen ? (
                 <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l6-6M10 14l-6 6"/></svg>
               ) : (
                 <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3M15 3h6v6M9 21H3v-6"/></svg>
               )}
             </button>

             {isRecording && (
               <div className="absolute top-4 right-4 flex items-center gap-2 bg-red-600/80 text-white px-3 py-1 rounded-full animate-pulse text-xs font-bold z-10">
                 <div className="w-2 h-2 bg-white rounded-full"></div>
                 GRAVANDO
               </div>
             )}

             {isFullscreen && (
               <div className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/60 px-4 py-3 shadow-2xl backdrop-blur">
                 {recordingControls}
               </div>
             )}
          </div>

          {streamError && (
            <p className="text-center text-sm font-medium text-red-600">{streamError}</p>
          )}

          <div className="flex justify-center gap-4 py-2">
            {recordingControls}
          </div>

          {recordingUrl && (
            <div className="flex flex-col gap-4 rounded-xl border border-divider bg-zinc-50 p-4 dark:bg-zinc-950">
              <video
                src={recordingUrl}
                controls
                className="w-full rounded-lg bg-black"
                style={{ aspectRatio: previewAspectRatio }}
              />
              <div className="flex flex-wrap justify-center gap-3">
                <Button
                  className="bg-blue-600 px-6 font-bold text-white hover:bg-blue-700"
                  onPress={downloadRecording}
                >
                  Baixar vídeo
                </Button>
                <Button
                  className="bg-zinc-200 px-6 font-bold text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-white dark:hover:bg-zinc-700"
                  onPress={discardRecording}
                >
                  Remover/Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-zinc-500">
        <div className="p-3 bg-zinc-100 dark:bg-zinc-900 rounded-lg">
          <strong>Resoluções Variadas</strong><br/>Grave em 480p, 720p ou 1080p com áudio selecionável.
        </div>
        <div className="p-3 bg-zinc-100 dark:bg-zinc-900 rounded-lg">
          <strong>Horizontal & Vertical</strong><br/>Grave para YouTube ou TikTok/Reels rotacionando o vídeo.
        </div>
        <div className="p-3 bg-zinc-100 dark:bg-zinc-900 rounded-lg">
          <strong>Processamento Wasm</strong><br/>Rotação de vídeo em tempo real processada por Rust no navegador.
        </div>
      </div>
    </div>
  );
}
