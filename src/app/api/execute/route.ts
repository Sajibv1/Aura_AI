import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const PISTON_API = "https://emkc.org/api/v2/piston/execute";

type PistonRequest = {
  language: string;
  version: string;
  files: { name: string; content: string }[];
  stdin?: string;
  args?: string[];
  compile_timeout?: number;
  run_timeout?: number;
};

type PistonResponse = {
  language: string;
  version: string;
  run: {
    stdout: string;
    stderr: string;
    output: string;
    code: number;
    signal: string | null;
  };
};

const RUNTIMES: Record<string, { version: string; name: string }> = {
  python: { version: "3.10.0", name: "Python" },
  javascript: { version: "18.15.0", name: "JavaScript" },
  r: { version: "4.3.1", name: "R" },
  ruby: { version: "3.2.1", name: "Ruby" },
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json() as {
      language: string;
      code: string;
    };

    const lang = body.language?.toLowerCase();
    const runtime = RUNTIMES[lang];
    if (!runtime) {
      return NextResponse.json(
        { error: `Unsupported language "${lang}". Supported: ${Object.keys(RUNTIMES).join(", ")}` },
        { status: 400 },
      );
    }

    const pistonReq: PistonRequest = {
      language: lang,
      version: runtime.version,
      files: [{ name: `main${lang === "python" ? ".py" : lang === "javascript" ? ".js" : ".r"}`, content: body.code }],
      run_timeout: 10000,
    };

    const res = await fetch(PISTON_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pistonReq),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Piston API error (${res.status}): ${text}` }, { status: 502 });
    }

    const data: PistonResponse = await res.json();

    return NextResponse.json({
      stdout: data.run.stdout,
      stderr: data.run.stderr,
      output: data.run.output,
      code: data.run.code,
    });
  } catch (error: unknown) {
    console.error("Execute API Error:", error);
    const message = error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
