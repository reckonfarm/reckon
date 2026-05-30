import type { Metadata } from "next";
import { Fraunces, DM_Sans } from "next/font/google";
import "./globals.css";
import BottomTabBar from '@/app/components/BottomTabBar'
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
    default: 'Dryline',
    template: '%s — Dryline',
  },
  description:
    'Track drought conditions and FSA LFP program eligibility for your county. Know when you qualify for payments before your neighbor does.',
  openGraph: {
    type: 'website',
    siteName: 'Dryline',
    images: [{ url: '/og-image.svg', width: 1200, height: 630, alt: 'Dryline' }],
  },
  twitter: {
    card: 'summary_large_image',
  },
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
        {children}
        <BottomTabBar />
        <FeedbackWidget />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
