"use client";

import { useState, useCallback } from "react";
import { Play, Loader2, Check, X } from "lucide-react";

type Props = {
  language: string;
  code: string;
};

const EXECUTABLE_LANGUAGES = new Set(["python", "javascript", "r", "ruby"]);

export function CodeBlock({ language, code }: Props) {
  const isExecutable = EXECUTABLE_LANGUAGES.has(language);
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  const handleRun = useCallback(async () => {
    setState("running");
    setOutput("");
    setError("");

    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, code }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        setState("error");
        return;
      }

      const outputParts: string[] = [];
      if (data.stdout) outputParts.push(data.stdout);
      if (data.stderr) outputParts.push(`stderr:\n${data.stderr}`);

      setOutput(outputParts.join("\n\n"));
      setState(data.code === 0 ? "done" : "error");
      if (data.code !== 0 && !data.stderr) {
        setError(`Exit code: ${data.code}`);
      }
    } catch (err) {
      setError((err as Error).message || "Request failed");
      setState("error");
    }
  }, [language, code]);

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{language || "code"}</span>
        {isExecutable && (
          <button className="code-run-btn" onClick={handleRun} disabled={state === "running"}>
            {state === "running" ? (
              <><Loader2 size={14} className="animate-spin" /> Running…</>
            ) : state === "done" ? (
              <><Check size={14} /> Done</>
            ) : state === "error" ? (
              <><X size={14} /> Error</>
            ) : (
              <><Play size={14} /> Run</>
            )}
          </button>
        )}
      </div>
      <pre className="code-block-content"><code>{code}</code></pre>
      {(output || error) && (
        <div className={`code-block-output ${error ? "code-block-error" : ""}`}>
          <pre>{error || output}</pre>
        </div>
      )}
    </div>
  );
}
