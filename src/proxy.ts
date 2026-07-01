import { auth } from "@/lib/auth";

export default auth((req) => {
  // Session is attached to req.auth — page/API handle auth themselves
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
