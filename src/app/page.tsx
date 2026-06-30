import Recorder from "@/components/Recorder";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-[#09090b] text-[#fafafa] antialiased selection:bg-zinc-800 selection:text-white relative overflow-hidden">
      {/* Premium ambient glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[50%] rounded-full bg-zinc-800/10 blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[50%] rounded-full bg-zinc-800/10 blur-[140px] pointer-events-none" />

      <header className="px-6 py-5 flex justify-between items-center border-b border-zinc-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-500 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-zinc-400"></span>
          </div>
          <span className="text-xs font-semibold tracking-widest text-zinc-400 uppercase font-mono">Webcam Capture</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 z-10">
        <Recorder />
      </main>

      <footer className="py-6 border-t border-zinc-900/40 text-center text-[10px] tracking-widest text-zinc-600 font-mono">
        &copy; {new Date().getFullYear()} WEBCAM RECORDER.
      </footer>
    </div>
  );
}

