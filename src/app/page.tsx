import Recorder from "@/components/Recorder";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-zinc-50 dark:bg-black">
      <header className="p-6 border-b border-divider flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Webcam Recorder</h1>
        <div className="text-sm text-zinc-500">Powered by Next.js, HeroUI & Rust/Wasm</div>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center p-4">
        <Recorder />
      </main>
      <footer className="p-6 border-t border-divider text-center text-sm text-zinc-500">
        © 2026 Webcam Recorder
      </footer>
    </div>
  );
}
