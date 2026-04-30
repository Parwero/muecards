import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Muecards — Scheduler',
  description: 'Programa publicaciones de Instagram para tu colección de cartas TCG.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
