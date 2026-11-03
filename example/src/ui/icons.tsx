// 24x24 line-art icons as plain JSX. Stroke uses currentColor so they follow
// the button's text colour.

import type { ReactNode } from 'react';

const Svg = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const LayersIcon = () => (
  <Svg><path d="M12 3 2 8l10 5 10-5-10-5Z" /><path d="m2 13 10 5 10-5" /><path d="m2 17.5 10 5 10-5" opacity=".5" /></Svg>
);
export const ListIcon = () => (
  <Svg><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></Svg>
);
export const CloseIcon = () => <Svg><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const ChevronIcon = ({ up }: { up?: boolean }) => (
  <Svg size={18}><path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></Svg>
);
export const InfoIcon = () => <Svg size={18}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></Svg>;
export const LinkIcon = () => (
  <Svg size={18}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Svg>
);
export const RefreshIcon = () => <Svg size={18}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></Svg>;
export const LogoutIcon = () => <Svg size={18}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></Svg>;
export const KeyIcon = () => (
  <Svg size={18}><circle cx="7.5" cy="15.5" r="3.5" /><path d="m10 13 9-9M16 7l2.5 2.5M13.5 9.5 15 11" /></Svg>
);
