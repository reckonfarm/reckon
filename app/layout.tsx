import type { Metadata, Viewport } from "next";
import { Fraunces, DM_Sans } from "next/font/google";
import "./globals.css";
import BottomTabBar from '@/app/components/BottomTabBar'
import InAppBrowserBanner from '@/app/components/InAppBrowserBanner'
import FeedbackWidget from '@/app/components/FeedbackWidget'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: {
    default: 'Dryline — Ranch Intelligence for Cattle Country',
    template: '%s — Dryline',
  },
  description:
    "Dryline is ranch intelligence for cattle country — drought monitoring, LFP payment estimates, cattle market data, and a hay marketplace, bringing your operation's conditions, markets, and money together in one place.",
  openGraph: {
    type: 'website',
    siteName: 'Dryline',
    title: 'Dryline — Ranch Intelligence for Cattle Country',
    description:
      "Dryline is ranch intelligence for cattle country — drought monitoring, LFP payment estimates, cattle market data, and a hay marketplace, bringing your operation's conditions, markets, and money together in one place.",
    images: [{ url: '/og-image.svg', width: 1200, height: 630, alt: 'Dryline' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Dryline — Ranch Intelligence for Cattle Country',
    description:
      "Dryline is ranch intelligence for cattle country — drought monitoring, LFP payment estimates, cattle market data, and a hay marketplace, bringing your operation's conditions, markets, and money together in one place.",
  },
  // /favicon.ico is provided by the app/favicon.ico file convention (auto-linked).
  // These add the PNG + SVG variants and the iOS home-screen icon.
  icons: {
    icon: [
      { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Dryline',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: '#1B4332',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${dmSans.variable} antialiased`}
    >
      <body className="min-h-screen bg-cream text-forest-green">
        <InAppBrowserBanner />
        {children}
        <BottomTabBar />
        <FeedbackWidget />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
