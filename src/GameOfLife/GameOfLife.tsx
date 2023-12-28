import { useGameOfLife } from "./useGameOfLife";

export default function GameOfLife() {
  const { canvasRef, timer, setTimer } = useGameOfLife();

  return (
    <div>
      <canvas ref={canvasRef} width="1024" height="1024"></canvas>
      <input
        type="range"
        min="10"
        max="1000"
        value={timer}
        onChange={(e) => setTimer(Number(e.target.value))}
      />
    </div>
  );
}

