"use client";

import { Sparkles } from "lucide-react";

const MODELS = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
  { id: "llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B" },
  { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
  { id: "gemma2-9b-it", label: "Gemma 2 9B" },
  { id: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 70B" },
];

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function ModelSelector({ value, onChange }: Props) {
  return (
    <div className="model-selector">
      <Sparkles size={14} />
      <select value={value} onChange={(e) => onChange(e.target.value)} className="model-select">
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
    </div>
  );
}
