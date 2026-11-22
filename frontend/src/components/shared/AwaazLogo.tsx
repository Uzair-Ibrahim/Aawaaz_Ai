'use client';

import React from 'react';

interface AwaazLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  title?: string;
  subtitle?: string;
  inverted?: boolean;
  className?: string;
}

const SIZE_MAP = {
  sm: { box: 'h-8 w-8', text: 'text-lg', sub: 'text-[10px]' },
  md: { box: 'h-10 w-10', text: 'text-xl', sub: 'text-[11px]' },
  lg: { box: 'h-14 w-14', text: 'text-2xl', sub: 'text-xs' },
} as const;

export function AwaazLogo({
  size = 'md',
  showWordmark = false,
  title = 'Awaaz',
  subtitle,
  inverted = false,
  className = '',
}: AwaazLogoProps) {
  const dims = SIZE_MAP[size];
  const gradId = `awaaz-shield-grad-${size}`;
  const goldId = `awaaz-gold-grad-${size}`;

  return (
    <span
      data-testid="awaaz-brand-logo"
      className={`inline-flex items-center gap-2.5 select-none ${className}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        fill="none"
        role="img"
        aria-label="Awaaz Logo"
        className={`${dims.box} shrink-0 drop-shadow-xs`}
      >
        <defs>
          <linearGradient id={gradId} x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0F2D5C" />
            <stop offset="55%" stopColor="#1D4ED8" />
            <stop offset="100%" stopColor="#2563EB" />
          </linearGradient>
          <linearGradient id={goldId} x1="16" y1="10" x2="48" y2="54" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#D97706" />
          </linearGradient>
        </defs>

        {/* Civic Royal Blue Shield / Rounded Emblem */}
        <path
          d="M32 3.5L54.5 11.2C56.6 11.9 58 13.9 58 16.1V32.4C58 46.2 47.4 55.9 33.7 60.2C32.6 60.6 31.4 60.6 30.3 60.2C16.6 55.9 6 46.2 6 32.4V16.1C6 13.9 7.4 11.9 9.5 11.2L32 3.5Z"
          fill={`url(#${gradId})`}
          stroke="#60A5FA"
          strokeOpacity="0.55"
          strokeWidth="1.5"
        />

        {/* Subtle Inner Shield Ring */}
        <path
          d="M32 7.5L51 14C52.5 14.5 53.5 15.9 53.5 17.5V32C53.5 43.6 44.6 51.8 33.2 55.5C32.4 55.8 31.6 55.8 30.8 55.5C19.4 51.8 10.5 43.6 10.5 32V17.5C10.5 15.9 11.5 14.5 13 14L32 7.5Z"
          stroke="#FFFFFF"
          strokeOpacity="0.18"
          strokeWidth="1.2"
        />

        {/* Warm Gold Maddah / Acoustic Crown Accent (آ) */}
        <path
          d="M21.5 18.5C24.5 15 28.5 15 32 17.4C35.5 19.8 39.5 19.6 42.5 16.3"
          stroke={`url(#${goldId})`}
          strokeWidth="3.6"
          strokeLinecap="round"
        />

        {/* Symmetric Acoustic Sound Waves forming Urdu Alif / Voice Pulse */}
        <rect x="29.6" y="21.5" width="4.8" height="25.5" rx="2.4" fill="#FFFFFF" />
        <rect x="21.4" y="26.5" width="4.2" height="15.5" rx="2.1" fill="#DBEAFE" fillOpacity="0.95" />
        <rect x="38.4" y="26.5" width="4.2" height="15.5" rx="2.1" fill="#DBEAFE" fillOpacity="0.95" />
        <rect x="14.2" y="30.5" width="3.6" height="8" rx="1.8" fill="#F59E0B" />
        <rect x="46.2" y="30.5" width="3.6" height="8" rx="1.8" fill="#F59E0B" />

        {/* Gold Resonance Pulse Dot */}
        <circle cx="32" cy="51.2" r="2.3" fill="#F59E0B" />
      </svg>

      {showWordmark && (
        <span className="flex flex-col leading-tight">
          <span
            className={`${dims.text} font-extrabold tracking-tight ${
              inverted ? 'text-white' : 'text-slate-950'
            }`}
          >
            {title}
          </span>
          {subtitle && (
            <span
              className={`${dims.sub} font-bold tracking-wide ${
                inverted ? 'text-sky-200' : 'text-blue-800'
              }`}
            >
              {subtitle}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
