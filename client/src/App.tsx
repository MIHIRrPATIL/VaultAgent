import "./App.css";
import BlobBackground from "./components/blobbackground.tsx";
import PillNav from "./components/PillNav.tsx";
import LaserFlow from "./components/LaserFlow.tsx";
import { Routes, Route, useLocation } from "react-router-dom";
import PromptPage from "./pages/promptPage.tsx";
import Setuppage from "./pages/setupPage.tsx";

function App() {
  const location = useLocation();
  const showLaser = location.pathname === "/prompt";

  return (
    <main className="h-screen flex justify-center items-center relative overflow-hidden">
      <BlobBackground />

      {/* Eager-loaded LaserFlow — always mounted, WebGL context stays warm.
          Fades in/out based on route via CSS transition.
          will-change + translateZ(0) forces Tauri's WebKit to allocate a GPU compositing layer. */}
      <div
        className="absolute inset-0 z-0 flex justify-center items-center"
        style={{
          opacity: showLaser ? 1 : 0,
          transition: 'opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform, opacity',
          transform: 'translateZ(0)',
          pointerEvents: showLaser ? 'auto' : 'none',
        }}
      >
        <div className="w-[85vw] h-screen">
          <LaserFlow
            horizontalBeamOffset={0.11}
            verticalBeamOffset={0.0}
            color="#A0548D"
            wispDensity={1.2}
            wispIntensity={1}
            fogIntensity={0.45}
            mouseTiltStrength={0.05}
          />
        </div>
      </div>

      {/* Routing content area */}
      <Routes>
        <Route path="/" element={<Setuppage />} />
        <Route path="/prompt" element={<PromptPage />} />
        <Route path="/chats" element={<div className="text-white text-xl">Chats Page Placeholder</div>} />
        <Route path="/settings" element={<Setuppage />} />
        <Route path="/dashboard" element={<div className="text-white text-xl">Dashboard Page Placeholder</div>} />
      </Routes>

      <PillNav
        items={[
          { label: "Home", href: "/prompt" },
          { label: "Chats", href: "/chats" },
          { label: "setings", href: "/settings" },
          { label: "dashboard", href: "/dashboard" },
        ]}
        activeHref={location.pathname}
        className="custom-nav"
        ease="power2.easeOut"
        baseColor="#A0548D"
        pillColor="transparent"
        hoveredPillTextColor="#ffffff"
        pillTextColor="#FFFFE8"
        initialLoadAnimation
      />
    </main>
  );
}

export default App;

