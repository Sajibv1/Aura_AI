"use client";

import { useState, useCallback } from "react";
import { Play, Loader2, Check, X } from "lucide-react";
import { usePythonExecution, useJSExecution } from "@/hooks/useCodeExecution";

type Props = {
  language: string;
  code: string;
};

const SUPPORTED = new Set(["python", "javascript"]);

export function CodeBlock({ language, code }: Props) {
  const isExecutable = SUPPORTED.has(language);
  const python = usePythonExecution();
  const js = useJSExecution();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [images, setImages] = useState<string[]>([]);

  const handleRun = useCallback(async () => {
    setState("running");
    setOutput("");
    setError("");
    setImages([]);

    try {
      const result = language === "python"
        ? await python.execute(code)
        : await js.execute(code);

      const parts: string[] = [];
      if (result.stdout) parts.push(result.stdout);
      if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
      setOutput(parts.join("\n\n"));

      if (result.images.length > 0) {
        setImages(result.images);
      }

      setState(result.stderr ? "error" : "done");
    } catch (err) {
      setError((err as Error).message || "Execution failed");
      setState("error");
    }
  }, [language, code, python, js]);

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{language || "code"}</span>
        {isExecutable && (
          <button className="code-run-btn" onClick={handleRun} disabled={state === "running"}>
            {state === "running" ? (
              <><Loader2 size={14} className="animate-spin" /> {python.progress || "Running…"}</>
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
      {(output || error || images.length > 0) && (
        <div className={`code-block-output ${error ? "code-block-error" : ""}`}>
          {error && <pre>{error}</pre>}
          {output && !error && <pre>{output}</pre>}
          {images.map((b64, i) => (
            <img
              key={i}
              src={`data:image/png;base64,${b64}`}
              alt="Plot"
              className="code-block-plot"
            />
          ))}
        </div>
      )}
    </div>
  );
}
