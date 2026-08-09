import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CareLine — Voice Receptionist",
  description:
    "Voice AI receptionist for Manipal Hospital, Old Airport Road. Book, reschedule, or cancel an appointment by talking.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
