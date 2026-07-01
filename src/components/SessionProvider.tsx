"use client";

import { SessionProvider as AuthSessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function SessionProvider({ children }: { children: ReactNode }) {
  return <AuthSessionProvider>{children}</AuthSessionProvider>;
}
