

/**
 * BlobBackground
 * Animated, two-layer "breathing" purple/magenta blobs (primary + accent)
 * for VaultAgent's Technical Minimalist Glass background.
 *
 * Usage in main.tsx:
 *
 *   import BlobBackground from './BlobBackground';
 *
 *   ReactDOM.createRoot(document.getElementById('root')!).render(
 *     <React.StrictMode>
 *       <BlobBackground />
 *       <App />
 *     </React.StrictMode>
 *   );
 *
 * BlobBackground is `fixed inset-0 -z-10 pointer-events-none`, so it sits
 * behind your app and never blocks clicks — just drop it once, anywhere
 * above <App />.
 */
export default function BlobBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-background pointer-events-none">
      {/* Layer 1 — large, slow, primary (#770B83) base */}
      <div
        className="absolute top-[10%] left-[15%] w-[600px] h-[600px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, color-mix(in srgb, var(--color-primary) 85%, transparent) 0%, transparent 70%)',
          animation: 'blob-breathe-a 14s cubic-bezier(0.45,0,0.55,1) infinite',
          animationDelay: '-2s',
        }}
      />

      {/* Layer 2 — mid, accent (#A0548D), offset cadence */}
      <div
        className="absolute top-[40%] left-[55%] w-[480px] h-[480px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, color-mix(in srgb, var(--color-accent) 75%, transparent) 0%, transparent 70%)',
          animation: 'blob-breathe-b 11s cubic-bezier(0.45,0,0.55,1) infinite',
          animationDelay: '-6s',
        }}
      />

      {/* Vignette in the background tone — pushed further out so it doesn't crush the glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--color-background)_95%)]" />

      <style>{`
        @keyframes blob-breathe-a {
          0%   { transform: scale(1) translate(0, 0);          filter: blur(70px); opacity: 0.75; border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
          33%  { transform: scale(1.1) translate(20px, -25px);  filter: blur(78px); opacity: 0.9;  border-radius: 40% 60% 65% 35% / 45% 55% 45% 55%; }
          50%  { transform: scale(1.18) translate(30px, -40px); filter: blur(85px); opacity: 1;    border-radius: 65% 35% 45% 55% / 35% 65% 40% 60%; }
          75%  { transform: scale(1.08) translate(10px, -15px); filter: blur(76px); opacity: 0.85; border-radius: 45% 55% 55% 45% / 60% 40% 55% 45%; }
          100% { transform: scale(1) translate(0, 0);          filter: blur(70px); opacity: 0.75; border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
        }
        @keyframes blob-breathe-b {
          0%   { transform: scale(1) translate(0, 0);          filter: blur(60px); opacity: 0.65; border-radius: 45% 55% 60% 40% / 55% 45% 55% 45%; }
          33%  { transform: scale(1.12) translate(-20px, 15px); filter: blur(68px); opacity: 0.8;  border-radius: 60% 40% 35% 65% / 40% 60% 35% 65%; }
          50%  { transform: scale(1.22) translate(-35px, 25px); filter: blur(75px); opacity: 0.9;  border-radius: 35% 65% 55% 45% / 65% 35% 60% 40%; }
          75%  { transform: scale(1.1) translate(-15px, 10px);  filter: blur(66px); opacity: 0.78; border-radius: 55% 45% 40% 60% / 45% 55% 40% 60%; }
          100% { transform: scale(1) translate(0, 0);          filter: blur(60px); opacity: 0.65; border-radius: 45% 55% 60% 40% / 55% 45% 55% 45%; }
        }

        @media (prefers-reduced-motion: reduce) {
          div[style*="blob-breathe"] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}