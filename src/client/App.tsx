import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "./components/HomePage.tsx";
import { GameRoom } from "./components/GameRoom.tsx";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/:gameId" element={<GameRoom />} />
      </Routes>
    </BrowserRouter>
  );
}
