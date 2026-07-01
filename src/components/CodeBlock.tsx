"use client";

import { useState, useCallback } from "react";
import { Play, Loader2, Check, X } from "lucide-react";
import { useCodeExecution } from "@/hooks/useCodeExecution";

type Props = {
  language: string;
  code: string;
};

export function CodeBlock({ language, code }: Props) {
  const { execute, loading } = useCodeExecution();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  const handleRun = useCallback(async () => {
    setState("running");
    setOutput("");
    setError("");

    const result = await execute(code);

    if (result.stderr) {
      setError(result.stderr);
      setOutput(result.stdout);
      setState("error");
    } else if (result.stdout) {
      setOutput(result.stdout);
      setState("done");
    } else {
      setState("done");
    }
  }, [code, execute]);

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{language || "code"}</span>
        <button className="code-run-btn" onClick={handleRun} disabled={loading}>
          {loading ? (
            <><Loader2 size={14} className="animate-spin" /> Running…</>
          ) : state === "done" ? (
            <><Check size={14} /> Done</>
          ) : state === "error" ? (
            <><X size={14} /> Error</>
          ) : (
            <><Play size={14} /> Run</>
          )}
        </button>
      </div>
      <pre className="code-block-content"><code>{code}</code></pre>
      {(output || error) && (
        <div className={`code-block-output ${error ? "code-block-error" : ""}`}>
          {output && <pre>{output}</pre>}
          {error && <pre>{error}</pre>}
        </div>
      )}
    </div>
  );
}
