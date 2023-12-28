// useGameOfLife.js

import { useRef, useState, useEffect } from 'react';
import { initializeGameOfLife } from './initializeGameOfLife'; // Assuming the function is exported from this file

export const useGameOfLife = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [timer, setTimer] = useState(100);
  const animationFrameIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const [runFunction, setRunFunction] = useState<any>(undefined);

  useEffect(() => {
    const setupCanvas = async () => {
      if (canvasRef.current) {
        return await initializeGameOfLife(canvasRef.current);
      }
    };

    setupCanvas().then((func) => {
      setRunFunction(() => func);
    });

    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const updateGridFunction = () => {
      const now = Date.now();
      if (now - lastTimeRef.current > timer) {
        runFunction();
        lastTimeRef.current = now;
      }
      animationFrameIdRef.current = requestAnimationFrame(updateGridFunction);
    };

    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
    }

    animationFrameIdRef.current = requestAnimationFrame(updateGridFunction);

    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [timer, runFunction]);

  return { canvasRef, timer, setTimer };
};

