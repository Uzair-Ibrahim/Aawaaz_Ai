import type { Metadata } from 'next';
import {
  Noto_Naskh_Arabic,
  Noto_Nastaliq_Urdu,
  Noto_Sans_Arabic,
  Plus_Jakarta_Sans,
} from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/shared/AppShell';
import { AuthProvider } from '@/lib/auth/context';
import { I18nProvider } from '@/lib/i18n/context';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-latin',
  display: 'swap',
});

const notoNastaliqUrdu = Noto_Nastaliq_Urdu({
  subsets: ['arabic'],
  weight: ['500', '600', '700'],
  variable: '--font-nastaliq',
  display: 'swap',
});

const notoNaskhArabic = Noto_Naskh_Arabic({
  subsets: ['arabic'],
  weight: ['500', '600', '700'],
  variable: '--font-naskh',
  display: 'swap',
});

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['500', '600', '700'],
  variable: '--font-arabic-ui',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Awaaz — Multilingual Public-Service AI Platform',
  description:
    'AI-powered, multilingual, voice-first civic public-service platform with 6-language sync, transparent eligibility rules, and human officer oversight.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${plusJakartaSans.variable} ${notoNastaliqUrdu.variable} ${notoNaskhArabic.variable} ${notoSansArabic.variable}`}
    >
      <body className="antialiased selection:bg-blue-200 selection:text-blue-950">
        <I18nProvider>
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
