import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Rotaciones con datos NASA",
  description: "Prototipo de apoyo a la decisión para NASA Space Apps 2026",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
