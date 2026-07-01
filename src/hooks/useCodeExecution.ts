"use client";

import { useState, useCallback, useRef, useEffect } from "react";

type ExecutionResult = {
  stdout: string;
  stderr: string;
  images: string[]; // base64 PNGs
};

type PyodideModule = {
  runPython: (code: string) => unknown;
  globals: Map<string, unknown>;
  loadPackage: (names: string[]) => Promise<void>;
  FS: { writeFile: (path: string, data: Uint8Array) => void };
};

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";

let pyodideInstance: PyodideModule | null = null;
let pyodideLoading: Promise<PyodideModule> | null = null;

async function getPyodide(): Promise<PyodideModule> {
  if (pyodideInstance) return pyodideInstance;
  if (pyodideLoading) return pyodideLoading;

  pyodideLoading = (async () => {
    const script = document.createElement("script");
    script.src = PYODIDE_CDN;
    script.async = true;
    document.head.appendChild(script);
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error("Failed to load Pyodide"));
    });

    const pyodide = await (window as unknown as { loadPyodide: (config: { indexURL: string }) => Promise<PyodideModule> }).loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
    });

    await pyodide.loadPackage(["numpy", "pandas", "matplotlib", "scipy"]);
    pyodideInstance = pyodide;
    return pyodide;
  })();

  return pyodideLoading;
}

function capturePythonStdout(pyodide: PyodideModule): () => string {
  const chunks: string[] = [];
  const code = `
import sys
from io import StringIO

_buf = StringIO()
_old_stdout = sys.stdout
sys.stdout = _buf
_display_hook = sys.displayhook
sys.displayhook = lambda x: None
`;
  pyodide.runPython(code);

  return () => {
    const code2 = `
sys.stdout = _old_stdout
sys.displayhook = _display_hook
out = _buf.getvalue()
_buf = StringIO()
sys.stdout = _buf
sys.displayhook = lambda x: None
out
`;
    return String(pyodide.runPython(code2));
  };
}

export function usePythonExecution() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");

  const execute = useCallback(async (code: string): Promise<ExecutionResult> => {
    setLoading(true);
    setProgress("Loading Pyodide…");
    try {
      const pyodide = await getPyodide();
      setProgress("Running…");

      // Redirect stdout
      const flushStdout = capturePythonStdout(pyodide);

      // Set up matplotlib to save as base64
      const setupCode = `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import base64, io, sys, json

def _aura_show():
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight')
    buf.seek(0)
    img_b64 = base64.b64encode(buf.read()).decode()
    plt.close()
    return img_b64
`;
      pyodide.runPython(setupCode);

      let stdout = "";
      let stderr = "";
      const images: string[] = [];

      try {
        pyodide.runPython(code);
        stdout = flushStdout();

        // Check if there's a current figure
        const hasFig = pyodide.runPython(`
import matplotlib.pyplot as plt
str(int(plt.get_fignums() != []))
`) as string;
        if (hasFig === "1") {
          const imgB64 = pyodide.runPython("_aura_show()") as string;
          images.push(imgB64);
        }
      } catch (err) {
        stderr = String(err);
        stdout = flushStdout();
      }

      return { stdout, stderr, images };
    } finally {
      setLoading(false);
      setProgress("");
    }
  }, []);

  return { execute, loading, progress };
}

export function useJSExecution() {
  const execute = useCallback(async (code: string): Promise<ExecutionResult> => {
    const chunks: string[] = [];
    const mockConsole = {
      log: (...args: unknown[]) => chunks.push(args.map(String).join(" ")),
      error: (...args: unknown[]) => chunks.push("ERROR: " + args.map(String).join(" ")),
    };

    try {
      const fn = new Function("console", code);
      fn(mockConsole);
      return { stdout: chunks.join("\n"), stderr: "", images: [] };
    } catch (err) {
      return { stdout: chunks.join("\n"), stderr: String(err), images: [] };
    }
  }, []);

  return { execute };
}
