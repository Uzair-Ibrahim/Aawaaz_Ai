import type { Metadata } from 'next';
import {
  Inter,
  Noto_Naskh_Arabic,
  Noto_Nastaliq_Urdu,
  Noto_Sans_Arabic,
} from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/shared/AppShell';
import { AuthProvider } from '@/lib/auth/context';
import { I18nProvider } from '@/lib/i18n/context';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-latin',
  display: 'swap',
});

const notoNastaliqUrdu = Noto_Nastaliq_Urdu({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-nastaliq',
  display: 'swap',
});

const notoNaskhArabic = Noto_Naskh_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-naskh',
  display: 'swap',
});

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-arabic-ui',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Awaaz — Multilingual Public-Service SaaS',
  description:
    'AI-powered, multilingual, voice-first public-service SaaS prototype (Idea 1: Mock Relief-Assistance Application). Synthetic data only.',
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
      className={`${inter.variable} ${notoNastaliqUrdu.variable} ${notoNaskhArabic.variable} ${notoSansArabic.variable}`}
    >
      <body>
        <I18nProvider>
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
