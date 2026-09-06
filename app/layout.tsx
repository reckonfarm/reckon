import type { Metadata, Viewport } from "next";
import { Fraunces, DM_Sans } from "next/font/google";
import "./globals.css";
import BottomTabBar from '@/app/components/BottomTabBar'
import InAppBrowserBanner from '@/app/components/InAppBrowserBanner'
import FeedbackWidget from '@/app/components/FeedbackWidget'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { flagEnabled } from '@/lib/flags'
import SiteFooter from '@/app/components/SiteFooter';

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

// One flag-gated description for all three metadata surfaces (default, OG, Twitter) —
// mirrors app/page.tsx and app/manifest.ts so no surface can advertise a flagged-off feature.
const siteDescription = flagEnabled('marketplace')
  ? "Dryline is a shared feeding record for your ranch — log the feed from your phone, see what's left, and leave the next person a clear handoff. County drought, program, weather, and market references included."
  : "Dryline is a shared feeding record for your ranch — log the feed from your phone, see what's left, and leave the next person a clear handoff. County drought, program, weather, and market references included."

export const metadata: Metadata = {
  title: {
    default: 'Dryline — Your ranch, on the record.',
    template: '%s — Dryline',
  },
  description: siteDescription,
  openGraph: {
    type: 'website',
    siteName: 'Dryline',
    title: 'Dryline — Your ranch, on the record.',
    description: siteDescription,
    images: [{ url: '/og-image.svg', width: 1200, height: 630, alt: 'Dryline' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Dryline — Your ranch, on the record.',
    description: siteDescription,
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
        <SiteFooter />
        <BottomTabBar />
        <FeedbackWidget />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
