"use client";

import { useState, useCallback } from "react";

type ExecutionResult = {
  stdout: string;
  stderr: string;
};

let counter = 0;

export function useCodeExecution() {
  const [loading, setLoading] = useState(false);

  const execute = useCallback(async (code: string): Promise<ExecutionResult> => {
    setLoading(true);
    const id = ++counter;
    const safeCode = JSON.stringify(code).replace(/<\/script>/gi, "<\\/script>");

    const html = `<!DOCTYPE html>
<html><body><script>
const _logs = [];
const _errs = [];
const console = {
  log: (...a) => _logs.push(a.map(String).join(' ')),
  warn: (...a) => _logs.push('[warn] ' + a.map(String).join(' ')),
  error: (...a) => _errs.push(a.map(String).join(' ')),
};
try {
  Function(${safeCode})();
} catch (e) {
  _errs.push(e && e.stack ? e.stack : String(e));
}
parent.postMessage({ source: 'aura-sandbox-${id}', stdout: _logs.join('\\n'), stderr: _errs.join('\\n') }, '*');
<\/script></body></html>`;

    return new Promise<ExecutionResult>((resolve) => {
      let resolved = false;

      function done(result: ExecutionResult) {
        if (resolved) return;
        resolved = true;
        window.removeEventListener("message", handler);
        setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 0);
        resolve(result);
      }

      function handler(e: MessageEvent) {
        if (e.data?.source === `aura-sandbox-${id}`) {
          done({ stdout: e.data.stdout || "", stderr: e.data.stderr || "" });
        }
      }
      window.addEventListener("message", handler);

      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.sandbox = "allow-scripts";
      iframe.srcdoc = html;
      document.body.appendChild(iframe);

      setTimeout(() => done({ stdout: "", stderr: "Execution timed out after 10 seconds" }), 10_000);
    }).finally(() => setLoading(false));
  }, []);

  return { execute, loading };
}
