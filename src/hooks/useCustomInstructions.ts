"use client";

import { useState, useEffect, useCallback } from "react";
import { loadJson, saveJson } from "@/utils/storage";

export function useCustomInstructions() {
  const [instructions, setInstructionsState] = useState("");

  useEffect(() => {
    setInstructionsState(loadJson("aura-instructions", ""));
  }, []);

  const setInstructions = useCallback((val: string) => {
    setInstructionsState(val);
    saveJson("aura-instructions", val);
  }, []);

  return { instructions, setInstructions };
}
