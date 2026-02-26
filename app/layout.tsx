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
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var k="mta-dashboard-config";try{var c=localStorage.getItem(k);if(c){var p=JSON.parse(c);var t=p.theme==="light"?"light":"dark";document.documentElement.setAttribute("data-theme",t);}else{document.documentElement.setAttribute("data-theme","dark");}}catch(e){document.documentElement.setAttribute("data-theme","dark");})();`,
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
