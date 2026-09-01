import { ChatClient } from "@/components/ChatClient";

export default function Home() {
  const isAuthOptional = !process.env.AUTH_GOOGLE_ID;
  return <ChatClient isAuthOptional={isAuthOptional} />;
}
