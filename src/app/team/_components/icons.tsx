import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const make =
  (
    paths: React.ReactNode,
    defaultSize = 16,
    strokeWidth: number | string = 1.6,
  ) =>
  ({ size, ...rest }: IconProps) => (
    <svg
      viewBox="0 0 24 24"
      width={size ?? defaultSize}
      height={size ?? defaultSize}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {paths}
    </svg>
  );

export const I = {
  timeline: make(<path d="M3 6h18M3 12h12M3 18h7" />),
  projects: make(
    <>
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 12l9 4 9-4" />
      <path d="M3 17l9 4 9-4" />
    </>,
  ),
  members: make(
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15 14.5c2.5.4 4.5 2.4 4.5 5" />
    </>,
  ),
  insights: make(
    <>
      <circle cx="11" cy="11" r="6.2" />
      <path d="m20 20-4.3-4.3" />
    </>,
  ),
  reports: make(<path d="M5 20V10M11 20V4M17 20v-7" />),
  admin: make(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l1.9-1.5-2-3.5-2.3.9a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2l-2.3-.9-2 3.5L5.1 10.8A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-1.9 1.5 2 3.5 2.3-.9c.6.5 1.3.9 2 1.2L10 21h4l.5-2.5c.7-.3 1.4-.7 2-1.2l2.3.9 2-3.5-1.9-1.5c.1-.4.1-.8.1-1.2z" />
    </>,
  ),
  search: make(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.3-4.3" />
    </>,
    14,
    1.7,
  ),
  bell: make(
    <>
      <path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2.5h-15z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </>,
    14,
  ),
  chevron: make(<path d="m6 9 6 6 6-6" />, 14, 1.7),
  chevR: make(<path d="m9 6 6 6-6 6" />, 12, 1.7),
  plus: make(<path d="M12 5v14M5 12h14" />, 14, 1.7),
  filter: make(<path d="M4 5h16l-6 8v6l-4-2v-4z" />, 13),
  more: make(
    <>
      <circle cx="6" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18" cy="12" r="1.3" />
    </>,
    14,
  ),
  decision: make(<path d="M12 3 4 7v6c0 4 3.5 7 8 8 4.5-1 8-4 8-8V7l-8-4z" />, 13, 1.7),
  blocker: make(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m6 6 12 12" />
    </>,
    13,
    1.7,
  ),
  progress: make(<path d="M4 12h6l2-5 4 10 2-5h2" />, 13, 1.7),
  commit: make(
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M3 12h5.8M15.2 12H21" />
    </>,
    13,
    1.7,
  ),
  session: make(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 1.5" />
    </>,
    13,
    1.7,
  ),
  flag: make(<path d="M5 21V4h11l-2 4 2 4H5" />, 13, 1.7),
  download: make(<path d="M12 4v11M7 11l5 5 5-5M5 20h14" />, 13),
  external: make(<path d="M14 4h6v6M20 4l-9 9M9 5H5v14h14v-4" />, 12),
  panel: make(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>,
    14,
  ),
};

export type IconKey = keyof typeof I;
