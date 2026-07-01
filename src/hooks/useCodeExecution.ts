"use client";

import { useState, useCallback } from "react";

type ExecutionResult = {
  stdout: string;
  stderr: string;
  images: string[];
};

type PyodideAPI = {
  runPython: (code: string) => unknown;
  loadPackage: (names: string[]) => Promise<void>;
};

const PYODIDE_VERSION = "v0.26.4";
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;
const SCRIPT_URL = `${PYODIDE_INDEX}pyodide.js`;
const DEFAULT_TIMEOUT = 60_000;

function timeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  let id: ReturnType<typeof setTimeout>;
  const timer = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error(msg)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(id!));
}

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) { resolve(); return; }
    const s = document.createElement("script");
    s.src = url;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.head.appendChild(s);
  });
}

let pyPromise: Promise<PyodideAPI> | null = null;
let pyError: Error | null = null;

async function getPyodide(onProgress: (msg: string) => void): Promise<PyodideAPI> {
  if (pyError) {
    pyError = null;
    pyPromise = null;
  }
  if (pyPromise) return pyPromise;

  pyPromise = (async () => {
    onProgress("Downloading Pyodide runtime…");
    await timeout(loadScript(SCRIPT_URL), DEFAULT_TIMEOUT / 3, "Timed out downloading Pyodide runtime");

    const loadPyodide = (window as unknown as { loadPyodide?: (cfg: { indexURL: string }) => Promise<PyodideAPI> }).loadPyodide;
    if (!loadPyodide) {
      // The global might not be set yet — wait a tick
      await new Promise((r) => setTimeout(r, 500));
      const loadPyodide2 = (window as unknown as { loadPyodide?: (cfg: { indexURL: string }) => Promise<PyodideAPI> }).loadPyodide;
      if (!loadPyodide2) throw new Error("Pyodide failed to register — check browser console");
    }

    onProgress("Starting Python interpreter…");
    const pyodide = await timeout(
      (loadPyodide || (window as unknown as { loadPyodide: (cfg: { indexURL: string }) => Promise<PyodideAPI> }).loadPyodide)({ indexURL: PYODIDE_INDEX }),
      DEFAULT_TIMEOUT / 3,
      "Timed out starting Python interpreter",
    );

    onProgress("Loading packages (numpy, pandas, matplotlib, scipy)…");
    await timeout(
      pyodide.loadPackage(["numpy", "pandas", "matplotlib", "scipy"]),
      DEFAULT_TIMEOUT / 3,
      "Timed out loading packages",
    );

    return pyodide;
  })();

  pyPromise.catch((err) => {
    pyError = err;
    pyPromise = null;
  });

  return pyPromise;
}

export function usePythonExecution() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");

  const execute = useCallback(async (code: string): Promise<ExecutionResult> => {
    setLoading(true);
    setProgress("Preparing…");

    try {
      const pyodide = await getPyodide(setProgress);
      setProgress("Running…");

      // Redirect stdout
      pyodide.runPython(`
import sys
from io import StringIO
_buf = StringIO()
_old_stdout = sys.stdout
sys.stdout = _buf
_display_hook = sys.displayhook
sys.displayhook = lambda x: None
`);

      // Setup matplotlib auto-capture
      pyodide.runPython(`
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import base64, io

def _aura_show():
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight')
    buf.seek(0)
    img_b64 = base64.b64encode(buf.read()).decode()
    plt.close()
    return img_b64
`);

      let stdout = "";
      let stderr = "";
      const images: string[] = [];

      try {
        pyodide.runPython(code);

        // Flush stdout
        stdout = String(pyodide.runPython(`
sys.stdout = _old_stdout
sys.displayhook = _display_hook
out = _buf.getvalue()
_buf = StringIO()
sys.stdout = _buf
sys.displayhook = lambda x: None
out
`));

        // Capture matplotlib figure
        const hasFig = Number(pyodide.runPython("import matplotlib.pyplot as plt; plt.get_fignums() != []"));
        if (hasFig) {
          const b64 = String(pyodide.runPython("_aura_show()"));
          images.push(b64);
        }
      } catch (err) {
        stderr = String(err);
        stdout = String(pyodide.runPython(`
sys.stdout = _old_stdout
out = _buf.getvalue()
out
`));
      }

      return { stdout, stderr, images };
    } catch (err) {
      return { stdout: "", stderr: String(err), images: [] };
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
