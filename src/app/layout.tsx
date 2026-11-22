import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumina — Visual Search Assistant",
  description:
    "Upload a photo and Lumina describes it out loud: AI vision turns pictures into words, and speech synthesis reads the story back. Built for the StackUp November Coding Challenge.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
