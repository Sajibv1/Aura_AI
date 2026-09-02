"use client";

import { useState, useCallback } from "react";
import { CheckIcon, PlayIcon, XIcon } from "lucide-react";

import { useCodeExecution } from "@/hooks/useCodeExecution";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

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
    <div className="overflow-hidden rounded-lg border bg-muted/50">
      <div className="flex items-center justify-between gap-2 border-b bg-muted px-3 py-1.5">
        <Badge variant="secondary" className="font-mono text-xs">
          {language || "code"}
        </Badge>
        <Button
          variant="ghost"
          size="xs"
          onClick={handleRun}
          disabled={loading}
        >
          {loading ? (
            <>
              <Spinner data-icon="inline-start" />
              Running…
            </>
          ) : state === "done" ? (
            <>
              <CheckIcon data-icon="inline-start" />
              Done
            </>
          ) : state === "error" ? (
            <>
              <XIcon data-icon="inline-start" />
              Error
            </>
          ) : (
            <>
              <PlayIcon data-icon="inline-start" />
              Run
            </>
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      {(output || error) && (
        <div
          className={cn(
            "border-t px-3 py-2 font-mono text-xs",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {output && <pre className="whitespace-pre-wrap">{output}</pre>}
          {error && <pre className="whitespace-pre-wrap">{error}</pre>}
        </div>
      )}
    </div>
  );
}
