import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "MTA Arrival Board",
  description: "Gates Av J/Z & B52 arrivals",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MTA Arrival Board",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning style={{ backgroundColor: "var(--board-bg)" }}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&family=Press+Start+2P&display=swap" rel="stylesheet" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var k="mta-dashboard-config";try{var c=localStorage.getItem(k);if(c){var p=JSON.parse(c);var t=p.theme==="light"?"light":"dark";document.documentElement.setAttribute("data-theme",t);var m=(p.mode==="8bit"?"8bit":p.mode==="80s"?"80s":p.mode==="nature"?"nature":"classic");document.documentElement.setAttribute("data-mode",m);}else{document.documentElement.setAttribute("data-theme","dark");document.documentElement.setAttribute("data-mode","classic");}}catch(e){document.documentElement.setAttribute("data-theme","dark");document.documentElement.setAttribute("data-mode","classic");})();`,
          }}
        />
      </head>
      <body
        className="min-h-screen antialiased"
        style={{ backgroundColor: "var(--board-bg)", color: "var(--board-text)" }}
      >
        {children}
      </body>
    </html>
  );
}
